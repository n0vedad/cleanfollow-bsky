/** Blocks-tab analysis: find blocks whose target accounts are no longer active. */

import { AppBskyGraphBlock } from "@atcute/bluesky";
import { Client } from "@atcute/client";
import { ActorIdentifier, Did } from "@atcute/lexicons";

import { resolveDid } from "../identity";
import { agent, agentDID, rpc } from "../session";
import {
  blockToggleStates,
  setBlockRecords,
  setGlobalNotice,
  setItemCount,
  setProgress,
} from "../state";
import { getStatusLabel, RepoStatus, type BlockRecord } from "../types";

/**
 * Fetch the user's currently active blocks (paginated) straight from the PDS.
 * @returns all active block views
 */
const fetchBlocks = async () => {
  // getBlocks is a PDS-only endpoint, so use a client without the AppView proxy.
  const pdsClient = new Client({ handler: agent });

  const PAGE_LIMIT = 50;
  /**
   * Fetch one page of active blocks.
   * @param cursor - pagination cursor from the previous page, if any
   */
  const fetchPage = async (cursor?: string) => {
    return await pdsClient.get("app.bsky.graph.getBlocks", {
      params: {
        limit: PAGE_LIMIT,
        cursor: cursor,
      },
    });
  };

  let res = await fetchPage();
  if (!res.ok) throw new Error(res.data.error);
  let blocks = res.data.blocks;

  while (res.data.cursor) {
    res = await fetchPage(res.data.cursor);
    if (!res.ok) throw new Error(res.data.error);
    blocks = blocks.concat(res.data.blocks);
  }

  return blocks;
};

/**
 * List every block record in the repo, drop the ones still active, then classify
 * the remaining (inactive) targets and write the result to the blocks store.
 * Profiles are fetched in concurrency-limited batches.
 */
export const analyzeBlocks = async () => {
  setProgress(0);

  const allBlockRecords: { did: string; uri: string }[] = [];
  let cursor: string | undefined;

  setGlobalNotice("Fetching blocked accounts...");

  do {
    const res = await rpc.get("com.atproto.repo.listRecords", {
      params: {
        repo: agentDID as ActorIdentifier,
        collection: "app.bsky.graph.block",
        limit: 100,
        cursor: cursor,
      },
    });
    if (!res.ok) break;

    for (const record of res.data.records) {
      const blockRecord = record.value as AppBskyGraphBlock.Main;
      allBlockRecords.push({
        did: blockRecord.subject,
        uri: record.uri,
      });
    }

    cursor = res.data.cursor;
  } while (cursor);

  let blocksToDelete = allBlockRecords;

  try {
    const activeBlocks = await fetchBlocks();
    const activeDids = new Set<string>(activeBlocks.map((b) => b.did));
    blocksToDelete = allBlockRecords.filter((record) => !activeDids.has(record.did));
  } catch (error) {
    console.warn("Failed to fetch active blocks, will analyze all blocked accounts:", error);
  }

  setItemCount(blocksToDelete.length);
  const tmpBlocks: BlockRecord[] = [];
  setGlobalNotice("Analyzing blocked accounts...");

  const BATCH_SIZE = 25;
  const CONCURRENT_BATCHES = 5;

  // Create batches
  const batches = [];
  for (let i = 0; i < blocksToDelete.length; i += BATCH_SIZE) {
    batches.push(blocksToDelete.slice(i, i + BATCH_SIZE));
  }

  // Process batches in parallel with concurrency limit
  for (let i = 0; i < batches.length; i += CONCURRENT_BATCHES) {
    const batchGroup = batches.slice(i, i + CONCURRENT_BATCHES);

    const results = await Promise.all(
      batchGroup.map(async (batch) => {
        const dids = batch.map((block) => block.did as Did);

        const res = await rpc.get("app.bsky.actor.getProfiles", {
          params: { actors: dids },
        });

        if (!res.ok) {
          setGlobalNotice("Error fetching profiles. Try logging back in if you haven't.");
          throw new Error(res.data.error);
        }

        return { batch, dids, res };
      }),
    );

    // Process results
    for (const { batch, dids, res } of results) {
      const foundDids = new Set(res.data.profiles.map((p) => p.did));

      // DIDs missing from the getProfiles response are likely deleted /
      // suspended / deactivated; probe each one individually to classify it.
      const missingDids = dids.filter((did) => !foundDids.has(did));
      const missingResults = await Promise.all(
        missingDids.map(async (did) => {
          let status: RepoStatus | undefined = undefined;
          const handle = await resolveDid(did);

          const profileRes = await rpc.get("app.bsky.actor.getProfile", {
            params: { actor: did as ActorIdentifier },
          });

          if (!profileRes.ok) {
            const e = profileRes.data as any;
            status =
              e.message.includes("not found") ? RepoStatus.DELETED
              : e.message.includes("deactivated") ? RepoStatus.DEACTIVATED
              : e.message.includes("suspended") ? RepoStatus.SUSPENDED
              : undefined;
          }

          return { did, handle, status };
        }),
      );

      for (const { did, handle, status } of missingResults) {
        if (status !== undefined) {
          const block = batch.find((b) => b.did === did)!;
          tmpBlocks.push({
            did: block.did,
            handle: handle || "[Unknown Handle]",
            uri: block.uri,
            status: status,
            status_label: getStatusLabel(status),
            toDelete: false,
            visible: blockToggleStates[status] ?? true,
          });
        }
      }

      setProgress((prev) => prev + batch.length);
    }
  }

  if (tmpBlocks.length === 0) {
    setGlobalNotice("All your blocked accounts are still active");
  } else {
    setGlobalNotice("");
  }

  setBlockRecords(tmpBlocks);
  setProgress(0);
  setItemCount(0);
};

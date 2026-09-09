/** Follows-tab analysis: find follows whose targets are inactive or block-related. */

import { AppBskyGraphFollow } from "@atcute/bluesky";
import { ActorIdentifier, Did } from "@atcute/lexicons";

import { resolveDid } from "../identity";
import { agentDID, appviewRpc, rpc } from "../session";
import {
  failedProfiles,
  followToggleStates,
  setFailedProfiles,
  setFollowRecords,
  setGlobalNotice,
  setItemCount,
  setProgress,
} from "../state";
import { getStatusLabel, RepoStatus, type FollowRecord } from "../types";

/**
 * Fetch every follow record from the user's repo (paginated).
 * @returns all follow records
 */
const fetchFollows = async () => {
  const PAGE_LIMIT = 100;
  /**
   * Fetch one page of follow records.
   * @param cursor - pagination cursor from the previous page, if any
   */
  const fetchPage = async (cursor?: string) => {
    return await rpc.get("com.atproto.repo.listRecords", {
      params: {
        repo: agentDID as ActorIdentifier,
        collection: "app.bsky.graph.follow",
        limit: PAGE_LIMIT,
        cursor: cursor,
      },
    });
  };

  let res = await fetchPage();
  if (!res.ok) throw new Error(res.data.error);
  let follows = res.data.records;

  while (res.data.cursor && res.data.records.length >= PAGE_LIMIT) {
    res = await fetchPage(res.data.cursor);
    if (!res.ok) throw new Error(res.data.error);
    follows = follows.concat(res.data.records);
  }

  return follows;
};

/**
 * List every follow record, classify each target via the AppView (inactive, or in
 * a block relationship), and write the result to the follows store. Profiles are
 * fetched in concurrency-limited, rate-limited batches; failures are counted but
 * don't abort the run.
 */
export const analyzeFollows = async () => {
  setProgress(0);

  setGlobalNotice("Fetching followed accounts...");
  setFailedProfiles(0);
  const follows = await fetchFollows();
  setItemCount(follows.length);
  const tmpFollows: FollowRecord[] = [];
  setGlobalNotice("Analyzing followed accounts...");

  const BATCH_SIZE = 20; // Max is 25 per API spec, using 20 to be safe
  const CONCURRENT_BATCHES = 2; // Reduced to avoid rate limiting
  const BATCH_DELAY_MS = 500; // Delay between batch groups

  // Create all batches
  const batches = [];
  for (let i = 0; i < follows.length; i += BATCH_SIZE) {
    batches.push(follows.slice(i, i + BATCH_SIZE));
  }

  // Process batches in parallel with concurrency limit
  for (let i = 0; i < batches.length; i += CONCURRENT_BATCHES) {
    const batchGroup = batches.slice(i, i + CONCURRENT_BATCHES);

    // Add delay between batch groups to avoid rate limiting
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }

    const results = await Promise.allSettled(
      batchGroup.map(async (batch) => {
        const dids = batch.map((record) => (record.value as AppBskyGraphFollow.Main).subject);

        try {
          const res = await appviewRpc.get("app.bsky.actor.getProfiles", {
            params: { actors: dids as Did[] },
          });

          if (!res.ok) {
            console.warn("Failed to fetch profiles for batch:", {
              error: res.data,
              didCount: dids.length,
            });
            setFailedProfiles((prev) => prev + dids.length);
            return { batch, dids, res: { ok: true, data: { profiles: [] } } };
          }

          return { batch, dids, res };
        } catch (error) {
          console.warn("Exception fetching profiles:", error);
          setFailedProfiles((prev) => prev + dids.length);
          return { batch, dids, res: { ok: true, data: { profiles: [] } } };
        }
      }),
    );

    // Process all results from this batch group
    for (const result of results) {
      if (result.status === "rejected") {
        console.warn("Batch processing failed:", result.reason);
        continue;
      }

      const { batch, dids, res } = result.value;
      const foundDids = new Set(res.data.profiles.map((p) => p.did));

      for (const profile of res.data.profiles) {
        let status: RepoStatus | undefined = undefined;
        const viewer = profile.viewer;

        if (profile.labels?.some((label) => label.val === "!hide")) {
          status = RepoStatus.HIDDEN;
        } else if (viewer && viewer.blockedBy) {
          status =
            viewer.blocking || viewer.blockingByList ?
              RepoStatus.MUTUALBLOCK
            : RepoStatus.BLOCKEDBY;
        } else if (profile.did === agentDID) {
          status = RepoStatus.YOURSELF;
        } else if (viewer && (viewer.blocking || viewer.blockingByList)) {
          status = RepoStatus.BLOCKING;
        }

        if (status !== undefined) {
          const record = batch.find(
            (r) => (r.value as AppBskyGraphFollow.Main).subject === profile.did,
          )!;
          tmpFollows.push({
            did: profile.did,
            handle: profile.handle,
            uri: record.uri,
            status: status,
            status_label: getStatusLabel(status),
            toDelete: false,
            visible: followToggleStates[status] ?? true,
          });
        }
      }

      // Process missing DIDs in parallel
      const missingDids = dids.filter((did) => !foundDids.has(did));
      const missingResults = await Promise.all(
        missingDids.map(async (did) => {
          let status: RepoStatus | undefined = undefined;
          const handle = await resolveDid(did);

          const profileRes = await appviewRpc.get("app.bsky.actor.getProfile", {
            params: { actor: did },
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
          const record = batch.find((r) => (r.value as AppBskyGraphFollow.Main).subject === did)!;
          tmpFollows.push({
            did: did,
            handle: handle,
            uri: record.uri,
            status: status,
            status_label: getStatusLabel(status),
            toDelete: false,
            visible: followToggleStates[status] ?? true,
          });
        }
      }

      setProgress((prev) => prev + batch.length);
    }
  }

  if (tmpFollows.length === 0) {
    if (failedProfiles() > 0) {
      setGlobalNotice(
        `Completed. ${failedProfiles()} profile(s) could not be fetched. No accounts to unfollow.`,
      );
    } else {
      setGlobalNotice("All accounts you follow are active");
    }
  } else if (failedProfiles() > 0) {
    setGlobalNotice(
      `Found ${tmpFollows.length} account(s). ${failedProfiles()} profile(s) could not be fetched.`,
    );
  } else {
    setGlobalNotice("");
  }

  setFollowRecords(tmpFollows);
  setProgress(0);
  setItemCount(0);
};

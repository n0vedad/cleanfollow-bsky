import { createEffect, createSignal, For, onMount, Show } from "solid-js";
import { createStore } from "solid-js/store";

import { ComAtprotoRepoApplyWrites } from "@atcute/atproto";
import { AppBskyGraphFollow, AppBskyGraphBlock } from "@atcute/bluesky";
import { Client, CredentialManager } from "@atcute/client";
import { $type, ActorIdentifier, Did, Handle } from "@atcute/lexicons";
import {
  configureOAuth,
  createAuthorizationUrl,
  finalizeAuthorization,
  getSession,
  OAuthUserAgent,
  resolveFromIdentity,
  type Session,
} from "@atcute/oauth-browser-client";

configureOAuth({
  metadata: {
    client_id: import.meta.env.VITE_OAUTH_CLIENT_ID,
    redirect_uri: import.meta.env.VITE_OAUTH_REDIRECT_URL,
  },
});

enum RepoStatus {
  BLOCKEDBY = 1 << 0,
  BLOCKING = 1 << 1,
  DELETED = 1 << 2,
  DEACTIVATED = 1 << 3,
  SUSPENDED = 1 << 4,
  HIDDEN = 1 << 5,
  YOURSELF = 1 << 6,
  UNKNOWN = 1 << 7,
}

type AccountRecord = {
  did: string;
  handle: string;
  uri: string;
  status: RepoStatus;
  status_label: string;
  toDelete: boolean;
  visible: boolean;
};

type FollowRecord = AccountRecord;
type BlockRecord = AccountRecord;

enum ViewMode {
  FOLLOWS = "follows",
  BLOCKS = "blocks",
}

type ToggleStates = {
  [key in RepoStatus]?: boolean;
};

const [followToggleStates, setFollowToggleStates] = createStore<ToggleStates>({
  [RepoStatus.DELETED]: true,
  [RepoStatus.DEACTIVATED]: true,
  [RepoStatus.SUSPENDED]: true,
  [RepoStatus.BLOCKEDBY]: true,
  [RepoStatus.BLOCKING]: true,
  [RepoStatus.HIDDEN]: true,
});

const [blockToggleStates, setBlockToggleStates] = createStore<ToggleStates>({
  [RepoStatus.DELETED]: true,
  [RepoStatus.DEACTIVATED]: true,
  [RepoStatus.SUSPENDED]: true,
  [RepoStatus.UNKNOWN]: true,
});

const [followRecords, setFollowRecords] = createStore<FollowRecord[]>([]);
const [blockRecords, setBlockRecords] = createStore<BlockRecord[]>([]);
const [currentMode, setCurrentMode] = createSignal<ViewMode>(ViewMode.FOLLOWS);
const [loginState, setLoginState] = createSignal(false);
const [globalNotice, setGlobalNotice] = createSignal("");
let rpc: Client;
let agent: OAuthUserAgent;
let manager: CredentialManager;
let agentDID: string;

const resolveDid = async (did: string) => {
  const res = await fetch(
    did.startsWith("did:web") ?
      `https://${did.split(":")[2]}/.well-known/did.json`
    : "https://plc.directory/" + did,
  ).catch((error: unknown) => {
    console.warn("Failed to resolve DID", { error, did });
  });
  if (!res) return "";

  return res
    .json()
    .then((doc) => {
      for (const alias of doc.alsoKnownAs) {
        if (alias.includes("at://")) {
          return alias.split("//")[1];
        }
      }
    })
    .catch((error: unknown) => {
      console.warn("Failed to parse DID", { error, did });
      return "";
    });
};

const Login = () => {
  const [loginInput, setLoginInput] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [handle, setHandle] = createSignal("");
  const [notice, setNotice] = createSignal("");

  onMount(async () => {
    setNotice("Loading...");

    const init = async (): Promise<Session | undefined> => {
      const params = new URLSearchParams(location.hash.slice(1));

      if (params.has("state") && (params.has("code") || params.has("error"))) {
        history.replaceState(null, "", location.pathname + location.search);

        const session = await finalizeAuthorization(params);
        const did = session.info.sub;

        localStorage.setItem("lastSignedIn", did);
        return session;
      } else {
        const lastSignedIn = localStorage.getItem("lastSignedIn");

        if (lastSignedIn) {
          try {
            return await getSession(lastSignedIn as Did);
          } catch (err) {
            localStorage.removeItem("lastSignedIn");
            throw err;
          }
        }
      }
    };

    const session = await init().catch(() => {});

    if (session) {
      agent = new OAuthUserAgent(session);
      rpc = new Client({ handler: agent });
      agentDID = agent.sub;

      setLoginState(true);
      setHandle(await resolveDid(agent.sub));
    }

    setNotice("");
  });

  const getPDS = async (did: string) => {
    const res = await fetch(
      did.startsWith("did:web") ?
        `https://${did.split(":")[2]}/.well-known/did.json`
      : "https://plc.directory/" + did,
    );

    return res.json().then((doc: any) => {
      for (const service of doc.service) {
        if (service.id === "#atproto_pds") return service.serviceEndpoint;
      }
    });
  };

  const resolveHandle = async (handle: string) => {
    const rpc = new Client({
      handler: new CredentialManager({
        service: "https://public.api.bsky.app",
      }),
    });
    const res = await rpc.get("com.atproto.identity.resolveHandle", {
      params: { handle: handle as Handle },
    });
    if (!res.ok) throw new Error(res.data.error);
    return res.data.did;
  };

  const loginBsky = async (login: string) => {
    if (password()) {
      agentDID = login.startsWith("did:") ? login : await resolveHandle(login);
      manager = new CredentialManager({ service: await getPDS(agentDID) });
      rpc = new Client({ handler: manager });

      await manager.login({
        identifier: agentDID,
        password: password(),
      });
      setLoginState(true);
    } else {
      try {
        setNotice(`Resolving your identity...`);
        const resolved = await resolveFromIdentity(login);

        setNotice(`Contacting your data server...`);
        const authUrl = await createAuthorizationUrl({
          scope: import.meta.env.VITE_OAUTH_SCOPE,
          ...resolved,
        });

        setNotice(`Redirecting...`);
        await new Promise((resolve) => setTimeout(resolve, 250));

        location.assign(authUrl);
      } catch {
        setNotice("Error during OAuth login");
      }
    }
  };

  const logoutBsky = async () => {
    await agent.signOut();
    setLoginState(false);
  };

  return (
    <div class="flex flex-col items-center">
      <Show when={!loginState() && !notice().includes("Loading")}>
        <form class="flex flex-col" onsubmit={(e) => e.preventDefault()}>
          <label for="handle" class="ml-0.5">
            Handle
          </label>
          <input
            type="text"
            id="handle"
            placeholder="user.bsky.social"
            class="dark:bg-dark-100 mb-2 rounded-lg border border-gray-400 px-2 py-1 focus:ring-1 focus:ring-gray-300 focus:outline-none"
            onInput={(e) => setLoginInput(e.currentTarget.value)}
          />
          <label for="password" class="ml-0.5">
            App Password
          </label>
          <input
            type="password"
            id="password"
            placeholder="leave empty for oauth"
            class="dark:bg-dark-100 mb-2 rounded-lg border border-gray-400 px-2 py-1 focus:ring-1 focus:ring-gray-300 focus:outline-none"
            onInput={(e) => setPassword(e.currentTarget.value)}
          />
          <button
            onclick={() => loginBsky(loginInput())}
            class="rounded bg-blue-600 py-1.5 font-bold text-slate-100 hover:bg-blue-700"
          >
            Login
          </button>
        </form>
      </Show>
      <Show when={loginState() && handle()}>
        <div class="mb-4">
          Logged in as @{handle()}
          <button
            class="ml-2 bg-transparent text-red-500 dark:text-red-400"
            onclick={() => logoutBsky()}
          >
            Logout
          </button>
        </div>
      </Show>
      <Show when={notice()}>
        <div class="m-3">{notice()}</div>
      </Show>
    </div>
  );
};

const ModeSelector = () => {
  const handleModeChange = (mode: ViewMode) => {
    setCurrentMode(mode);
    setGlobalNotice("");
  };

  return (
    <div class="flex gap-4 mb-4">
      <button
        onclick={() => handleModeChange(ViewMode.FOLLOWS)}
        class={`px-4 py-2 rounded font-semibold transition-colors ${
          currentMode() === ViewMode.FOLLOWS
            ? "bg-blue-600 text-white"
            : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"
        }`}
      >
        Clean Follows
      </button>
      <button
        onclick={() => handleModeChange(ViewMode.BLOCKS)}
        class={`px-4 py-2 rounded font-semibold transition-colors ${
          currentMode() === ViewMode.BLOCKS
            ? "bg-blue-600 text-white"
            : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"
        }`}
      >
        Clean Blocks
      </button>
    </div>
  );
};

const Fetch = () => {
  const [progress, setProgress] = createSignal(0);
  const [itemCount, setItemCount] = createSignal(0);

  const checkProfileStatus = async (did: string) => {
    let handle = "";
    let status: RepoStatus | undefined = undefined;

    const res = await rpc.get("app.bsky.actor.getProfile", {
      params: { actor: did },
    });

    if (!res.ok) {
      handle = await resolveDid(did);
      const e = res.data as any;

      status =
        e.message?.includes("not found") ? RepoStatus.DELETED
        : e.message?.includes("deactivated") ? RepoStatus.DEACTIVATED
        : e.message?.includes("suspended") ? RepoStatus.SUSPENDED
        : RepoStatus.UNKNOWN;
    } else {
      handle = res.data.handle;
      const viewer = res.data.viewer!;

      if (res.data.labels?.some((label: any) => label.val === "!hide")) {
        status = RepoStatus.HIDDEN;
      } else if (viewer.blockedBy) {
        status =
          viewer.blocking || viewer.blockingByList ?
            RepoStatus.BLOCKEDBY | RepoStatus.BLOCKING
          : RepoStatus.BLOCKEDBY;
      } else if (res.data.did.includes(agentDID)) {
        status = RepoStatus.YOURSELF;
      } else if (viewer.blocking || viewer.blockingByList) {
        status = RepoStatus.BLOCKING;
      }
    }

    return { handle, status };
  };

  const fetchBlocks = async () => {
    const PAGE_LIMIT = 50;
    const fetchPage = async (cursor?: string) => {
      return await rpc.get("app.bsky.graph.getBlocks", {
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

    const blockedDids = new Set(blocks.map((b: any) => b.did));

    const blockUris: { did: string; uri: string }[] = [];
    let recordsCursor: string | undefined;

    do {
      try {
        const recordsRes = await rpc.get("com.atproto.repo.listRecords", {
          params: {
            repo: agentDID as ActorIdentifier,
            collection: "app.bsky.graph.block",
            limit: 100,
            cursor: recordsCursor,
          },
        });
        if (!recordsRes.ok) break;

        for (const record of recordsRes.data.records) {
          const blockRecord = record.value as AppBskyGraphBlock.Main;

          if (blockedDids.has(blockRecord.subject)) {
            blockUris.push({
              did: blockRecord.subject,
              uri: record.uri
            });
            blockedDids.delete(blockRecord.subject);
          }
        }

        recordsCursor = recordsRes.data.cursor;
      } catch (e) {
        console.error("Error fetching block records:", e);
        break;
      }
    } while (recordsCursor);

    return blockUris;
  };

  const fetchFollows = async () => {
    const PAGE_LIMIT = 100;
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

  const fetchHiddenAccounts = async () => {
    setProgress(0);

    const currentToggleStates = currentMode() === ViewMode.BLOCKS ? blockToggleStates : followToggleStates;

    if (currentMode() === ViewMode.BLOCKS) {
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

      const activeBlocks = await fetchBlocks();
      const activeDids = new Set(activeBlocks.map(b => b.did));

      const blocksToDelete = allBlockRecords.filter(record => !activeDids.has(record.did));

      setItemCount(blocksToDelete.length);
      const tmpBlocks: BlockRecord[] = [];
      setGlobalNotice("Analyzing blocked accounts...");

      const timer = (ms: number) => new Promise((res) => setTimeout(res, ms));

      for (let i = 0; i < blocksToDelete.length; i++) {
        if (i > 0 && i % 10 === 0) {
          await timer(100);
        }

        const block = blocksToDelete[i];
        setProgress(i + 1);

        const { handle, status } = await checkProfileStatus(block.did);

        let status_label = "Unknown";
        let actualStatus = status || RepoStatus.UNKNOWN;

        if (status === RepoStatus.DELETED) {
          status_label = "Deleted";
        } else if (status === RepoStatus.DEACTIVATED) {
          status_label = "Deactivated";
        } else if (status === RepoStatus.SUSPENDED) {
          status_label = "Suspended";
        }

        tmpBlocks.push({
          did: block.did,
          handle: handle || "[Unknown Handle]",
          uri: block.uri,
          status: actualStatus,
          status_label: status_label,
          toDelete: false,
          visible: currentToggleStates[actualStatus] ?? true,
        });
      }

      if (tmpBlocks.length === 0) {
        setGlobalNotice("All your blocked accounts are still active");
      } else {
        setGlobalNotice("");
      }

      setBlockRecords(tmpBlocks);
      setProgress(0);
      setItemCount(0);
    } else {
      setGlobalNotice("Fetching followed accounts...");
      const follows = await fetchFollows();
      setItemCount(follows.length);
      const tmpFollows: FollowRecord[] = [];
      setGlobalNotice("Analyzing followed accounts...");

      const timer = (ms: number) => new Promise((res) => setTimeout(res, ms));
      for (let i = 0; i < follows.length; i = i + 10) {
        if (follows.length > 1500) await timer(1000);
        follows.slice(i, i + 10).forEach(async (record) => {
          const follow = record.value as AppBskyGraphFollow.Main;
          const { handle, status } = await checkProfileStatus(follow.subject);

          const status_label =
            status == RepoStatus.DELETED ? "Deleted"
            : status == RepoStatus.DEACTIVATED ? "Deactivated"
            : status == RepoStatus.SUSPENDED ? "Suspended"
            : status == RepoStatus.YOURSELF ? "Literally Yourself"
            : status == RepoStatus.BLOCKING ? "Blocking"
            : status == RepoStatus.BLOCKEDBY ? "Blocked by"
            : status == RepoStatus.HIDDEN ? "Hidden by moderation service"
            : status == (RepoStatus.BLOCKEDBY | RepoStatus.BLOCKING) ? "Mutual Block"
            : status == RepoStatus.UNKNOWN ? "Unknown Status"
            : "";

          if (status !== undefined) {
            tmpFollows.push({
              did: follow.subject,
              handle: handle || "[Unknown Handle]",
              uri: record.uri,
              status: status,
              status_label: status_label,
              toDelete: false,
              visible: currentToggleStates[status] ?? true,
            });
          }
          setProgress(progress() + 1);
          if (progress() === itemCount()) {
            if (tmpFollows.length === 0) {
              setGlobalNotice("All accounts you follow are active");
            } else {
              setGlobalNotice("");
            }
            setFollowRecords(tmpFollows);
            setProgress(0);
            setItemCount(0);
          }
        });
      }
    }
  };

  const removeItems = async () => {
    const items = currentMode() === ViewMode.BLOCKS ? blockRecords : followRecords;
    const collection = currentMode() === ViewMode.BLOCKS ? "app.bsky.graph.block" : "app.bsky.graph.follow";

    const writes = items
      .filter((record) => record.toDelete)
      .map((record): $type.enforce<ComAtprotoRepoApplyWrites.Delete> => {
        return {
          $type: "com.atproto.repo.applyWrites#delete",
          collection: collection,
          rkey: record.uri.split("/").pop()!,
        };
      });

    const BATCHSIZE = 200;
    for (let i = 0; i < writes.length; i += BATCHSIZE) {
      await rpc.post("com.atproto.repo.applyWrites", {
        input: {
          repo: agentDID as ActorIdentifier,
          writes: writes.slice(i, i + BATCHSIZE),
        },
      });
    }

    if (currentMode() === ViewMode.BLOCKS) {
      setBlockRecords([]);
      setGlobalNotice(
        `Successfully cleaned up ${writes.length} inactive block${writes.length > 1 ? "s" : ""}`,
      );
    } else {
      setFollowRecords([]);
      setGlobalNotice(
        `Successfully unfollowed ${writes.length} account${writes.length > 1 ? "s" : ""}`,
      );
    }
  };

  const currentRecords = () => currentMode() === ViewMode.BLOCKS ? blockRecords : followRecords;

  return (
    <div class="flex flex-col items-center">
      <Show when={itemCount() === 0 && !currentRecords().length}>
        <button
          type="button"
          onclick={() => fetchHiddenAccounts()}
          class="rounded bg-blue-600 px-2 py-2 font-bold text-slate-100 hover:bg-blue-700"
        >
          Preview
        </button>
      </Show>
      <Show when={currentRecords().length}>
        <button
          type="button"
          onclick={() => removeItems()}
          class="rounded bg-blue-600 px-2 py-2 font-bold text-slate-100 hover:bg-blue-700"
        >
          Confirm
        </button>
      </Show>
      <Show when={globalNotice()}>
        <div class="m-3">{globalNotice()}</div>
      </Show>
      <Show when={itemCount() && progress() != itemCount()}>
        <div class="m-3">
          Progress: {progress()}/{itemCount()}
        </div>
      </Show>
    </div>
  );
};

const AccountList = () => {
  const [selectedCount, setSelectedCount] = createSignal(0);

  const currentRecords = () => currentMode() === ViewMode.BLOCKS ? blockRecords : followRecords;
  const setCurrentRecords = () => currentMode() === ViewMode.BLOCKS ? setBlockRecords : setFollowRecords;
  const currentToggleStates = () => currentMode() === ViewMode.BLOCKS ? blockToggleStates : followToggleStates;
  const setCurrentToggleStates = () => currentMode() === ViewMode.BLOCKS ? setBlockToggleStates : setFollowToggleStates;

  createEffect(() => {
    setSelectedCount(currentRecords().filter((record) => record.toDelete && record.visible).length);
  });

  function editRecords(status: RepoStatus, field: keyof AccountRecord, value: boolean) {
    const range = currentRecords()
      .map((record, index) => {
        if (record.status & status) return index;
      })
      .filter((i) => i !== undefined);
    setCurrentRecords()(range, field, value);
  }

  function updateToggleState(status: RepoStatus, value: boolean) {
    setCurrentToggleStates()(status, value);
    editRecords(status, "visible", value);
    if (!value) {
      editRecords(status, "toDelete", false);
    }
  }

  const options = () => {
    if (currentMode() === ViewMode.BLOCKS) {
      return [
        { status: RepoStatus.DELETED, label: "Deleted" },
        { status: RepoStatus.DEACTIVATED, label: "Deactivated" },
        { status: RepoStatus.SUSPENDED, label: "Suspended" },
        { status: RepoStatus.UNKNOWN, label: "Unknown" },
      ];
    } else {
      return [
        { status: RepoStatus.DELETED, label: "Deleted" },
        { status: RepoStatus.DEACTIVATED, label: "Deactivated" },
        { status: RepoStatus.SUSPENDED, label: "Suspended" },
        { status: RepoStatus.BLOCKEDBY, label: "Blocked By" },
        { status: RepoStatus.BLOCKING, label: "Blocking" },
        { status: RepoStatus.HIDDEN, label: "Hidden" },
      ];
    }
  };

  return (
    <div class="mt-6 flex flex-col sm:w-full sm:flex-row sm:justify-center">
      <div class="dark:bg-dark-500 sticky top-0 mr-5 mb-3 flex w-full flex-wrap justify-around border-b border-b-gray-400 bg-slate-100 pb-3 sm:top-3 sm:mb-0 sm:w-auto sm:flex-col sm:self-start sm:border-none">
        <For each={options()}>
          {(option, index) => (
            <div
              classList={{
                "sm:pb-2 min-w-36 sm:mb-2 mt-3 sm:mt-0": true,
                "sm:border-b sm:border-b-gray-300 dark:sm:border-b-gray-500":
                  index() < options().length - 1,
              }}
            >
              <div>
                <label class="mt-1 mb-2 inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    class="peer sr-only"
                    checked={currentToggleStates()[option.status] ?? true}
                    onChange={(e) => updateToggleState(option.status, e.currentTarget.checked)}
                  />
                  <span class="peer relative h-5 w-9 rounded-full bg-gray-200 peer-checked:bg-blue-600 peer-focus:ring-4 peer-focus:ring-blue-300 peer-focus:outline-none after:absolute after:start-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white rtl:peer-checked:after:-translate-x-full dark:border-gray-600 dark:bg-gray-700 dark:peer-focus:ring-blue-800"></span>
                  <span class="ms-3 select-none">{option.label}</span>
                </label>
              </div>
              <div class="flex items-center">
                <input
                  type="checkbox"
                  id={option.label}
                  class="h-4 w-4 rounded"
                  onChange={(e) => editRecords(option.status, "toDelete", e.currentTarget.checked)}
                />
                <label for={option.label} class="ml-2 select-none">
                  Select All
                </label>
              </div>
            </div>
          )}
        </For>
        <div class="min-w-36 pt-3 sm:pt-0">
          <span>
            Selected: {selectedCount()}/{currentRecords().length}
          </span>
        </div>
      </div>
      <div class="sm:min-w-96">
        <For each={currentRecords()}>
          {(record, index) => (
            <Show when={record.visible}>
              <div
                classList={{
                  "mb-1 flex items-center border-b border-b-gray-300 dark:border-b-gray-500 py-1": true,
                  "bg-red-300 dark:bg-rose-800": record.toDelete,
                }}
              >
                <div class="mx-2">
                  <input
                    type="checkbox"
                    id={"record" + index()}
                    class="h-4 w-4 rounded"
                    checked={record.toDelete}
                    onChange={(e) => setCurrentRecords()(index(), "toDelete", e.currentTarget.checked)}
                  />
                </div>
                <div>
                  <label for={"record" + index()} class="flex flex-col">
                    <Show when={record.handle.length}>
                      <span class="flex items-center gap-x-1">
                        @{record.handle}
                        <span class="group/tooltip relative flex items-center">
                          <a
                            class="icon-[lucide--external-link] text-sm text-blue-500 dark:text-blue-400"
                            href={`https://bsky.app/profile/${record.did}`}
                            target="_blank"
                          ></a>
                          <span class="left-50% dark:bg-dark-600 pointer-events-none absolute top-5 z-10 hidden w-[14ch] -translate-x-1/2 rounded border border-neutral-500 bg-slate-200 p-1 text-center text-xs group-hover/tooltip:block">
                            Bluesky profile
                          </span>
                        </span>
                      </span>
                    </Show>
                    <span class="flex items-center gap-x-1">
                      {record.did}
                      <span class="group/tooltip relative flex items-center">
                        <a
                          class="icon-[lucide--external-link] text-sm text-blue-500 dark:text-blue-400"
                          href={
                            record.did.startsWith("did:plc:") ?
                              `https://web.plc.directory/did/${record.did}`
                            : `https://${record.did.replace("did:web:", "")}/.well-known/did.json`
                          }
                          target="_blank"
                        ></a>
                        <span class="left-50% dark:bg-dark-600 pointer-events-none absolute top-5 z-10 hidden w-[14ch] -translate-x-1/2 rounded border border-neutral-500 bg-slate-200 p-1 text-center text-xs group-hover/tooltip:block">
                          DID document
                        </span>
                      </span>
                    </span>
                    <span>{record.status_label}</span>
                  </label>
                </div>
              </div>
            </Show>
          )}
        </For>
      </div>
    </div>
  );
};

const App = () => {
  const [theme, setTheme] = createSignal(
    (
      localStorage.theme === "dark" ||
        (!("theme" in localStorage) &&
          globalThis.matchMedia("(prefers-color-scheme: dark)").matches)
    ) ?
      "dark"
    : "light",
  );

  return (
    <div class="m-5 flex flex-col items-center text-slate-900 dark:text-slate-100">
      <div class="mb-2 flex w-[20rem] items-center">
        <div class="basis-1/3">
          <div
            class="flex w-fit items-center"
            title="Theme"
            onclick={() => {
              setTheme(theme() === "light" ? "dark" : "light");
              if (theme() === "dark") document.documentElement.classList.add("dark");
              else document.documentElement.classList.remove("dark");
              localStorage.theme = theme();
            }}
          >
            {theme() === "dark" ?
              <div class="icon-[lucide--moon] text-xl" />
            : <div class="icon-[lucide--sun] text-xl" />}
          </div>
        </div>
        <div class="basis-1/3 text-center text-xl font-bold">
          <a href="" class="hover:underline">
            cleanfollow
          </a>
        </div>
        <div class="flex basis-1/3 justify-end gap-x-2">
          <a
            class="flex items-center"
            title="GitHub"
            href="https://github.com/notjuliet/cleanfollow-bsky"
            target="_blank"
          >
            <span class="icon-[simple-icons--github] text-xl"></span>
          </a>
        </div>
      </div>
      <div class="mb-2 text-center">
        <p>Select inactive or blocked accounts to manage</p>
      </div>
      <Login />
      <Show when={loginState()}>
        <ModeSelector />
        <Fetch />
        <Show when={currentMode() === ViewMode.BLOCKS ? blockRecords.length : followRecords.length}>
          <AccountList />
        </Show>
      </Show>
    </div>
  );
};

export default App;

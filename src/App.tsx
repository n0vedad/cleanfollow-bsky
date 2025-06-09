import {
  type Component,
  createEffect,
  createSignal,
  For,
  onMount,
  Show,
} from "solid-js";
import { createStore } from "solid-js/store";

import { CredentialManager, XRPC } from "@atcute/client";
import {
  AppBskyGraphFollow,
  AppBskyGraphBlock,
  At,
  Brand,
  ComAtprotoRepoApplyWrites,
} from "@atcute/client/lexicons";
import {
  configureOAuth,
  createAuthorizationUrl,
  finalizeAuthorization,
  getSession,
  OAuthUserAgent,
  resolveFromIdentity,
  type Session,
} from "@atcute/oauth-browser-client";

// Configure OAuth client for Bluesky authentication
configureOAuth({
  metadata: {
    client_id: import.meta.env.VITE_OAUTH_CLIENT_ID,
    redirect_uri: import.meta.env.VITE_OAUTH_REDIRECT_URL,
  },
});

/**
 * Repository status flags using bitwise operations
 * This allows combining multiple states (e.g., BLOCKEDBY | BLOCKING for mutual blocks)
 */
enum RepoStatus {
  BLOCKEDBY = 1 << 0,    // Account has blocked the current user
  BLOCKING = 1 << 1,     // Current user is blocking this account
  DELETED = 1 << 2,      // Account has been deleted
  DEACTIVATED = 1 << 3,  // Account has been deactivated by user
  SUSPENDED = 1 << 4,    // Account has been suspended by platform
  HIDDEN = 1 << 5,       // Account is hidden by moderation services
  YOURSELF = 1 << 6,     // This is the current user's own account
  UNKNOWN = 1 << 7,      // Status could not be determined
}

/**
 * Result structure for profile status checks
 * Includes error information for debugging failed API calls
 */
type ProfileCheckResult = {
  handle: string;
  status?: RepoStatus;
  error?: {
    type: 'network' | 'validation' | 'api' | 'unknown';
    message: string;
    details?: any;
  };
};

/**
 * Generic account record structure used for both follows and blocks
 * Contains all necessary information for display and deletion operations
 */
type AccountRecord = {
  did: string;          // Decentralized identifier
  handle: string;       // Human-readable handle (e.g., @user.bsky.social)
  uri: string;          // AT Protocol URI for the follow/block record
  status: RepoStatus;   // Current status of the account
  status_label: string; // Human-readable status description
  toDelete: boolean;    // Whether user has selected this for deletion
  visible: boolean;     // Whether this record should be shown in UI
};

type FollowRecord = AccountRecord;
type BlockRecord = AccountRecord;

/**
 * Application view modes
 * Determines which type of cleanup operation is being performed
 */
enum ViewMode {
  FOLLOWS = "follows",  // Clean up follow list
  BLOCKS = "blocks",    // Clean up block list
}

/**
 * Toggle states for filtering different account statuses
 * Allows users to show/hide specific categories of accounts
 */
type ToggleStates = {
  [key in RepoStatus]?: boolean;
};

/**
 * Separate toggle states for follow and block modes
 * Different modes may want to show different status types
 */
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

// Global application state
const [followRecords, setFollowRecords] = createStore<FollowRecord[]>([]);
const [blockRecords, setBlockRecords] = createStore<BlockRecord[]>([]);
const [currentMode, setCurrentMode] = createSignal<ViewMode>(ViewMode.FOLLOWS);
const [loginState, setLoginState] = createSignal(false);
const [globalNotice, setGlobalNotice] = createSignal("");

// API client instances and user identification
let rpc: XRPC;
let agent: OAuthUserAgent;
let manager: CredentialManager;
let agentDID: string;

/**
 * Resolves a DID (Decentralized Identifier) to a human-readable handle
 * Supports both did:plc and did:web formats
 * 
 * @param did - The DID to resolve
 * @returns Promise<string> - The resolved handle or error message
 */
const resolveDid = async (did: string) => {
  const res = await fetch(
    did.startsWith("did:web") ?
      `https://${did.split(":")[2]}/.well-known/did.json`
    : "https://plc.directory/" + did,
  ).catch((error: unknown) => {
    console.warn("Failed to resolve DID", { error, did });
    return null;
  });
  
  if (!res) {
    return `[Failed to resolve: ${did.substring(0, 15)}...]`;
  }

  return res
    .json()
    .then((doc) => {
      // Look for AT Protocol handle in alsoKnownAs field
      for (const alias of doc.alsoKnownAs) {
        if (alias.includes("at://")) {
          return alias.split("//")[1];
        }
      }
      return "[No handle found]";
    })
    .catch((error: unknown) => {
      console.warn("Failed to parse DID document", { error, did });
      return `[Parse error: ${did.substring(0, 15)}...]`;
    });
};

/**
 * Login component handling both OAuth and App Password authentication
 * Supports automatic session restoration from localStorage
 */
const Login: Component = () => {
  const [loginInput, setLoginInput] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [handle, setHandle] = createSignal("");
  const [notice, setNotice] = createSignal("");

  onMount(async () => {
    setNotice("Loading...");

    /**
     * Initialize authentication session
     * Checks for OAuth callback parameters or existing session
     */
    const init = async (): Promise<Session | undefined> => {
      const params = new URLSearchParams(location.hash.slice(1));

      // Handle OAuth callback
      if (params.has("state") && (params.has("code") || params.has("error"))) {
        history.replaceState(null, "", location.pathname + location.search);

        const session = await finalizeAuthorization(params);
        const did = session.info.sub;

        localStorage.setItem("lastSignedIn", did);
        return session;
      } else {
        // Try to restore previous session
        const lastSignedIn = localStorage.getItem("lastSignedIn");

        if (lastSignedIn) {
          try {
            return await getSession(lastSignedIn as At.DID);
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
      rpc = new XRPC({ handler: agent });
      agentDID = agent.sub;

      setLoginState(true);
      setHandle(await resolveDid(agent.sub));
    }

    setNotice("");
  });

  /**
   * Resolves a DID to find the user's Personal Data Server (PDS)
   * Required for App Password authentication
   */
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

  /**
   * Converts a Bluesky handle to its corresponding DID
   */
  const resolveHandle = async (handle: string) => {
    const rpc = new XRPC({
      handler: new CredentialManager({
        service: "https://public.api.bsky.app",
      }),
    });
    const res = await rpc.get("com.atproto.identity.resolveHandle", {
      params: { handle: handle },
    });
    return res.data.did;
  };

  /**
   * Handles login process for both OAuth and App Password methods
   * If password is provided, uses App Password authentication
   * Otherwise, initiates OAuth flow
   */
  const loginBsky = async (login: string) => {
    if (password()) {
      // App Password authentication
      agentDID = login.startsWith("did:") ? login : await resolveHandle(login);
      manager = new CredentialManager({ service: await getPDS(agentDID) });
      rpc = new XRPC({ handler: manager });

      await manager.login({
        identifier: agentDID,
        password: password(),
      });
      setLoginState(true);
    } else {
      // OAuth authentication
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

  // Logout state
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
            class="dark:bg-dark-100 mb-2 rounded-lg border border-gray-400 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-gray-300"
            onInput={(e) => setLoginInput(e.currentTarget.value)}
          />
          <label for="password" class="ml-0.5">
            App Password
          </label>
          <input
            type="password"
            id="password"
            placeholder="leave empty for oauth"
            class="dark:bg-dark-100 mb-2 rounded-lg border border-gray-400 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-gray-300"
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

/**
 * Mode selector component for switching between follow and block cleanup
 * Resets global notices when switching to avoid confusion
 */
const ModeSelector: Component = () => {
  const handleModeChange = (mode: ViewMode) => {
    setCurrentMode(mode);
    // Reset notice when switching modes to avoid confusion
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

/**
 * Main data fetching and processing component
 * Handles both follow and block analysis with different strategies
 */
const Fetch: Component = () => {
  const [progress, setProgress] = createSignal(0);
  const [itemCount, setItemCount] = createSignal(0);

  /**
   * Checks the status of a profile by attempting to fetch it via the API
   * Maps various error conditions to appropriate RepoStatus values
   * 
   * @param did - The DID of the profile to check
   * @returns ProfileCheckResult with handle, status, and potential error info
   */
  const checkProfileStatus = async (did: string): Promise<ProfileCheckResult> => {
    let handle = "";
    let status: RepoStatus | undefined = undefined;

    try {
      const res = await rpc.get("app.bsky.actor.getProfile", {
        params: { actor: did },
      });

      // Validate API response structure
      if (!res.data || typeof res.data !== 'object') {
        console.error(`Invalid API response structure for ${did}`, res);
        return {
          handle: "[Invalid Response]",
          status: RepoStatus.UNKNOWN,
          error: {
            type: 'validation',
            message: 'API returned invalid response structure',
            details: res.data
          }
        };
      }

      if (!res.data.did || !res.data.handle) {
        console.warn(`Missing essential fields in profile response for ${did}`, res.data);
        return {
          handle: res.data.handle || "[Missing Handle]",
          status: RepoStatus.UNKNOWN,
          error: {
            type: 'validation',
            message: 'Profile response missing essential fields',
            details: { hasHandle: !!res.data.handle, hasDid: !!res.data.did }
          }
        };
      }

      handle = res.data.handle;
      
      // Analyze viewer relationship and account status
      const viewer = res.data.viewer;
      if (!viewer || typeof viewer !== 'object') {
        console.warn(`Missing or invalid viewer object for ${did}`);
      } else {
        // Check for hidden content via moderation labels
        if (res.data.labels?.some((label) => label.val === "!hide")) {
          status = RepoStatus.HIDDEN;
        // Check for block relationships
        } else if (viewer.blockedBy) {
          status =
            viewer.blocking || viewer.blockingByList ?
              RepoStatus.BLOCKEDBY | RepoStatus.BLOCKING  // Mutual block
            : RepoStatus.BLOCKEDBY;
        // Check if this is the user's own account
        } else if (res.data.did === agentDID) {
          status = RepoStatus.YOURSELF;
        // Check if user is blocking this account
        } else if (viewer.blocking || viewer.blockingByList) {
          status = RepoStatus.BLOCKING;
        }
        // If none of the above, account is considered active (status remains undefined)
      }

      return { handle, status };
      
    } catch (e: any) {
      // Resolve handle via DID document when API call fails
      handle = await resolveDid(did);

      const errorMessage = e.message || "";
      const errorStatus = e.status;
      const errorData = e.data || {};
      
      // Map specific API errors to RepoStatus values
      if (errorData.error === "AccountDeactivated" || errorMessage.includes("AccountDeactivated")) {
        status = RepoStatus.DEACTIVATED;
      } else if (errorData.error === "AccountSuspended" || errorMessage.includes("AccountSuspended")) {
        status = RepoStatus.SUSPENDED;
      } else if (errorData.error === "AccountDeleted" || errorData.error === "ActorNotFound" || errorStatus === 400) {
        status = RepoStatus.DELETED;
      } else {
        status = RepoStatus.UNKNOWN;
      }
      
      return {
        handle,
        status,
        error: {
          type: 'api',
          message: errorData.message || errorMessage || 'Profile not accessible',
          details: {
            httpStatus: errorStatus,
            errorCode: errorData.error,
            originalError: e
          }
        }
      };
    }
  };

  /**
   * Fetches all blocked accounts using the Bluesky API
   * Also retrieves the corresponding repository URIs for deletion operations
   * 
   * Block cleanup strategy:
   * 1. Get active blocks via app.bsky.graph.getBlocks
   * 2. Get all block records from user's repository
   * 3. Find blocks that exist in repo but not in active list (= deleted accounts)
   */
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

    // Fetch all active blocks
    let res = await fetchPage();
    let blocks = res.data.blocks;
    
    while (res.data.cursor) {
      res = await fetchPage(res.data.cursor);
      blocks = blocks.concat(res.data.blocks);
    }

    const blockedDids = new Set(blocks.map(b => b.did));
    
    // Fetch block records from repository to get URIs
    const blockUris: { did: string; uri: string }[] = [];
    let recordsCursor: string | undefined;
    
    do {
      try {
        const recordsRes = await rpc.get("com.atproto.repo.listRecords", {
          params: {
            repo: agentDID,
            collection: "app.bsky.graph.block",
            limit: 100,
            cursor: recordsCursor,
          },
        });

        for (const record of recordsRes.data.records) {
          const blockRecord = record.value as AppBskyGraphBlock.Record;
          
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

  /**
   * Fetches all follow records from the user's repository
   * Returns complete records including URIs needed for deletion
   */
  const fetchFollows = async () => {
    const PAGE_LIMIT = 100;
    const fetchPage = async (cursor?: string) => {
      return await rpc.get("com.atproto.repo.listRecords", {
        params: {
          repo: agentDID,
          collection: "app.bsky.graph.follow",
          limit: PAGE_LIMIT,
          cursor: cursor,
        },
      });
    };

    let res = await fetchPage();
    let follows = res.data.records;
    
    while (res.data.cursor && res.data.records.length >= PAGE_LIMIT) {
      res = await fetchPage(res.data.cursor);
      follows = follows.concat(res.data.records);
    }

    return follows;
  };

  /**
   * Main function to analyze accounts and identify those that should be cleaned up
   * Uses different strategies for blocks vs follows:
   * 
   * Block mode: Only analyzes non-existent blocks
   * Follow mode: Analyzes all follows to find various states
   */
  const fetchHiddenAccounts = async () => {
    setProgress(0);
    
    // Get current toggle states for the active mode
    const currentToggleStates = currentMode() === ViewMode.BLOCKS ? blockToggleStates : followToggleStates;
    
    if (currentMode() === ViewMode.BLOCKS) {
      // Block cleanup: Only analyze non-existent blocks for efficiency
      const allBlockRecords: { did: string; uri: string }[] = [];
      let cursor: string | undefined;
      
      setGlobalNotice("Fetching blocked accounts...");
      
      // Get all block records from repository
      do {
        const res = await rpc.get("com.atproto.repo.listRecords", {
          params: {
            repo: agentDID,
            collection: "app.bsky.graph.block",
            limit: 100,
            cursor: cursor,
          },
        });
        
        for (const record of res.data.records) {
          const blockRecord = record.value as AppBskyGraphBlock.Record;
          allBlockRecords.push({
            did: blockRecord.subject,
            uri: record.uri,
          });
        }
        
        cursor = res.data.cursor;
      } while (cursor);
      
      // Find blocks that no longer exist
      const activeBlocks = await fetchBlocks();
      const activeDids = new Set(activeBlocks.map(b => b.did));
      
      const blocksToDelete = allBlockRecords.filter(record => !activeDids.has(record.did));
      
      setItemCount(blocksToDelete.length);
      const tmpBlocks: BlockRecord[] = [];
      setGlobalNotice("Analyzing blocked accounts...");
      
      let deletedCount = 0, deactivatedCount = 0, suspendedCount = 0, unknownCount = 0;
      
      // Rate limiting: small delay between batches
      const timer = (ms: number) => new Promise((res) => setTimeout(res, ms));
      
      for (let i = 0; i < blocksToDelete.length; i++) {
        if (i > 0 && i % 10 === 0) {
          await timer(100);
        }
        
        const block = blocksToDelete[i];
        setProgress(i + 1);
        
        const { handle, status } = await checkProfileStatus(block.did);
        
        let status_label = "Unknown";
        let actualStatus = RepoStatus.UNKNOWN;
        
        // Categorize the account status
        if (status === RepoStatus.DELETED) {
          status_label = "Deleted";
          actualStatus = RepoStatus.DELETED;
          deletedCount++;
        } else if (status === RepoStatus.DEACTIVATED) {
          status_label = "Deactivated";
          actualStatus = RepoStatus.DEACTIVATED;
          deactivatedCount++;
        } else if (status === RepoStatus.SUSPENDED) {
          status_label = "Suspended";
          actualStatus = RepoStatus.SUSPENDED;
          suspendedCount++;
        } else {
          unknownCount++;
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
      // Follow mode: Check all follows for various problematic states
      setGlobalNotice("Fetching followed accounts...");
      const follows = await fetchFollows();
      setItemCount(follows.length);
      const tmpFollows: FollowRecord[] = [];
      setGlobalNotice("Analyzing followed accounts...");

      // Process follows in batches with rate limiting for large lists
      const timer = (ms: number) => new Promise((res) => setTimeout(res, ms));
      for (let i = 0; i < follows.length; i = i + 10) {
        if (follows.length > 1000) await timer(1000);
        follows.slice(i, i + 10).forEach(async (record) => {
          const follow = record.value as AppBskyGraphFollow.Record;
          const result = await checkProfileStatus(follow.subject);
          
          if (result.error) {
            console.warn(`Error checking follow ${follow.subject}:`, result.error);
          }

          // Map status to human-readable labels
          const status_label =
            result.status == RepoStatus.DELETED ? "Deleted"
            : result.status == RepoStatus.DEACTIVATED ? "Deactivated"
            : result.status == RepoStatus.SUSPENDED ? "Suspended"
            : result.status == RepoStatus.YOURSELF ? "Literally Yourself"
            : result.status == RepoStatus.BLOCKING ? "Blocking"
            : result.status == RepoStatus.BLOCKEDBY ? "Blocked by"
            : result.status == RepoStatus.HIDDEN ? "Hidden by moderation service"
            : result.status == (RepoStatus.BLOCKEDBY | RepoStatus.BLOCKING) ? "Mutual Block"
            : result.status == RepoStatus.UNKNOWN ? "Unknown Status"
            : "";

          // Only add accounts that have problematic statuses
          if (result.status !== undefined) {
            tmpFollows.push({
              did: follow.subject,
              handle: result.handle || "[Unknown Handle]",
              uri: record.uri,
              status: result.status,
              status_label: status_label,
              toDelete: false,
              visible: currentToggleStates[result.status] ?? true,
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

  /**
   * Removes selected items using AT Protocol's batch write operations
   * Uses efficient batching to handle large numbers of deletions
   */
  const removeItems = async () => {
    const items = currentMode() === ViewMode.BLOCKS ? blockRecords : followRecords;
    const collection = currentMode() === ViewMode.BLOCKS ? "app.bsky.graph.block" : "app.bsky.graph.follow";
    
    // Build deletion operations for selected items
    const writes = items
      .filter((record) => record.toDelete)
      .map((record): Brand.Union<ComAtprotoRepoApplyWrites.Delete> => {
        return {
          $type: "com.atproto.repo.applyWrites#delete",
          collection: collection,
          rkey: record.uri.split("/").pop()!,  // Extract record key from URI
        };
      });

    // Process deletions in batches to avoid API limits
    const BATCHSIZE = 200;
    for (let i = 0; i < writes.length; i += BATCHSIZE) {
      await rpc.call("com.atproto.repo.applyWrites", {
        data: {
          repo: agentDID,
          writes: writes.slice(i, i + BATCHSIZE),
        },
      });
    }

    // Clear results and show success message
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

/**
 * Account list component with filtering and selection controls
 * Provides toggle switches for each account status type and bulk selection
 * Uses consistent reactive abstractions for mode-independent operations
 */
const AccountList: Component = () => {
  const [selectedCount, setSelectedCount] = createSignal(0);
  
  /**
   * Reactive abstractions for current mode operations
   * These functions automatically select the correct stores based on currentMode()
   * This pattern ensures consistency and makes the code mode-agnostic
   */
  const currentRecords = () => currentMode() === ViewMode.BLOCKS ? blockRecords : followRecords;
  const setCurrentRecords = () => currentMode() === ViewMode.BLOCKS ? setBlockRecords : setFollowRecords;
  const currentToggleStates = () => currentMode() === ViewMode.BLOCKS ? blockToggleStates : followToggleStates;
  const setCurrentToggleStates = () => currentMode() === ViewMode.BLOCKS ? setBlockToggleStates : setFollowToggleStates;

  // Track number of selected items for display
  createEffect(() => {
    setSelectedCount(currentRecords().filter((record) => record.toDelete && record.visible).length);
  });

  /**
   * Bulk edit records by status using bitwise operations
   * Allows operations like "select all deleted accounts"
   */
  function editRecords(
    status: RepoStatus,
    field: keyof AccountRecord,
    value: boolean,
  ) {
    const range = currentRecords()
      .map((record, index) => {
        if (record.status & status) return index;  // Bitwise AND to check status flags
      })
      .filter((i) => i !== undefined);
    setCurrentRecords()(range, field, value);
  }

  /**
   * Updates toggle state for a specific status type using the abstracted setter
   * Also updates visibility of affected records for consistent behavior
   */
  function updateToggleState(status: RepoStatus, value: boolean) {
    setCurrentToggleStates()(status, value);
    // Update visibility of records with this status
    editRecords(status, "visible", value);
  }

  /**
   * Returns appropriate options for the current mode
   * Block mode and follow mode show different status types
   */
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
      {/* Filter controls sidebar */}
      <div class="dark:bg-dark-500 sticky top-0 mb-3 mr-5 flex w-full flex-wrap justify-around border-b border-b-gray-400 bg-slate-100 pb-3 sm:top-3 sm:mb-0 sm:w-auto sm:flex-col sm:self-start sm:border-none">
        <For each={options()}>
          {(option, index) => (
            <div
              classList={{
                "sm:pb-2 min-w-36 sm:mb-2 mt-3 sm:mt-0": true,
                "sm:border-b sm:border-b-gray-300 dark:sm:border-b-gray-500":
                  index() < options().length - 1,
              }}
            >
              {/* Toggle switch for visibility */}
              <div>
                <label class="mb-2 mt-1 inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    class="peer sr-only"
                    checked={currentToggleStates()[option.status] ?? true}
                    onChange={(e) =>
                      updateToggleState(
                        option.status,
                        e.currentTarget.checked
                      )
                    }
                  />
                  <span class="peer relative h-5 w-9 rounded-full bg-gray-200 after:absolute after:start-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-gray-300 peer-checked:peer-focus:ring-blue-300 rtl:peer-checked:after:-translate-x-full dark:border-gray-600 dark:bg-gray-700 dark:peer-focus:ring-gray-600 dark:peer-checked:peer-focus:ring-blue-800"></span>
                  <span class="ms-3 select-none">{option.label}</span>
                </label>
              </div>
              {/* Select all checkbox for this status */}
              <div class="flex items-center">
                <input
                  type="checkbox"
                  id={option.label}
                  class="h-4 w-4 rounded"
                  onChange={(e) =>
                    editRecords(
                      option.status,
                      "toDelete",
                      e.currentTarget.checked,
                    )
                  }
                />
                <label for={option.label} class="ml-2 select-none">
                  Select All
                </label>
              </div>
            </div>
          )}
        </For>
        {/* Selection counter */}
        <div class="min-w-36 pt-3 sm:pt-0">
          <span>
            Selected: {selectedCount()}/{currentRecords().length}
          </span>
        </div>
      </div>
      
      {/* Account list */}
      <div class="sm:min-w-96">
        <For each={currentRecords()}>
          {(record, index) => (
            <Show when={record.visible}>
              <div
                classList={{
                  "mb-1 flex items-center border-b dark:border-b-gray-500 py-1":
                    true,
                  "bg-red-300 dark:bg-rose-800": record.toDelete,  // Highlight selected items
                }}
              >
                {/* Selection checkbox */}
                <div class="mx-2">
                  <input
                    type="checkbox"
                    id={"record" + index()}
                    class="h-4 w-4 rounded"
                    checked={record.toDelete}
                    onChange={(e) =>
                      setCurrentRecords()(
                        index(),
                        "toDelete",
                        e.currentTarget.checked,
                      )
                    }
                  />
                </div>
                {/* Account information */}
                <div>
                  <label for={"record" + index()} class="flex flex-col">
                    {/* Handle with Bluesky profile link */}
                    <Show when={record.handle.length}>
                      <span class="flex items-center gap-x-1">
                        @{record.handle}
                        <a
                          href={`https://bsky.app/profile/${record.did}`}
                          target="_blank"
                          class="group/tooltip relative flex items-center"
                        >
                          <button class="i-tabler-external-link text-sm text-blue-500 dark:text-blue-400" />
                          <span class="left-50% dark:bg-dark-600 pointer-events-none absolute top-5 z-10 hidden w-[14ch] -translate-x-1/2 rounded border border-neutral-500 bg-slate-200 p-1 text-center text-xs group-hover/tooltip:block">
                            Bluesky profile
                          </span>
                        </a>
                      </span>
                    </Show>
                    {/* DID with link to DID document */}
                    <span class="flex items-center gap-x-1">
                      {record.did}
                      <a
                        href={
                          record.did.startsWith("did:plc:") ?
                            `https://web.plc.directory/did/${record.did}`
                          : `https://${record.did.replace("did:web:", "")}/.well-known/did.json`
                        }
                        target="_blank"
                        class="group/tooltip relative flex items-center"
                      >
                        <button class="i-tabler-external-link text-sm text-blue-500 dark:text-blue-400" />
                        <span class="left-50% dark:bg-dark-600 pointer-events-none absolute top-5 z-10 hidden w-[14ch] -translate-x-1/2 rounded border border-neutral-500 bg-slate-200 p-1 text-center text-xs group-hover/tooltip:block">
                          DID document
                        </span>
                      </a>
                    </span>
                    {/* Status label */}
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

/**
 * Main application component
 * Handles theme switching and coordinates all other components
 */
const App: Component = () => {
  // Initialize theme from localStorage or system preference
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
      {/* Header with theme toggle and external links */}
      <div class="mb-2 flex w-[20rem] items-center">
        <div class="basis-1/3">
          <div
            class="w-fit cursor-pointer"
            title="Theme"
            onclick={() => {
              setTheme(theme() === "light" ? "dark" : "light");
              if (theme() === "dark")
                document.documentElement.classList.add("dark");
              else document.documentElement.classList.remove("dark");
              localStorage.theme = theme();
            }}
          >
            {theme() === "dark" ?
              <div class="i-tabler-moon-stars text-xl" />
            : <div class="i-tabler-sun text-xl" />}
          </div>
        </div>
        <div class="basis-1/3 text-center text-xl font-bold">
          <a href="" class="hover:underline">
            cleanfollow
          </a>
        </div>
        <div class="justify-right flex basis-1/3 gap-x-2">
          <a
            title="GitHub"
            href="https://github.com/notjuliet/cleanfollow-bsky"
            target="_blank"
          >
            <button class="i-bi-github text-xl" />
          </a>
          <a title="Donate" href="https://ko-fi.com/notjuliet" target="_blank">
            <button class="i-simple-icons-kofi text-xl" />
          </a>
        </div>
      </div>
      <div class="mb-2 text-center">
        <p>Select inactive or blocked accounts to manage</p>
      </div>
      
      {/* Main application flow */}
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
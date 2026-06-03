/**
 * Per-mode configuration ("tab strategy"). Bundles everything that differs
 * between the follows and blocks tabs behind one object so the shared components
 * read `currentTab().<x>` instead of branching on the mode everywhere.
 */

import type { SetStoreFunction } from "solid-js/store";

import { analyzeBlocks } from "./analysis/blocks";
import { analyzeFollows } from "./analysis/follows";
import {
  blockRecords,
  blockToggleStates,
  currentMode,
  followRecords,
  followToggleStates,
  setBlockRecords,
  setBlockToggleStates,
  setFollowRecords,
  setFollowToggleStates,
} from "./state";
import { RepoStatus, ViewMode, type AccountRecord, type ToggleStates } from "./types";

/**
 * Everything the shared UI needs that varies between the two tabs.
 *
 * @property records - Analyzed records store for this tab.
 * @property setRecords - Setter for the records store.
 * @property toggleStates - Visibility toggles store for this tab.
 * @property setToggleStates - Setter for the toggles store.
 * @property options - Status filter options shown in the sidebar.
 * @property collection - Collection NSID records are deleted from.
 * @property analyze - Analyze the repo and populate `records`.
 * @property successMessage - Build the success notice after a delete, given the deleted count.
 */
export type TabConfig = {
  records: () => AccountRecord[];
  setRecords: SetStoreFunction<AccountRecord[]>;
  toggleStates: ToggleStates;
  setToggleStates: SetStoreFunction<ToggleStates>;
  options: { status: RepoStatus; label: string }[];
  collection: "app.bsky.graph.follow" | "app.bsky.graph.block";
  analyze: () => Promise<void>;
  successMessage: (count: number) => string;
};

/** Tab configuration keyed by mode. */
export const tabs: Record<ViewMode, TabConfig> = {
  [ViewMode.FOLLOWS]: {
    records: () => followRecords,
    setRecords: setFollowRecords,
    toggleStates: followToggleStates,
    setToggleStates: setFollowToggleStates,
    options: [
      { status: RepoStatus.DELETED, label: "Deleted" },
      { status: RepoStatus.DEACTIVATED, label: "Deactivated" },
      { status: RepoStatus.SUSPENDED, label: "Suspended" },
      { status: RepoStatus.BLOCKEDBY, label: "Blocked By" },
      { status: RepoStatus.BLOCKING, label: "Blocking" },
      { status: RepoStatus.HIDDEN, label: "Hidden" },
    ],
    collection: "app.bsky.graph.follow",
    analyze: analyzeFollows,
    successMessage: (count) => `Successfully unfollowed ${count} account${count > 1 ? "s" : ""}`,
  },
  [ViewMode.BLOCKS]: {
    records: () => blockRecords,
    setRecords: setBlockRecords,
    toggleStates: blockToggleStates,
    setToggleStates: setBlockToggleStates,
    options: [
      { status: RepoStatus.DELETED, label: "Deleted" },
      { status: RepoStatus.DEACTIVATED, label: "Deactivated" },
      { status: RepoStatus.SUSPENDED, label: "Suspended" },
      { status: RepoStatus.UNKNOWN, label: "Unknown" },
    ],
    collection: "app.bsky.graph.block",
    analyze: analyzeBlocks,
    successMessage: (count) =>
      `Successfully cleaned up ${count} inactive block${count > 1 ? "s" : ""}`,
  },
};

/** The active tab's configuration, reactive on `currentMode`. */
export const currentTab = () => tabs[currentMode()];

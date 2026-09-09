/** Reactive UI state shared across components and the analysis pipelines. */

import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";

import { RepoStatus, ViewMode, type AccountRecord, type ToggleStates } from "./types";

// Default filter toggles: which statuses are visible when results first load.
export const [followToggleStates, setFollowToggleStates] = createStore<ToggleStates>({
  [RepoStatus.DELETED]: true,
  [RepoStatus.DEACTIVATED]: true,
  [RepoStatus.SUSPENDED]: true,
  [RepoStatus.BLOCKEDBY]: true,
  [RepoStatus.BLOCKING]: true,
  [RepoStatus.MUTUALBLOCK]: true,
  [RepoStatus.HIDDEN]: true,
  [RepoStatus.YOURSELF]: true,
});

export const [blockToggleStates, setBlockToggleStates] = createStore<ToggleStates>({
  [RepoStatus.DELETED]: true,
  [RepoStatus.DEACTIVATED]: true,
  [RepoStatus.SUSPENDED]: true,
});

// Analyzed results.
export const [followRecords, setFollowRecords] = createStore<AccountRecord[]>([]);
export const [blockRecords, setBlockRecords] = createStore<AccountRecord[]>([]);

// Global UI state.
export const [currentMode, setCurrentMode] = createSignal<ViewMode>(ViewMode.FOLLOWS);
export const [loginState, setLoginState] = createSignal(false);
export const [globalNotice, setGlobalNotice] = createSignal("");

// Progress reporting during analysis.
export const [progress, setProgress] = createSignal(0);
export const [itemCount, setItemCount] = createSignal(0);
export const [failedProfiles, setFailedProfiles] = createSignal(0);

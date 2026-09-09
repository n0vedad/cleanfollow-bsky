/** Domain types shared across the app. */

/**
 * Status of a followed/blocked account, stored as bit flags so combined states
 * (currently only `MUTUALBLOCK`) can be expressed as a single value.
 */
export enum RepoStatus {
  BLOCKEDBY = 1 << 0,
  BLOCKING = 1 << 1,
  DELETED = 1 << 2,
  DEACTIVATED = 1 << 3,
  SUSPENDED = 1 << 4,
  HIDDEN = 1 << 5,
  YOURSELF = 1 << 6,
  /**
   * Both parties block each other. A combination rather than a raw flag, but
   * treated as a category of its own: filters match a status exactly, so a
   * mutual block never shows up under `BLOCKING` or `BLOCKEDBY`.
   */
  MUTUALBLOCK = BLOCKEDBY | BLOCKING,
}

/**
 * A single follow/block record together with its analyzed status and UI state.
 *
 * @property did - DID of the followed/blocked subject account.
 * @property handle - Handle of the subject account, or "" if it couldn't be resolved.
 * @property uri - `at://` URI of the follow/block record; its rkey is the delete target.
 * @property status - Analyzed status as `RepoStatus` bit flags.
 * @property status_label - Human-readable label for `status`.
 * @property toDelete - Whether the user has selected this record for deletion.
 * @property visible - Whether this record is shown under the current filter toggles.
 */
export type AccountRecord = {
  did: string;
  handle: string;
  uri: string;
  status: RepoStatus;
  status_label: string;
  toDelete: boolean;
  visible: boolean;
};

// Follows and blocks share the same record shape.
export type FollowRecord = AccountRecord;
export type BlockRecord = AccountRecord;

/** Which collection the UI is currently operating on. */
export enum ViewMode {
  FOLLOWS = "follows",
  BLOCKS = "blocks",
}

/** Per-status visibility toggles controlling which records are shown. */
export type ToggleStates = {
  [key in RepoStatus]?: boolean;
};

/**
 * Map a `RepoStatus` to its human-readable label.
 * @param status - the status to label
 * @returns the label, or "" if the status matches no known category
 */
export const getStatusLabel = (status: RepoStatus) => {
  if (status === RepoStatus.DELETED) return "Deleted";
  if (status === RepoStatus.DEACTIVATED) return "Deactivated";
  if (status === RepoStatus.SUSPENDED) return "Suspended";
  if (status === RepoStatus.YOURSELF) return "Literally Yourself";
  if (status === RepoStatus.HIDDEN) return "Hidden by moderation service";
  if (status === RepoStatus.MUTUALBLOCK) return "Mutual Block";
  if (status === RepoStatus.BLOCKING) return "Blocking";
  if (status === RepoStatus.BLOCKEDBY) return "Blocked by";
  return "";
};

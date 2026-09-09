/** Preview/confirm controls: analyzes the repo and triggers the batch delete. */

import { ComAtprotoRepoApplyWrites } from "@atcute/atproto";
import { $type, ActorIdentifier } from "@atcute/lexicons";
import { Show } from "solid-js";

import { agentDID, rpc } from "../session";
import { failedProfiles, globalNotice, itemCount, progress, setGlobalNotice } from "../state";
import { currentTab } from "../tabs";

export const Fetch = () => {
  /** Records for the active mode. */
  const currentRecords = () => currentTab().records();

  /**
   * Delete every record marked `toDelete` from the user's repo via batched
   * applyWrites calls, then clear the list and report the outcome.
   */
  const removeItems = async () => {
    const tab = currentTab();
    const items = tab.records();

    const writes = items
      .filter((record) => record.toDelete)
      .map((record): $type.enforce<ComAtprotoRepoApplyWrites.Delete> => {
        return {
          $type: "com.atproto.repo.applyWrites#delete",
          collection: tab.collection,
          rkey: record.uri.split("/").pop()!,
        };
      });

    try {
      const BATCHSIZE = 200;
      for (let i = 0; i < writes.length; i += BATCHSIZE) {
        const batch = writes.slice(i, i + BATCHSIZE);

        const res = await rpc.post("com.atproto.repo.applyWrites", {
          input: {
            repo: agentDID as ActorIdentifier,
            writes: batch,
          },
        });

        if (!res.ok) {
          const errorData = res.data as any;
          setGlobalNotice(
            `Error: ${errorData.message || errorData.error || "Failed to delete items"}`,
          );
          return;
        }
      }

      tab.setRecords([]);
      setGlobalNotice(tab.successMessage(writes.length));
    } catch (error) {
      console.error("Error deleting items:", error);
      setGlobalNotice(`Error: ${error}`);
    }
  };

  return (
    <div class="flex flex-col items-center">
      <Show when={itemCount() === 0 && !currentRecords().length}>
        <button
          type="button"
          onclick={() => currentTab().analyze()}
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
          {failedProfiles() > 0 && (
            <span class="text-orange-600 dark:text-orange-400"> ({failedProfiles()} failed)</span>
          )}
        </div>
      </Show>
    </div>
  );
};

/** Filterable, selectable list of analyzed records with bulk select-by-status. */

import { createEffect, createSignal, For, Show } from "solid-js";

import { currentTab } from "../tabs";
import { RepoStatus, type AccountRecord } from "../types";

export const AccountList = () => {
  const [selectedCount, setSelectedCount] = createSignal(0);

  // Accessors that target the store/toggles/options for the active tab.
  const currentRecords = () => currentTab().records();
  const setCurrentRecords = () => currentTab().setRecords;
  const currentToggleStates = () => currentTab().toggleStates;
  const setCurrentToggleStates = () => currentTab().setToggleStates;
  const options = () => currentTab().options;

  createEffect(() => {
    setSelectedCount(currentRecords().filter((record) => record.toDelete && record.visible).length);
  });

  /**
   * Apply a field change to every record whose status includes the given flag.
   * @param status - status bit to match
   * @param field - record field to set
   * @param value - new value
   */
  function editRecords(status: RepoStatus, field: keyof AccountRecord, value: boolean) {
    const range = currentRecords()
      .map((record, index) => {
        if (record.status & status) return index;
      })
      .filter((i) => i !== undefined);
    setCurrentRecords()(range, field, value);
  }

  /**
   * Toggle visibility for a status. Hiding a status also clears its pending
   * deletions so records the user can no longer see can't be deleted.
   * @param status - status flag whose visibility is changing
   * @param value - new visibility state
   */
  function updateToggleState(status: RepoStatus, value: boolean) {
    setCurrentToggleStates()(status, value);
    editRecords(status, "visible", value);
    if (!value) {
      editRecords(status, "toDelete", false);
    }
  }

  return (
    <div class="mt-6 flex flex-col sm:w-full sm:flex-row sm:justify-center">
      <div class="dark:bg-dark-500 sticky top-0 z-30 mr-5 mb-3 flex w-full flex-wrap justify-around border-b border-b-gray-400 bg-slate-100 pb-3 sm:top-3 sm:mb-0 sm:w-auto sm:flex-col sm:self-start sm:border-none">
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
                  <span class="peer relative h-5 w-9 rounded-full bg-gray-200 peer-checked:bg-blue-600 peer-focus:ring-4 peer-focus:ring-blue-300 peer-focus:outline-none after:absolute after:start-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white rtl:peer-checked:after:-translate-x-full dark:border-gray-600 dark:bg-gray-700 dark:peer-focus:ring-blue-800"></span>
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

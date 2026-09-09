/** Tab switcher between the "clean follows" and "clean blocks" modes. */

import { currentMode, setCurrentMode, setGlobalNotice } from "../state";
import { ViewMode } from "../types";

export const ModeSelector = () => {
  /**
   * Switch the active mode and clear any global notice.
   * @param mode - the mode to switch to
   */
  const handleModeChange = (mode: ViewMode) => {
    setCurrentMode(mode);
    setGlobalNotice("");
  };

  return (
    <div class="mb-4 flex gap-4">
      <button
        onclick={() => handleModeChange(ViewMode.FOLLOWS)}
        class={`rounded px-4 py-2 font-semibold transition-colors ${
          currentMode() === ViewMode.FOLLOWS ?
            "bg-blue-600 text-white"
          : "bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
        }`}
      >
        Clean Follows
      </button>
      <button
        onclick={() => handleModeChange(ViewMode.BLOCKS)}
        class={`rounded px-4 py-2 font-semibold transition-colors ${
          currentMode() === ViewMode.BLOCKS ?
            "bg-blue-600 text-white"
          : "bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
        }`}
      >
        Clean Blocks
      </button>
    </div>
  );
};

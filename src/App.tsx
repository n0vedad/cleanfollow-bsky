/**
 * cleanfollow-bsky — bulk-manage a Bluesky account's follows and blocks.
 *
 * The user logs in (OAuth or app password), previews follows/blocks whose target
 * accounts are inactive (deleted, deactivated, suspended) or involved in a block
 * relationship, and batch-deletes the selected records from their repo.
 *
 * This module is just composition; see:
 * - `state.ts` / `session.ts` — shared reactive state and authenticated clients
 * - `tabs.ts` — per-mode configuration that drives the shared components
 * - `analysis/` — the follows and blocks analysis pipelines
 * - `components/` — Login, ModeSelector, Fetch, AccountList
 */

import { createSignal, Show } from "solid-js";

// configureOAuth side effect — must run before any OAuth call.
import "./oauth";

import { AccountList } from "./components/AccountList";
import { Fetch } from "./components/Fetch";
import { Login } from "./components/Login";
import { ModeSelector } from "./components/ModeSelector";
import { blockRecords, currentMode, followRecords, loginState } from "./state";
import { ViewMode } from "./types";

/** Root component: header with theme toggle, plus the logged-in/out layout. */
const App = () => {
  // Initial theme from localStorage, falling back to the OS color-scheme preference.
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

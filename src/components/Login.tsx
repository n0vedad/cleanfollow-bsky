/** Login form plus session bootstrap (OAuth callback / resume, app-password login). */

import { Did } from "@atcute/lexicons";
import { isDid, isHandle } from "@atcute/lexicons/syntax";
import {
  createAuthorizationUrl,
  finalizeAuthorization,
  getSession,
  type Session,
} from "@atcute/oauth-browser-client";
import { PasswordSession } from "@atcute/password-session";
import { createSignal, onMount, Show } from "solid-js";

import { getPDS, resolveDid, resolveHandle } from "../identity";
import { signOut, useOAuthSession, usePasswordSession } from "../session";
import { loginState, setLoginState } from "../state";

export const Login = () => {
  const [loginInput, setLoginInput] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [handle, setHandle] = createSignal("");
  const [notice, setNotice] = createSignal("");

  onMount(async () => {
    setNotice("Loading...");

    // Finish an OAuth redirect if its params are in the URL fragment,
    // otherwise resume the last session stored in localStorage.
    const init = async (): Promise<Session | undefined> => {
      const params = new URLSearchParams(decodeURIComponent(location.hash.slice(1)));

      if (params.has("state") && (params.has("code") || params.has("error"))) {
        history.replaceState(null, "", location.pathname + location.search);

        const auth = await finalizeAuthorization(params);
        const did = auth.session.info.sub;

        localStorage.setItem("lastSignedIn", did);
        return auth.session;
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
      const did = useOAuthSession(session);
      setLoginState(true);
      setHandle(await resolveDid(did));
    }

    setNotice("");
  });

  /**
   * Log in with the given identifier. If a password was entered, use the
   * app-password flow (PasswordSession); otherwise start the OAuth redirect flow.
   * @param login - handle, DID, or PDS URL
   */
  const loginBsky = async (login: string) => {
    if (password()) {
      const did = login.startsWith("did:") ? login : await resolveHandle(login);
      const session = await PasswordSession.login({
        service: await getPDS(did),
        identifier: did,
        password: password(),
      });
      usePasswordSession(session, did);
      setLoginState(true);
    } else {
      try {
        setNotice(`Redirecting...`);
        const authUrl = await createAuthorizationUrl({
          scope: import.meta.env.VITE_OAUTH_SCOPE,
          target:
            isHandle(login) || isDid(login) ?
              { type: "account", identifier: login }
            : { type: "pds", serviceUrl: login },
        });

        await new Promise((resolve) => setTimeout(resolve, 250));

        location.assign(authUrl);
      } catch (err) {
        console.error("OAuth login failed:", err);
        setNotice("Error during OAuth login");
      }
    }
  };

  /** Sign out of the current OAuth session and return to the login form. */
  const logoutBsky = async () => {
    await signOut();
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

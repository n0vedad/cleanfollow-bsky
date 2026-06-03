/**
 * Authenticated session singletons, assigned once the user logs in.
 *
 * - `rpc` — XRPC client bound to the user's PDS (no service proxy).
 * - `appviewRpc` — XRPC client that proxies `app.bsky.*` reads to the AppView.
 * - `agent` — agent for the OAuth login path.
 * - `manager` — handler for the app-password login path.
 * - `agentDID` — DID of the currently logged-in account.
 *
 * These are ESM live bindings: the setters below reassign them and importers
 * see the updated values.
 */

import { Client } from "@atcute/client";
import { OAuthUserAgent, type Session } from "@atcute/oauth-browser-client";
import { PasswordSession } from "@atcute/password-session";

export let rpc: Client;
export let appviewRpc: Client;
export let agent: OAuthUserAgent;
export let manager: PasswordSession;
export let agentDID: string;

/**
 * Wire up the clients for an OAuth session.
 * @param session - the finalized/resumed OAuth session
 * @returns the logged-in account DID
 */
export const useOAuthSession = (session: Session): string => {
  agent = new OAuthUserAgent(session);
  rpc = new Client({ handler: agent });
  // Reads of app.bsky.* are proxied to the AppView via the `atproto-proxy`
  // header; in @atcute/client v5 this is a `<did>#<service>` string.
  appviewRpc = new Client({
    handler: agent,
    proxy: "did:web:api.bsky.app#bsky_appview",
  });
  agentDID = agent.sub;
  return agentDID;
};

/**
 * Wire up the clients for an app-password session.
 * @param session - the authenticated PasswordSession
 * @param did - the logged-in account DID
 */
export const usePasswordSession = (session: PasswordSession, did: string): void => {
  manager = session;
  agentDID = did;
  rpc = new Client({ handler: manager });
  appviewRpc = rpc;
};

/** Sign out of the current OAuth session. */
export const signOut = () => agent.signOut();

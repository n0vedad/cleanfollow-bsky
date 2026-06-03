/** Unauthenticated identity helpers (handle ↔ DID ↔ PDS) backed by DID documents. */

import { Client, simpleFetchHandler } from "@atcute/client";
import { Handle } from "@atcute/lexicons";

/**
 * Resolve a DID to its primary handle by reading its DID document
 * (did:web from the host's well-known endpoint, otherwise from plc.directory).
 * @param did - the account DID to resolve
 * @returns the handle without the `at://` prefix, or "" if it can't be resolved
 */
export const resolveDid = async (did: string) => {
  const res = await fetch(
    did.startsWith("did:web") ?
      `https://${did.split(":")[2]}/.well-known/did.json`
    : "https://plc.directory/" + did,
  ).catch((error: unknown) => {
    console.warn("Failed to resolve DID", { error, did });
  });
  if (!res) return "";

  return res
    .json()
    .then((doc) => {
      for (const alias of doc.alsoKnownAs) {
        if (alias.includes("at://")) {
          return alias.split("//")[1];
        }
      }
    })
    .catch((error: unknown) => {
      console.warn("Failed to parse DID", { error, did });
      return "";
    });
};

/**
 * Look up the PDS service endpoint from an account's DID document.
 * @param did - the account DID
 * @returns the PDS base URL
 */
export const getPDS = async (did: string) => {
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
 * Resolve a handle to a DID via the public AppView (unauthenticated).
 * @param handle - the handle to resolve
 * @returns the resolved DID
 */
export const resolveHandle = async (handle: string) => {
  const rpc = new Client({
    handler: simpleFetchHandler({
      service: "https://public.api.bsky.app",
    }),
  });
  const res = await rpc.get("com.atproto.identity.resolveHandle", {
    params: { handle: handle as Handle },
  });
  if (!res.ok) throw new Error(res.data.error);
  return res.data.did;
};

/**
 * Global OAuth client configuration. Imported for its side effect — `configureOAuth`
 * must run once before any OAuth call. Identities are resolved client-side: handles
 * via the public AppView, DID documents via PLC and did:web.
 */

import {
  CompositeDidDocumentResolver,
  LocalActorResolver,
  PlcDidDocumentResolver,
  WebDidDocumentResolver,
  XrpcHandleResolver,
} from "@atcute/identity-resolver";
import { configureOAuth } from "@atcute/oauth-browser-client";

configureOAuth({
  metadata: {
    client_id: import.meta.env.VITE_OAUTH_CLIENT_ID,
    redirect_uri: import.meta.env.VITE_OAUTH_REDIRECT_URL,
  },
  identityResolver: new LocalActorResolver({
    handleResolver: new XrpcHandleResolver({ serviceUrl: "https://public.api.bsky.app" }),

    didDocumentResolver: new CompositeDidDocumentResolver({
      methods: {
        plc: new PlcDidDocumentResolver(),
        web: new WebDidDocumentResolver(),
      },
    }),
  }),
});

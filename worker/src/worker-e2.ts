import baseWorker from "./worker.js";
import { signingKeyDocument } from "./ed25519Attestation.js";
import type { Ed25519SigningEnv } from "./ed25519Attestation.js";

interface Env extends Ed25519SigningEnv {
  [key: string]: unknown;
}

const KEY_PATH = "/.well-known/freshcontext-signing-keys.json";
const JSON_CONTENT_TYPE = "application/json";

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": JSON_CONTENT_TYPE,
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders,
    },
  });
}

// The response-rewriting layer that used to live here is gone. It walked every string
// in the MCP JSON response, found the [FRESHCONTEXT_SIG_V3] block, parsed the payload
// back out of its own output, re-signed it, and spliced a V4 block in.
//
// That worked, but it made V4 depend on the Worker successfully parsing text it had
// just produced — so any shift in the emitted format would have made attestations
// silently stop, returning the response unchanged with no error anywhere. It also
// signed a *second* time over bytes reconstructed from a string, rather than over the
// bytes the ledger stored.
//
// worker.ts now signs V4 where it already signs V2 and V3, from the same computed
// payload that goes into the ledger row. The emitted block and the stored row are the
// same bytes by construction. This wrapper is left with the two things it alone can
// do: serve the public key document, and answer V4 verification requests.

// V4 verification used to be intercepted here, ahead of the base Worker. It no longer
// is. src/rest/handler.ts now branches on signature_version and verifies V4 against a
// published key resolver injected by worker.ts, which means /v1/verify has ONE
// implementation covering V2, V3 and V4 across both stateless and ledger-backed modes.
//
// Two implementations of the same endpoint is a correctness hazard, not redundancy:
// they can disagree, and the one in front wins silently. This intercept also sat before
// worker.ts's rate limiter, so it had to re-implement that too, and a V4 request took a
// different abuse path from a V3 one hitting the same URL.
//
// What is left is the one thing only this wrapper can do: publish the keys.

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === KEY_PATH) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return jsonResponse(
          { error: { code: "method_not_allowed", message: "Use GET or HEAD.", details: [] } },
          405,
          { Allow: "GET, HEAD" }
        );
      }
      const document = signingKeyDocument(env);
      if (request.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "Content-Type": JSON_CONTENT_TYPE,
            "Cache-Control": "public, max-age=300",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      return jsonResponse(document, 200, { "Cache-Control": "public, max-age=300" });
    }

    return (baseWorker as any).fetch(request, env, ctx);
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    await (baseWorker as any).scheduled(event, env, ctx);
  },
} satisfies ExportedHandler<Env>;

import baseWorker from "./worker.js";
import {
  ED25519_ALGORITHM,
  ED25519_SIGNATURE_VERSION,
  appendEd25519Attestations,
  signingKeyDocument,
  verifyV4Payload,
} from "./ed25519Attestation.js";
import type { Ed25519SigningEnv } from "./ed25519Attestation.js";

interface Env extends Ed25519SigningEnv {
  [key: string]: unknown;
}

const KEY_PATH = "/.well-known/freshcontext-signing-keys.json";
const JSON_CONTENT_TYPE = "application/json";

function responseWithBody(response: Response, body: string): Response {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

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

async function upgradeJsonStrings(value: unknown, env: Env): Promise<unknown> {
  if (typeof value === "string") {
    return value.includes("[FRESHCONTEXT_SIG_V3]")
      ? appendEd25519Attestations(value, env)
      : value;
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((entry) => upgradeJsonStrings(entry, env)));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = await upgradeJsonStrings(entry, env);
    }
    return out;
  }
  return value;
}

async function maybeUpgradeMcpResponse(
  request: Request,
  response: Response,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  if ((url.pathname !== "/mcp" && url.pathname !== "/mcp/") || request.method !== "POST") {
    return response;
  }
  if (!response.ok || !(response.headers.get("Content-Type") ?? "").toLowerCase().includes(JSON_CONTENT_TYPE)) {
    return response;
  }

  const raw = await response.clone().text();
  if (!raw.includes("[FRESHCONTEXT_SIG_V3]")) return response;

  try {
    const parsed: unknown = JSON.parse(raw);
    const upgraded = await upgradeJsonStrings(parsed, env);
    return responseWithBody(response, JSON.stringify(upgraded));
  } catch {
    // A malformed/non-standard MCP response is the base Worker's concern. Never break
    // an otherwise valid response merely because the additive attestation layer cannot
    // parse it.
    return response;
  }
}

async function maybeHandleV4Verify(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/v1/verify" || request.method !== "POST") return null;

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.clone().json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    body = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const payload = body.signing_payload;
  const explicitlyV4 = body.signature_version === ED25519_SIGNATURE_VERSION;
  const payloadIsV4 = typeof payload === "string" && payload.startsWith(`${ED25519_SIGNATURE_VERSION}\n`);
  if (!explicitlyV4 && !payloadIsV4) return null;

  if (typeof payload !== "string" || payload.trim() === "") {
    return jsonResponse({
      error: { code: "invalid_request", message: "signing_payload must be a non-empty string.", details: [] },
    }, 400);
  }

  if (body.signature === undefined || body.signature === null || body.signature === "") {
    return jsonResponse({
      status: "unknown",
      signature_version: ED25519_SIGNATURE_VERSION,
      algorithm: ED25519_ALGORITHM,
      reasons: ["signature missing or empty; verification status unknown"],
    });
  }
  if (typeof body.signature !== "string") {
    return jsonResponse({
      error: { code: "invalid_request", message: "signature must be a string.", details: [] },
    }, 400);
  }

  const verification = await verifyV4Payload(payload, body.signature, env);
  if (body.key_id !== undefined && body.key_id !== verification.key_id) {
    return jsonResponse({
      error: { code: "invalid_request", message: "key_id does not match the signing_payload.", details: [] },
    }, 400);
  }

  return jsonResponse({
    status: verification.status,
    signature_version: ED25519_SIGNATURE_VERSION,
    algorithm: ED25519_ALGORITHM,
    key_id: verification.key_id,
    reasons: verification.reasons,
  });
}

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

    const v4Verify = await maybeHandleV4Verify(request, env);
    if (v4Verify) return v4Verify;

    const response = await (baseWorker as any).fetch(request, env, ctx);
    return maybeUpgradeMcpResponse(request, response, env);
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    await (baseWorker as any).scheduled(event, env, ctx);
  },
} satisfies ExportedHandler<Env>;

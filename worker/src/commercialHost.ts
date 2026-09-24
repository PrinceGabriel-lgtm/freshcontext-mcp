// COMMERCIAL HOST V1 SCAFFOLD — intentionally unmounted.
//
// This file defines the minimum project-authenticated host shape for a future paid
// deployment. It MUST NOT be mounted or treated as a public API commitment until an
// actual customer scope exists and the schema, issuance flow, tests and migration in
// docs/COMMERCIAL_HOST_BLUEPRINT.md are completed and reviewed.
//
import { handleRestRequest } from "../../src/rest/handler.js";
import type { RateLimitBinding } from "./rateLimit.js";

const JSON_CONTENT_TYPE = "application/json";
const KEY_PREFIX = "fc_live_";
const MIN_KEY_LENGTH = 32;

export interface CommercialProjectAuth {
  keyId: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  monthlyRequestLimit: number;
}

export interface CommercialHostEnv {
  DB: D1Database;
  COMMERCIAL_RATE_LIMITER?: RateLimitBinding;
}

interface MonthlyUsage {
  requests: number;
  signals: number;
  bytes_in: number;
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": JSON_CONTENT_TYPE,
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function errorResponse(
  code: string,
  message: string,
  status: number,
  requestId?: string,
  extraHeaders: Record<string, string> = {}
): Response {
  return jsonResponse(
    { error: { code, message, details: [] }, ...(requestId ? { request_id: requestId } : {}) },
    status,
    extraHeaders
  );
}

function monthKey(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashCommercialApiKey(rawKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
  return bytesToHex(digest);
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token === "" ? null : token;
}

export async function authenticateCommercialRequest(
  request: Request,
  db: D1Database
): Promise<CommercialProjectAuth | null> {
  const token = bearerToken(request);
  if (!token || !token.startsWith(KEY_PREFIX) || token.length < MIN_KEY_LENGTH) return null;

  const keyHash = await hashCommercialApiKey(token);
  const row = await db.prepare(
    "SELECT k.id AS key_id, k.project_id AS project_id, " +
    "p.slug AS project_slug, p.name AS project_name, p.monthly_request_limit AS monthly_request_limit " +
    "FROM commercial_api_keys k " +
    "JOIN commercial_projects p ON p.id = k.project_id " +
    "WHERE k.key_hash = ? AND k.status = 'active' AND p.status = 'active' " +
    "LIMIT 1"
  ).bind(keyHash).first<{
    key_id: string;
    project_id: string;
    project_slug: string;
    project_name: string;
    monthly_request_limit: number;
  }>();

  if (!row) return null;

  return {
    keyId: row.key_id,
    projectId: row.project_id,
    projectSlug: row.project_slug,
    projectName: row.project_name,
    monthlyRequestLimit: Number(row.monthly_request_limit),
  };
}

async function readMonthlyUsage(
  db: D1Database,
  projectId: string,
  month: string
): Promise<MonthlyUsage> {
  const row = await db.prepare(
    "SELECT requests, signals, bytes_in FROM commercial_usage_monthly " +
    "WHERE project_id = ? AND month = ? LIMIT 1"
  ).bind(projectId, month).first<MonthlyUsage>();

  return {
    requests: Number(row?.requests ?? 0),
    signals: Number(row?.signals ?? 0),
    bytes_in: Number(row?.bytes_in ?? 0),
  };
}

function commercialHeaders(auth: CommercialProjectAuth, requestId: string): Record<string, string> {
  return {
    "X-FreshContext-Request-Id": requestId,
    "X-FreshContext-Project": auth.projectSlug,
  };
}

function withCommercialHeaders(
  response: Response,
  auth: CommercialProjectAuth,
  requestId: string
): Response {
  const headers = new Headers(response.headers);
  headers.set("X-FreshContext-Request-Id", requestId);
  headers.set("X-FreshContext-Project", auth.projectSlug);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function requestMetrics(request: Request): Promise<{ bodyBytes: number; signalCount: number }> {
  if (request.method !== "POST") return { bodyBytes: 0, signalCount: 0 };
  try {
    const text = await request.text();
    const bodyBytes = new TextEncoder().encode(text).length;
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (new URL(request.url).pathname === "/v1/evaluate-batch") {
      return {
        bodyBytes,
        signalCount: Array.isArray(parsed.signals) ? parsed.signals.length : 0,
      };
    }
    return {
      bodyBytes,
      signalCount: parsed.signal && typeof parsed.signal === "object" ? 1 : 0,
    };
  } catch {
    return { bodyBytes: 0, signalCount: 0 };
  }
}

async function recordUsage(
  db: D1Database,
  auth: CommercialProjectAuth,
  route: string,
  requestId: string,
  statusCode: number,
  signalCount: number,
  bodyBytes: number,
  durationMs: number,
  now: Date
): Promise<void> {
  const month = monthKey(now);
  const timestamp = now.toISOString();

  await db.batch([
    db.prepare(
      "INSERT INTO commercial_usage_monthly " +
      "(project_id, month, requests, signals, bytes_in, updated_at) " +
      "VALUES (?, ?, 1, ?, ?, ?) " +
      "ON CONFLICT(project_id, month) DO UPDATE SET " +
      "requests = requests + 1, " +
      "signals = signals + excluded.signals, " +
      "bytes_in = bytes_in + excluded.bytes_in, " +
      "updated_at = excluded.updated_at"
    ).bind(auth.projectId, month, signalCount, bodyBytes, timestamp),
    db.prepare(
      "INSERT INTO commercial_request_log " +
      "(id, project_id, api_key_id, route, status_code, signal_count, body_bytes, duration_ms, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      requestId,
      auth.projectId,
      auth.keyId,
      route,
      statusCode,
      signalCount,
      bodyBytes,
      durationMs,
      timestamp
    ),
    db.prepare(
      "UPDATE commercial_api_keys SET last_used_at = ? WHERE id = ?"
    ).bind(timestamp, auth.keyId),
  ]);
}

async function handleUsage(
  request: Request,
  env: CommercialHostEnv,
  auth: CommercialProjectAuth,
  requestId: string
): Promise<Response> {
  if (request.method !== "GET") {
    return errorResponse(
      "method_not_allowed",
      "Method not allowed. Use GET.",
      405,
      requestId,
      { ...commercialHeaders(auth, requestId), "Allow": "GET" }
    );
  }

  const month = monthKey();
  const usage = await readMonthlyUsage(env.DB, auth.projectId, month);
  const remaining = Math.max(0, auth.monthlyRequestLimit - usage.requests);

  return jsonResponse({
    project: {
      id: auth.projectId,
      slug: auth.projectSlug,
      name: auth.projectName,
    },
    period: month,
    usage,
    quota: {
      monthly_request_limit: auth.monthlyRequestLimit,
      remaining_requests: remaining,
    },
    request_id: requestId,
  }, 200, commercialHeaders(auth, requestId));
}

export async function handleCommercialApiRequest(
  request: Request,
  env: CommercialHostEnv,
  _ctx?: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const requestId = crypto.randomUUID();

  let auth: CommercialProjectAuth | null = null;
  try {
    auth = await authenticateCommercialRequest(request, env.DB);
  } catch {
    return errorResponse(
      "commercial_auth_unavailable",
      "Commercial authentication is temporarily unavailable.",
      503,
      requestId
    );
  }

  if (!auth) {
    return errorResponse(
      "unauthorized",
      "A valid FreshContext project API key is required.",
      401,
      requestId,
      { "WWW-Authenticate": "Bearer" }
    );
  }

  if (url.pathname === "/v1/usage") {
    try {
      return await handleUsage(request, env, auth, requestId);
    } catch {
      return errorResponse(
        "usage_unavailable",
        "Project usage is temporarily unavailable.",
        503,
        requestId,
        commercialHeaders(auth, requestId)
      );
    }
  }

  if (request.method !== "POST") {
    return errorResponse(
      "method_not_allowed",
      "Method not allowed. Use POST.",
      405,
      requestId,
      { ...commercialHeaders(auth, requestId), "Allow": "POST" }
    );
  }

  const period = monthKey();
  let current: MonthlyUsage;
  try {
    current = await readMonthlyUsage(env.DB, auth.projectId, period);
  } catch {
    return errorResponse(
      "usage_unavailable",
      "Project quota state is temporarily unavailable.",
      503,
      requestId,
      commercialHeaders(auth, requestId)
    );
  }

  if (current.requests >= auth.monthlyRequestLimit) {
    return errorResponse(
      "quota_exceeded",
      "Project monthly request quota has been reached.",
      429,
      requestId,
      {
        ...commercialHeaders(auth, requestId),
        "Retry-After": "3600",
      }
    );
  }

  if (env.COMMERCIAL_RATE_LIMITER) {
    const allowed = await env.COMMERCIAL_RATE_LIMITER.limit({ key: auth.projectId });
    if (!allowed.success) {
      return errorResponse(
        "rate_limit_exceeded",
        "Project request rate limit exceeded.",
        429,
        requestId,
        {
          ...commercialHeaders(auth, requestId),
          "Retry-After": "10",
        }
      );
    }
  }

  const metricRequest = request.clone();
  const started = Date.now();
  const response = await handleRestRequest(request);
  const durationMs = Date.now() - started;
  const metrics = await requestMetrics(metricRequest);

  try {
    await recordUsage(
      env.DB,
      auth,
      url.pathname,
      requestId,
      response.status,
      metrics.signalCount,
      metrics.bodyBytes,
      durationMs,
      new Date()
    );
  } catch (error) {
    console.error(JSON.stringify({
      event: "commercial_usage_write_error",
      request_id: requestId,
      project_id: auth.projectId,
      route: url.pathname,
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  return withCommercialHeaders(response, auth, requestId);
}

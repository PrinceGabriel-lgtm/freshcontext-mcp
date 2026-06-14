import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleRestRequest } from "../src/rest/handler.js";

const NOW = "2026-05-24T13:00:00.000Z";

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://freshcontext.test${path}`, init);
}

function jsonRequest(path: string, body: unknown, init: RequestInit = {}): Request {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

async function responseJson(response: Response): Promise<Record<string, any>> {
  return await response.json() as Record<string, any>;
}

function signal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "rest_sig",
    source: "https://example.com/rest",
    source_type: "hackernews",
    title: "REST signal",
    content: "FreshContext REST handler content",
    published_at: "2026-05-24T12:00:00.000Z",
    retrieved_at: NOW,
    semantic_score: 0.9,
    date_confidence: "high",
    status: "success",
    metadata: { route: "rest" },
    ...overrides,
  };
}

test("GET /v1/health returns REST health payload", async () => {
  const response = await handleRestRequest(request("/v1/health"));
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    ok: true,
    service: "freshcontext-rest",
    version: "0.3.23",
    core_available: true,
  });
});

test("POST /v1/evaluate returns Core evaluation output", async () => {
  const response = await handleRestRequest(jsonRequest("/v1/evaluate", {
    signal: signal(),
    options: { now: NOW },
  }));
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.signal.contract_version, "freshcontext.signal.v1");
  assert.equal(body.signal.source, "https://example.com/rest");
  assert.equal(typeof body.freshness_score, "number");
  assert.equal(typeof body.utility.score, "number");
  assert.equal(typeof body.ranked.final_score, "number");
  assert.equal(body.explanation, body.ranked.reason);
});

test("POST /v1/evaluate-batch returns evaluateSignals ordering", async () => {
  const response = await handleRestRequest(jsonRequest("/v1/evaluate-batch", {
    signals: [
      signal({ id: "lower", source: "https://example.com/lower", semantic_score: 0.7 }),
      signal({ id: "higher", source: "https://example.com/higher", semantic_score: 0.95 }),
    ],
    options: { now: NOW },
  }));
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.evaluations.length, 2);
  assert.equal(body.evaluations[0].signal.id, "higher");
  assert.ok(body.evaluations[0].ranked.final_score > body.evaluations[1].ranked.final_score);
});

test("wrong method returns stable 405 error", async () => {
  const response = await handleRestRequest(request("/v1/health", { method: "POST" }));
  const body = await responseJson(response);

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET");
  assert.equal(body.error.code, "method_not_allowed");
  assert.deepEqual(body.error.details, []);
});

test("non-JSON POST returns stable 415 error", async () => {
  const response = await handleRestRequest(request("/v1/evaluate", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "plain",
  }));
  const body = await responseJson(response);

  assert.equal(response.status, 415);
  assert.equal(body.error.code, "unsupported_media_type");
});

test("malformed JSON returns stable 400 error", async () => {
  const response = await handleRestRequest(jsonRequest("/v1/evaluate", "{not-json"));
  const body = await responseJson(response);

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "invalid_request");
});

test("missing signal returns stable 400 error", async () => {
  const response = await handleRestRequest(jsonRequest("/v1/evaluate", {
    options: { now: NOW },
  }));
  const body = await responseJson(response);

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "invalid_request");
  assert.match(body.error.message, /signal/);
});

test("missing or non-array signals returns stable 400 error", async () => {
  const missing = await handleRestRequest(jsonRequest("/v1/evaluate-batch", {
    options: { now: NOW },
  }));
  const nonArray = await handleRestRequest(jsonRequest("/v1/evaluate-batch", {
    signals: signal(),
    options: { now: NOW },
  }));

  assert.equal(missing.status, 400);
  assert.equal((await responseJson(missing)).error.code, "invalid_request");
  assert.equal(nonArray.status, 400);
  assert.equal((await responseJson(nonArray)).error.code, "invalid_request");
});

test("oversized payload returns stable 413 error", async () => {
  const largeContent = "x".repeat(260 * 1024);
  const response = await handleRestRequest(jsonRequest("/v1/evaluate", {
    signal: signal({ content: largeContent }),
    options: { now: NOW },
  }));
  const body = await responseJson(response);

  assert.equal(response.status, 413);
  assert.equal(body.error.code, "payload_too_large");
});

test("unknown route returns stable 404 error", async () => {
  const response = await handleRestRequest(request("/v1/nope"));
  const body = await responseJson(response);

  assert.equal(response.status, 404);
  assert.equal(body.error.code, "not_found");
});

test("failed content remains a valid Core result, not an HTTP error", async () => {
  const response = await handleRestRequest(jsonRequest("/v1/evaluate", {
    signal: signal({
      content: "[ERROR] upstream timeout",
      semantic_score: 0.99,
    }),
    options: { now: NOW },
  }));
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.signal.status, "failed");
  assert.equal(body.freshness_score, null);
  assert.equal(body.utility.score, 0);
  assert.equal(body.ranked.confidence, "low");
});

test("future timestamp remains a valid Core result with reasons, not an HTTP error", async () => {
  const response = await handleRestRequest(jsonRequest("/v1/evaluate", {
    signal: signal({
      published_at: "2026-05-24T13:06:00.000Z",
      date_confidence: "high",
    }),
    options: { now: NOW },
  }));
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.signal.published_at, null);
  assert.equal(body.signal.date_confidence, "unknown");
  assert.equal(body.freshness_score, null);
  assert.ok(body.reasons.some((reason: string) => reason.includes("future-dated")));
});

test("local REST handler does not import Worker, MCP, cache, or D1 surfaces", () => {
  const source = readFileSync("src/rest/handler.ts", "utf8");

  assert.doesNotMatch(source, /worker\/src|\.\.\/worker|McpServer|WebStandardStreamableHTTPServerTransport/);
  assert.doesNotMatch(source, /\bD1\b|\bKV\b|\bCACHE\b|\bRATE_LIMITER\b|listen\(/);
});

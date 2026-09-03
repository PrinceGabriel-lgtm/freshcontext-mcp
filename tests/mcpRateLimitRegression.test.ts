import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source-level guards for RT-5, PR-6, and the 2026-07-31 silent-adapter-failure arc.
//
// These are NOT behavioral tests, for the same reason adapterAnchorRegression.test.ts is not:
// Cloudflare's Rate Limiting binding is enforced on the deployed network only — it always
// allows in local dev and miniflare — so a 429 cannot be provoked here. The real proof is a
// post-deploy burst curl. What these pin is that the fixed shapes stay in the source, so the
// old ones cannot quietly come back.

const worker = readFileSync("worker/src/worker.ts", "utf8");
const wrangler = readFileSync("worker/wrangler.jsonc", "utf8");
const rateLimit = readFileSync("worker/src/rateLimit.ts", "utf8");

describe("RT-5 — /mcp uses the atomic rate limiter, not a KV counter", () => {
  test("the MCP_RATE_LIMITER binding is declared", () => {
    assert.match(
      wrangler,
      /"name":\s*"MCP_RATE_LIMITER"/,
      "worker/wrangler.jsonc must declare MCP_RATE_LIMITER under ratelimits"
    );
  });

  test("/mcp checks the atomic binding", () => {
    assert.match(
      worker,
      /checkVerifyRateLimit\(env\.MCP_RATE_LIMITER,/,
      "/mcp must gate on env.MCP_RATE_LIMITER"
    );
  });

  test("the non-atomic KV limiter is gone from the worker", () => {
    // The bug was kv.get -> parseInt -> kv.put(count+1): a concurrent burst all read the
    // same count, so the cap was bypassable on the browser-launching path.
    assert.doesNotMatch(worker, /checkKvRateLimit/, "worker.ts must not call the KV limiter");
    assert.doesNotMatch(worker, /RATE_LIMITER:\s*KVNamespace/, "the KV limiter binding must be gone from Env");
    assert.doesNotMatch(rateLimit, /checkKvRateLimit/, "rateLimit.ts must not export the KV limiter");
  });

  test("no KV namespace is bound for rate limiting any more", () => {
    const kvBlock = wrangler.match(/"kv_namespaces":\s*\[[\s\S]*?\]/)?.[0];
    assert.ok(kvBlock, "kv_namespaces block not found");
    assert.doesNotMatch(
      kvBlock,
      /"binding":\s*"RATE_LIMITER"/,
      "RATE_LIMITER must not be bound — nothing reads it since RT-5"
    );
  });
});

describe("PR-6 — the expensive path keys on the unspoofable header", () => {
  test("/mcp keys its limiter on CF-Connecting-IP, not getClientIp", () => {
    // getClientIp falls back to X-Forwarded-For, which a caller can set per request. The
    // cheap /v1/verify endpoint already keyed correctly; the browser-launching path did not.
    assert.match(
      worker,
      /const mcpRlKey = request\.headers\.get\("CF-Connecting-IP"\)/,
      "/mcp must key on CF-Connecting-IP"
    );
    assert.doesNotMatch(
      worker,
      /checkRateLimit\(getClientIp\(request\)/,
      "/mcp must not key its limiter off the spoofable fallback"
    );
  });
});

describe("cron adapter failures must be visible (2026-07-31 GITHUB_TOKEN expiry)", () => {
  test("reposearch surfaces a non-ok response instead of returning empty", () => {
    const body = worker.match(/case "reposearch": \{[\s\S]*?\n    \}/)?.[0];
    assert.ok(body, "reposearch case not found in runAdapter");
    assert.match(
      body,
      /if \(!res\.ok\) return `GitHub search error/,
      "reposearch must check res.ok — returning \"\" made a 401 indistinguishable from no results"
    );
  });

  test("an empty adapter result still advances last_run_at", () => {
    // Returning before the update left the query permanently first in
    // `ORDER BY last_run_at ASC NULLS FIRST`, so it burned a slot every cycle in silence.
    const guard = worker.match(/if \(!raw \|\| raw\.startsWith\("\[adapter"\)\) \{[\s\S]*?\n      \}/)?.[0];
    assert.ok(guard, "the empty-result guard in scrapeOne was not found");
    assert.match(guard, /UPDATE watched_queries SET last_run_at/, "empty results must still advance last_run_at");
    assert.match(guard, /logEvent\("cron_adapter_empty"/, "empty results must be logged");
  });

  test("a persistently failing adapter is logged even when no row is written", () => {
    // A constant error string hashes identically every run, so the unchanged-content check
    // writes nothing — which looks exactly like a quiet news day.
    assert.match(
      worker,
      /if \(looksLikeFailedAdapterContent\(raw\)\) \{[\s\S]*?logEvent\("cron_adapter_failing"/,
      "scrapeOne must log cron_adapter_failing when adapter output looks like a failure"
    );
  });
});

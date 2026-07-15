import test, { describe } from "node:test";
import assert from "node:assert/strict";
// worker/src is a CommonJS context (no "type":"module"), so import as default and
// destructure — same pattern as the sibling worker-module tests (rateLimit.test.ts).
import rateLimitModule from "../worker/src/rateLimit.ts";
import type { KvRateLimitStore } from "../worker/src/rateLimit.ts";

const { checkKvRateLimit } = rateLimitModule as {
  checkKvRateLimit: (
    kv: KvRateLimitStore,
    key: string,
    limit: number,
    windowSeconds: number
  ) => Promise<{ allowed: boolean; kvError: boolean }>;
};

function mockKv(opts: {
  storedValue?: string | null;
  getThrows?: boolean;
  putThrows?: boolean;
  onPut?: (key: string, value: string) => void;
}): KvRateLimitStore {
  return {
    async get(_key: string) {
      if (opts.getThrows) throw new Error("KV get failed (simulated quota exhaustion)");
      return opts.storedValue ?? null;
    },
    async put(key: string, value: string) {
      if (opts.putThrows) throw new Error("KV put failed (simulated quota exhaustion)");
      opts.onPut?.(key, value);
    },
  };
}

describe("checkKvRateLimit (2026-07-08 fail-open fix for the /mcp limiter)", () => {
  test("first hit (no stored key) -> allowed, writes count 1", async () => {
    let written: [string, string] | null = null;
    const kv = mockKv({ storedValue: null, onPut: (k, v) => { written = [k, v]; } });
    const result = await checkKvRateLimit(kv, "rl:1.2.3.4", 60, 60);
    assert.deepEqual(result, { allowed: true, kvError: false });
    assert.deepEqual(written, ["rl:1.2.3.4", "1"]);
  });

  test("under limit -> allowed, writes incremented count", async () => {
    let written: [string, string] | null = null;
    const kv = mockKv({ storedValue: "5", onPut: (k, v) => { written = [k, v]; } });
    const result = await checkKvRateLimit(kv, "rl:1.2.3.4", 60, 60);
    assert.deepEqual(result, { allowed: true, kvError: false });
    assert.deepEqual(written, ["rl:1.2.3.4", "6"]);
  });

  test("count exactly at the limit -> blocked, no write", async () => {
    let putCalled = false;
    const kv = mockKv({ storedValue: "60", onPut: () => { putCalled = true; } });
    const result = await checkKvRateLimit(kv, "rl:1.2.3.4", 60, 60);
    assert.deepEqual(result, { allowed: false, kvError: false });
    assert.equal(putCalled, false, "must not re-stamp the key once blocked");
  });

  test("count over the limit -> blocked", async () => {
    const kv = mockKv({ storedValue: "1000" });
    const result = await checkKvRateLimit(kv, "rl:1.2.3.4", 60, 60);
    assert.equal(result.allowed, false);
  });

  test("KV get() throws (outage/quota exhausted) -> fails OPEN, does not call put", async () => {
    let putCalled = false;
    const kv = mockKv({ getThrows: true, onPut: () => { putCalled = true; } });
    const result = await checkKvRateLimit(kv, "rl:1.2.3.4", 60, 60);
    assert.deepEqual(result, { allowed: true, kvError: true },
      "a KV read failure must never be treated as 'caller is abusive' — this is the exact bug that turned a KV quota outage into a 429 for every /mcp request");
    assert.equal(putCalled, false);
  });

  test("KV put() throws (this is the actual 2026-07-08 incident: daily write quota exhausted) -> fails OPEN", async () => {
    const kv = mockKv({ storedValue: "3", putThrows: true });
    const result = await checkKvRateLimit(kv, "rl:1.2.3.4", 60, 60);
    assert.deepEqual(result, { allowed: true, kvError: true },
      "a KV write failure (e.g. Cloudflare's daily KV put-quota-exceeded error) must not block the request");
  });
});

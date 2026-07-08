import test, { describe } from "node:test";
import assert from "node:assert/strict";
// worker/src is a CommonJS context (no "type":"module"), so import the module as default
// and destructure — same pattern as the sibling worker-intelligence tests. The Worker's
// own named import of this module is fine; esbuild bundles it (verified by wrangler dry-run).
import rateLimitModule from "../worker/src/rateLimit.ts";
import type { RateLimitBinding } from "../worker/src/rateLimit.ts";

const { checkVerifyRateLimit } = rateLimitModule as {
  checkVerifyRateLimit: (limiter: RateLimitBinding | undefined, key: string) => Promise<boolean>;
};

function mockLimiter(success: boolean, seen: { key?: string } = {}): RateLimitBinding {
  return {
    async limit({ key }) {
      seen.key = key;
      return { success };
    },
  };
}

describe("checkVerifyRateLimit (F-3 gate)", () => {
  test("no limiter bound (local dev / tests) → allowed", async () => {
    assert.equal(await checkVerifyRateLimit(undefined, "1.2.3.4"), true);
  });

  test("limiter reports success → allowed", async () => {
    assert.equal(await checkVerifyRateLimit(mockLimiter(true), "1.2.3.4"), true);
  });

  test("limiter reports over-limit → blocked (this is the 429 path)", async () => {
    assert.equal(await checkVerifyRateLimit(mockLimiter(false), "1.2.3.4"), false);
  });

  test("passes the client key through to the binding unchanged", async () => {
    const seen: { key?: string } = {};
    await checkVerifyRateLimit(mockLimiter(true, seen), "203.0.113.7");
    assert.equal(seen.key, "203.0.113.7");
  });
});

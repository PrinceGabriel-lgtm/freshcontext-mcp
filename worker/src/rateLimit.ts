// Rate-limit gate for the public /v1/verify endpoint (review Finding F-3).
//
// /v1/verify is public and unauthenticated by design (a third party verifies a verdict
// without holding the secret), but Mode 2 (ledger-backed) turns each anonymous request
// into a billable D1 read. Without a limit that is an unbounded cost/DoS amplifier on the
// flagship endpoint. This uses Cloudflare's native, atomic Rate Limiting binding — NOT the
// non-atomic KV get-then-put pattern (which the standards ban: burst-bypassable).
//
// The binding (env.VERIFY_RATE_LIMITER) is declared in worker/wrangler.jsonc. Cloudflare
// enforces rate limits only on the deployed network, never in local dev — so when no limiter
// is bound (local dev, miniflare tests) this allows the request, matching platform behavior.

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

// Returns true if the request may proceed, false if it should be rejected with 429.
export async function checkVerifyRateLimit(
  limiter: RateLimitBinding | undefined,
  key: string
): Promise<boolean> {
  if (!limiter) return true;
  const { success } = await limiter.limit({ key });
  return success;
}

// Minimal structural view of the KV read/write surface the legacy /mcp limiter needs.
// A real KVNamespace satisfies this with no cast (its get/put accept an optional
// second argument, which is a valid supertype of a single-argument call signature).
export interface KvRateLimitStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface KvRateLimitResult {
  allowed: boolean;
  // true when the KV read or write itself failed (outage, quota exhausted) — distinct
  // from "the caller is legitimately over the limit". The caller should log this but
  // must NOT treat it as abuse.
  kvError: boolean;
}

// Fail-open KV-backed rate limiter (2026-07-08 incident fix). The pre-fix version let a
// KV get/put failure propagate as an uncaught throw, which the /mcp route handler turned
// into a 429 for EVERY request — so a KV outage (e.g. the account's daily write quota
// being exhausted) became a total self-inflicted outage of the rate limiter's own
// protected endpoint, blocking legitimate traffic right alongside abusive traffic. A rate
// limiter must never become a bigger outage than the abuse it exists to prevent: on a KV
// error this fails OPEN (allows the request) rather than closed.
export async function checkKvRateLimit(
  kv: KvRateLimitStore,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<KvRateLimitResult> {
  let current: string | null;
  try {
    current = await kv.get(key);
  } catch {
    return { allowed: true, kvError: true };
  }

  const count = current ? parseInt(current, 10) : 0;
  if (count >= limit) {
    // Over limit — matches the original behavior of never re-stamping the key here;
    // the block persists until the last successful write's TTL expires.
    return { allowed: false, kvError: false };
  }

  try {
    await kv.put(key, String(count + 1), { expirationTtl: windowSeconds });
  } catch {
    return { allowed: true, kvError: true };
  }
  return { allowed: true, kvError: false };
}

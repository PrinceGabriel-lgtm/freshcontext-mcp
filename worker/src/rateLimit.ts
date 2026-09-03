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

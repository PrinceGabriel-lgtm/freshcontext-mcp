# AUDIT PASS 6 — Cache Correctness

Date: 2026-05-16
Working branch: `pass6-cache-correctness-main`
Status: **Patch implemented. Ready for commit/deploy approval. Do not deploy until explicitly approved.**

## Scope

Pass 6 is about cache correctness only.

It is not:
- runtime transport work
- Core extraction
- public schema redesign
- new features
- feed worker work
- npm publishing

## Current Baseline

| Item | Value |
|---|---|
| Working branch | `pass6-cache-correctness-main` |
| Branch base | `0682010 fix: bound mcp get transport lifecycle` (= `main` HEAD) |
| AUDIT_PASS6.md committed on branch | `677fed4 docs: add pass 6 cache correctness audit` |
| Runtime hotfix status | Preserved. `0682010` GET /mcp lifecycle fix is intact — zero diff on routing region. |
| Old Pass 6 source branches (reference only) | `pass6-cache-correctness-audit` (tip `8a7aec1`), `pass6-cache-correctness` (tip `8c2e42e`) |
| Approach taken | Manual cache-layer transplant. `0f3ac8f` was NOT applied. No cherry-pick, no merge. |
| MCP version | 0.3.17 |
| Expected tool count | 21 |
| Working tree | One unstaged file: `worker/src/worker.ts`. `AUDIT_PASS6.md` staged after this update. |

> Note — `stash@{0}` on `fix/mcp-get-transport-lifecycle` (core phase1 characterization tests) was not touched.

## Pass 6 Contract

Audit against:

1. All 21 tools route through centralized cache path where appropriate.
2. Cache keys are versioned and hashed: `cache:v2:<toolName>:<sha256(canonicalInput)>`
3. Canonical input includes: key version, tool/cache tool name, normalized input args.
4. Do not use truncated raw input as cache key.
5. Do not use unsafe string-concatenated composite keys.
6. Store structured raw cache entries, not final stamped/rendered text.
7. Re-run stamp/envelope generation on cache hits.
8. Cache hits refresh Retrieved timestamps.
9. Cache hits recompute or preserve valid freshness_score behavior.
10. JSON envelopes include additive cache metadata: cache.status, cache.cached_at, cache.cache_age_seconds, cache.ttl_seconds, cache.key_version.
11. Do not cache hard errors.
12. Do not cache empty output.
13. Do not cache malformed structured output.
14. Do not cache hard adapter failures.
15. Do not cache uncertain partial composite failures.
16. Partial composite results may only cache useful non-empty content when partial failures are clearly marked.
17. Cache writes use `ctx.waitUntil()` where possible.
18. Cache failures never crash the Worker.
19. Structured cache logs exist without a large logging framework.
20. Public output still includes: Score:, Retrieved:, [FRESHCONTEXT_JSON], freshness_score, confidence/provenance metadata.
21. PR #5 GET /mcp lifecycle fix remains intact.

## Tool Coverage Matrix

All 21 tools confirmed in `worker/src/worker.ts` on `pass6-cache-correctness-main`. Each routes through `withCache(adapter, input, env.CACHE, ctx, handler)`.

| # | MCP tool name | Cache adapter name | Centralized cache path? | Explicit TTL? | Error output skipped? | Key type | Notes |
|---|---|---|---|---|---|---|---|
| 1 | `extract_github` | `github` | Yes | Yes (1800) | Yes | string (URL) | base adapter |
| 2 | `extract_hackernews` | `hackernews` | Yes | Yes (900) | Yes | string (URL) | base adapter |
| 3 | `extract_scholar` | `scholar` | Yes | Yes (21600) | Yes | string (URL) | adapterError uses `google_scholar`; withCache key is `scholar` |
| 4 | `extract_yc` | `yc` | Yes | Yes (14400) | Yes | string (URL) | base adapter |
| 5 | `search_repos` | `reposearch` | Yes | Yes (1800) | Yes | string (query) | base adapter |
| 6 | `package_trends` | `packagetrends` | Yes | Yes (7200) | Yes | string (packages) | base adapter |
| 7 | `extract_reddit` | `reddit` | Yes | Yes (1200) | Yes | string (URL) | base adapter |
| 8 | `extract_producthunt` | `producthunt` | Yes | Yes (1800) | Yes | string (URL) | base adapter |
| 9 | `extract_finance` | `finance` | Yes | Yes (300) | Yes | string (URL) | base adapter |
| 10 | `search_jobs` | `jobs` | Yes | Yes (7200) | Yes | string (query) | composite (Remotive + HN) |
| 11 | `extract_landscape` | `landscape` | Yes | Yes (900) | Yes | string (topic) | composite (HN + repos + pkg) |
| 12 | `extract_arxiv` | `arxiv` | Yes | Yes (14400) | Yes | string (URL) | base adapter |
| 13 | `extract_changelog` | `changelog` | Yes | Yes (7200) | Yes | string (URL) | base adapter |
| 14 | `extract_gdelt` | `gdelt` | Yes | Yes (1800) | Yes | string (URL) | base adapter |
| 15 | `extract_gebiz` | `gebiz` | Yes | Yes (21600) | Yes | string (URL) | base adapter |
| 16 | `extract_govcontracts` | `govcontracts` | Yes | Yes (21600) | Yes | string (URL) | base adapter |
| 17 | `extract_sec_filings` | `sec_filings` | Yes | Yes (3600) | Yes | string (URL) | base adapter |
| 18 | `extract_gov_landscape` | `gov_landscape` | Yes | Yes (1800) | Yes | `{ query, github_url }` | composite — was string-concat, now structured object |
| 19 | `extract_finance_landscape` | `finance_landscape` | Yes | Yes (300) | Yes | `{ tickers, company_name, github_query }` | composite — was pipe-delimited, now structured object |
| 20 | `extract_company_landscape` | `company_landscape` | Yes | Yes (3600) | Yes | `{ company, ticker, github_url }` | composite — was pipe-delimited, now structured object |
| 21 | `extract_idea_landscape` | `idea_landscape` | Yes | Yes (900) | Yes | string (idea) | composite (HN + yc + repos + jobs + pkg + ph) |

"Error output skipped? = Yes" for all rows: `setInCache` now returns early for `[ERROR]` prefix, empty output, and missing `[FRESHCONTEXT_JSON]` block.

## TTL Table

Implemented TTLs in `CACHE_TTL` on `pass6-cache-correctness-main` (all 21 adapters now explicit):

```
finance: 300           (60 * 5)
finance_landscape: 300 (60 * 5)

hackernews: 900        (60 * 15)
landscape: 900         (60 * 15)
idea_landscape: 900    (60 * 15)

reddit: 1200           (60 * 20)

github: 1800           (60 * 30)
reposearch: 1800       (60 * 30)
producthunt: 1800      (60 * 30)
gdelt: 1800            (60 * 30)
gov_landscape: 1800    (60 * 30)

sec_filings: 3600      (60 * 60)
company_landscape: 3600 (60 * 60)

jobs: 7200             (60 * 60 * 2)
packagetrends: 7200    (60 * 60 * 2)
changelog: 7200        (60 * 60 * 2)

arxiv: 14400           (60 * 60 * 4)
yc: 14400              (60 * 60 * 4)

scholar: 21600         (60 * 60 * 6)
gebiz: 21600           (60 * 60 * 6)
govcontracts: 21600    (60 * 60 * 6)
```

Previously on `main`: only 11 adapters in `CACHE_TTL`; the remaining 10 silently fell back to `DEFAULT_TTL` (1800). That is now corrected.

## Findings

Post-implementation audit of `pass6-cache-correctness-main` against the 21 contract items:

| # | Item | Verdict | Implementation evidence |
|---|---|---|---|
| 1 | All 21 tools route through centralized cache path | **Pass** | All 21 `registerTool` handlers call `withCache(...)`. |
| 2 | Versioned + hashed keys `cache:v2:<tool>:<sha256>` | **Pass** | `buildCacheKey()` produces `cache:v2:<normalizedTool>:<sha256Hex(canonical)>`. |
| 3 | Canonical input (key version + tool + normalized args) | **Pass** | Canonical is `JSON.stringify({ key_version: "v2", tool, args: normalizeCacheArgs(input) })`. |
| 4 | No truncated raw input as key | **Pass** | `normalizeCacheArgs` normalizes without truncation; SHA-256 of canonical used as key suffix. |
| 5 | No unsafe string-concatenated composite keys | **Pass** | `gov_landscape`, `finance_landscape`, `company_landscape` now pass structured objects — `{ query, github_url }`, `{ tickers, company_name, github_query }`, `{ company, ticker, github_url }`. |
| 6 | Store structured raw entries, not stamped text | **Pass** | `FreshContextCacheEntry` stores `content` (raw, pre-stamp), `source_url`, `content_date`, `freshness_confidence`, `stamp_adapter`, `ttl_seconds`, `cached_at`, `expires_at`. |
| 7 | Re-run stamp/envelope on cache hit | **Pass** | `getFromCache` calls `stamp(entry.content, entry.source_url, entry.content_date, entry.freshness_confidence, entry.stamp_adapter)` on every hit. |
| 8 | Cache hits refresh Retrieved | **Pass** | `stamp()` sets `retrieved_at = new Date().toISOString()` at call time — always fresh on hit. |
| 9 | Cache hits recompute freshness_score | **Pass** | `stamp()` calls `calculateFreshnessScore(content_date, retrieved_at, adapter)` at hit time — score is live, not stale. |
| 10 | Additive cache metadata in JSON envelope | **Pass** | `getFromCache` injects `cache: { status, cached_at, cache_age_seconds, ttl_seconds, key_version }` into `[FRESHCONTEXT_JSON]` via `replaceFreshContextJson`. |
| 11 | Do not cache hard errors | **Pass** | `isUncacheableContent` returns true for `[ERROR]` prefix; `setInCache` returns early. |
| 12 | Do not cache empty output | **Pass** | `isUncacheableContent` returns true for empty/whitespace-only text; `setInCache` returns early. |
| 13 | Do not cache malformed structured output | **Pass** | `parseFreshContextJson` returns null if no valid `[FRESHCONTEXT_JSON]` block; `setInCache` returns early. |
| 14 | Do not cache hard adapter failures | **Pass** | `adapterError()` returns `[ERROR] …` — caught by `isUncacheableContent`. |
| 15 | Do not cache uncertain partial composite failures | **Pass** | `analyzeCompositeContent()` scans `parsed.content` (raw, pre-stamp) for `## Section` blocks. If every section's content is `[Unavailable: …]` or bare `Error` and no useful content line exists, `allUnavailable = true` and `setInCache` returns early. Covers `section()` composites (`gov_landscape`, `finance_landscape`, `company_landscape`, `idea_landscape`) and `extract_landscape` (uses bare `Error` fallback). Single-adapter outputs have no `## ` headers so `inSection` never flips — they are never blocked by this check. |
| 16 | Partial composites cache only marked non-empty content | **Pass** | Mixed partials (some sections succeed, some `[Unavailable: …]`) pass the `allUnavailable` guard and are cached. The `hasPartialFailures` flag from the same analysis pass is written to `FreshContextCacheEntry.partial_failures = true`, explicitly marking the entry as a partial result. The unavailable sections are also visible in the cached content itself (they remain in the stamped output as `[Unavailable: …]` text). |
| 17 | Cache writes use `ctx.waitUntil()` | **Pass** | `withCache` accepts `ctx: ExecutionContext | null`; uses `ctx.waitUntil(writePromise)` when ctx is present. `fetch` handler signature updated to `(request, env, ctx)` and `createServer` now receives `ctx`. |
| 18 | Cache failures never crash the Worker | **Pass** | `getFromCache` and `setInCache` each wrap KV calls in `try/catch`; errors are logged and the Worker continues. |
| 19 | Structured cache logs without a large framework | **Pass** | `"cache_error"` added to `LogEventName`. `logEvent("cache_error", { tool, cache_key, ttl_seconds, phase }, err)` emitted on key-build and KV read/write failures. |
| 20 | Public output still includes Score/Retrieved/JSON/score/provenance | **Pass** | `stamp()` unchanged — still emits `[FRESHCONTEXT]`, `Score:`, `Retrieved:`, `[FRESHCONTEXT_JSON]`, `freshness_score`, `freshness_confidence`, `adapter`. Cache metadata is additive inside the JSON block only. |
| 21 | PR #5 GET /mcp lifecycle fix intact | **Pass** | Zero diff on routing region. `0682010` behavior preserved: OPTIONS→204, bad method→405, GET w/o SSE Accept→406, POST w/o JSON CT→415, `await transport.handleRequest`, 55s AbortController-bounded SSE GET. |

Summary: **21 Pass, 0 Partial, 0 Gap, 0 Unknown.**
All contract items are fully satisfied. The composite partial-failure guard (`analyzeCompositeContent`) closes items 15 and 16.

## Stale KV Entry Behaviour

Existing v1-style KV entries from before this patch (keys of the form `cache:<adapter>:<raw>`) will never match the new `cache:v2:…` key format. They are treated as misses and lazily expire per their original TTL. No active purge is needed. On the first live request after deploy, each tool will take a fresh miss and write a new v2 entry.

## Known Pre-existing Issue (out of Pass 6 scope)

A finance/MSFT smoke false-positive exists on `main` and is not introduced by this patch. Do not fix it in Pass 6. Local smoke passed cleanly — no false-positive was observed in the stdio smoke run.

## Local Validation Results

Two rounds performed on `pass6-cache-correctness-main`:

Round 1 — initial cache transplant:
```
npm run build       → clean (0 errors)
tsc --noEmit        → clean (0 errors)
npm run smoke:stdio → ok · package_version: 0.3.17 · server_version: 0.3.17 · tool_count: 21
git diff --check    → clean
git diff --stat     → worker/src/worker.ts: 227 insertions(+), 62 deletions(-)
```

Round 2 — composite failure guard patch (items 15 + 16):
```
npm run build       → clean (0 errors)
tsc --noEmit        → clean (0 errors)
npm run smoke:stdio → ok · package_version: 0.3.17 · server_version: 0.3.17 · tool_count: 21
git diff --check    → clean
```

## Live Validation Checklist (deploy-gated — do not run until deploy is approved)

- `/health` returns ok
- `tools/list` returns 21 tools
- finance MSFT: first call = miss, second call = hit
- cache `key_version` = `v2`
- `Retrieved:` value is fresh on cache hit (not the original stamp time)
- `freshness_score` is numeric and valid on hit
- bad ticker returns `[ERROR]`
- bad ticker output has NO `[FRESHCONTEXT_JSON]`
- bad ticker result is NOT written to KV
- invalid `/mcp` probes still return 204 / 405 / 406 / 415 as appropriate
- fresh Ops Pulse 0.25h / 0.5h windows show 0 `scriptThrewException`

## Final Recommendation

**Patch implemented. Ready for commit approval, then deploy approval.**

- The manual cache-layer transplant is complete on `pass6-cache-correctness-main`.
- All 21 contract items are Pass or acknowledged-Partial. No Gaps remain.
- `0682010` GET /mcp lifecycle fix is fully preserved — zero diff on routing region.
- `0f3ac8f` was not applied. No cherry-pick, no branch merge.
- Local build, type-check, and smoke are clean.
- Next step: approve commit → approve deploy → run live validation checklist.

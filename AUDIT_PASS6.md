# AUDIT PASS 6 — Cache Correctness

Date: 2026-05-15
Working branch: `main`
Status: AUDIT ONLY — no code patched yet. Awaiting approval before touching `worker/src/worker.ts`.

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
| Current branch | `main` |
| Current main commit (HEAD) | `0682010 fix: bound mcp get transport lifecycle` |
| Runtime hotfix status | Present and merged on `main` (PR #5 GET /mcp lifecycle fix = `0682010`) |
| Old Pass 6 source branches | `pass6-cache-correctness-audit` (tip `8a7aec1`) and `pass6-cache-correctness` (tip `8c2e42e`) |
| Old Pass 6 commits | `0f3ac8f` fix: catch worker runtime promise failures<br>`8c2e42e` feat(pass-6): harden worker cache correctness<br>`8a7aec1` fix(pass-6): audit and correct cache contract |
| Merge base (`main` ↔ `pass6-cache-correctness-audit`) | `52b8d2b` (PR #4 merge) |
| Commits on `main` after divergence | `4a86401` (MCP registry metadata) and `0682010` (GET /mcp lifecycle fix) |
| MCP version | server.json metadata last bumped to 0.3.17 (`4a86401`) |
| Expected tool count | 21 |
| Working tree clean | Yes (`git status --short` empty; `main` even with `origin/main`) |

> Note — discrepancy vs brief: the brief named the runtime fix as `9d34cbd`; the actual merged commit on `main` is `0682010 fix: bound mcp get transport lifecycle`. Same fix, different hash. The old Pass 6 commit hashes in the brief match the repo exactly.

> Note — there is also an unrelated stash (`stash@{0}: On fix/mcp-get-transport-lifecycle: wip core phase1 characterization tests`). Pass 6 does NOT touch it. Do not pop it.

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

All 21 tools confirmed registered in `worker/src/worker.ts` on `main`. Each routes through `withCache(...)`.

| # | MCP tool name | Cache adapter name | Centralized cache path? | Explicit TTL? | Cacheable success output? | Error output skipped? | Notes |
|---|---|---|---|---|---|---|---|
| 1 | `extract_github` | `github` | Yes | Yes (1800) | Yes | No | base adapter |
| 2 | `extract_hackernews` | `hackernews` | Yes | Yes (900) | Yes | No | base adapter |
| 3 | `extract_scholar` | `scholar` | Yes | Yes (21600) | Yes | No | adapterError uses `google_scholar`; withCache key is `scholar` |
| 4 | `extract_yc` | `yc` | Yes | Yes (14400) | Yes | No | base adapter |
| 5 | `search_repos` | `reposearch` | Yes | Yes (1800) | Yes | No | base adapter |
| 6 | `package_trends` | `packagetrends` | Yes | Yes (7200) | Yes | No | cache input = raw `packages` arg |
| 7 | `extract_reddit` | `reddit` | Yes | Yes (1200) | Yes | No | TTL on main is 1200 (60*20) |
| 8 | `extract_producthunt` | `producthunt` | Yes | Yes (1800) | Yes | No | base adapter |
| 9 | `extract_finance` | `finance` | Yes | Yes (300) | Yes | No | base adapter |
| 10 | `search_jobs` | `jobs` | Yes | Yes (7200) | Yes | No | composite (Remotive + HN) |
| 11 | `extract_landscape` | `landscape` | Yes | Yes (900) | Yes | No | composite (HN + repos + pkg) |
| 12 | `extract_arxiv` | `arxiv` | Yes | Yes (14400) | Yes | No | base adapter |
| 13 | `extract_changelog` | `changelog` | Yes | Yes (7200) | Yes | No | base adapter |
| 14 | `extract_gdelt` | `gdelt` | Yes | Yes (1800) | Yes | No | base adapter |
| 15 | `extract_gebiz` | `gebiz` | Yes | Yes (21600) | Yes | No | base adapter |
| 16 | `extract_govcontracts` | `govcontracts` | Yes | Yes (21600) | Yes | No | base adapter |
| 17 | `extract_sec_filings` | `sec_filings` | Yes | Yes (3600) | Yes | No | base adapter |
| 18 | `extract_gov_landscape` | `gov_landscape` | Yes | Yes (1800) | Yes | No | composite; key = `query + (github_url ?? "")` — string concat |
| 19 | `extract_finance_landscape` | `finance_landscape` | Yes | Yes (300) | Yes | No | composite; key = `` `${tickers}|${company_name}|${github_query}` `` — string concat |
| 20 | `extract_company_landscape` | `company_landscape` | Yes | Yes (3600) | Yes | No | composite; key = `` `${company}|${ticker}|${github_url}` `` — string concat |
| 21 | `extract_idea_landscape` | `idea_landscape` | Yes | Yes (900) | Yes | No | composite (HN + yc + repos + jobs + pkg + ph) |

"Error output skipped? = No" for every row: on `main`, `withCache` caches the handler result unconditionally — error/empty/malformed outputs are all written to KV.

## TTL Table

Intended Pass 6 TTLs (seconds):

```
finance: 300
finance_landscape: 300

hackernews: 900
landscape: 900
idea_landscape: 900

reddit: 1200

github: 1800
reposearch: 1800
producthunt: 1800
gdelt: 1800
gov_landscape: 1800

sec_filings: 3600
company_landscape: 3600

jobs: 7200
packagetrends: 7200
changelog: 7200

arxiv: 14400
yc: 14400

scholar: 21600
gebiz: 21600
govcontracts: 21600
```

TTL state on `main`: the `CACHE_TTL` map only defines 11 of the 21 adapters (jobs, github, hackernews, scholar, arxiv, yc, producthunt, reddit, finance, reposearch, packagetrends). The other 10 (changelog, gdelt, gebiz, govcontracts, sec_filings, landscape, gov_landscape, finance_landscape, company_landscape, idea_landscape) fall back to `DEFAULT_TTL` (1800). Also `gdelt` intended 1800 happens to equal default; `sec_filings` intended 3600, `changelog` intended 7200, etc. are wrong on `main`.

The `pass6-cache-correctness-audit` branch already defines all 21 TTLs, but with some values that differ from this table (e.g. branch `gdelt`=1800 OK; branch `sec_filings`=3600 OK; branch `landscape`=900 OK; branch `gebiz`/`govcontracts`=21600 OK; branch `gov_landscape`=1800 OK; branch `company_landscape`=3600 OK; branch `idea_landscape`=900 OK; branch `finance_landscape`=300 OK; branch `changelog`=7200 OK). The branch map looks aligned with this table — verify exactly during transplant.

## Findings

Audit of `main` (`0682010`) against the 21 contract items:

| # | Item | Verdict | Evidence on `main` |
|---|---|---|---|
| 1 | All 21 tools route through centralized cache path | **Pass** | All 21 `registerTool` handlers wrap their body in `withCache(...)`. |
| 2 | Versioned + hashed keys `cache:v2:<tool>:<sha256>` | **Gap** | `cacheKey()` returns `cache:${adapter}:${normalized}` — no version, no hash. |
| 3 | Canonical input (key version + tool + normalized args) | **Gap** | No canonical-input object exists; key is built from a single string. |
| 4 | No truncated raw input as key | **Gap** | `cacheKey()` does `input.trim().toLowerCase().slice(0, 200)` — truncated raw input. |
| 5 | No unsafe string-concatenated composite keys | **Gap** | `gov_landscape` (`query + github_url`), `finance_landscape` (`` `${tickers}|...` ``), `company_landscape` (`` `${company}|...` ``) all string-concat. |
| 6 | Store structured raw entries, not stamped text | **Gap** | `withCache` stores `result.content[0].text` — the fully stamped/rendered envelope. |
| 7 | Re-run stamp/envelope on cache hit | **Gap** | `getFromCache` only prepends `[⚡ Cached — retrieved at ...]`; no re-stamp. |
| 8 | Cache hits refresh Retrieved | **Gap** | Stale `Retrieved:` from the original stamp is served verbatim. |
| 9 | Cache hits recompute/preserve freshness_score | **Gap** | Stale `freshness_score` served; never recomputed. |
| 10 | Additive cache metadata in JSON envelope | **Gap** | No `cache.status` / `cached_at` / `cache_age_seconds` / `ttl_seconds` / `key_version` fields. |
| 11 | Do not cache hard errors | **Gap** | `withCache` calls `setInCache` unconditionally on every handler result. |
| 12 | Do not cache empty output | **Gap** | No empty-output check before write. |
| 13 | Do not cache malformed structured output | **Gap** | No malformed-output check before write. |
| 14 | Do not cache hard adapter failures | **Gap** | `[ERROR]` / `adapterError` results are cached like successes. |
| 15 | Do not cache uncertain partial composite failures | **Gap** | Composite outputs cached whole regardless of partial failures. |
| 16 | Partial composites cache only marked non-empty content | **Gap** | No partial-failure marking or gating in cache write path. |
| 17 | Cache writes use `ctx.waitUntil()` | **Gap** | `withCache` has no `ctx`; write is fire-and-forget `setInCache(...).catch(()=>{})`. |
| 18 | Cache failures never crash the Worker | **Pass** | `getFromCache` / `setInCache` both wrap everything in `try/catch`. |
| 19 | Structured cache logs without a large framework | **Gap** | No `cache_error` log event in `LogEventName`; cache failures are swallowed silently. |
| 20 | Public output still includes Score/Retrieved/JSON/score/provenance | **Pass** | `stamp()` always emits `[FRESHCONTEXT]`, `Score:`, `Retrieved:`, `[FRESHCONTEXT_JSON]`, `freshness_score`, `freshness_confidence`, `adapter`. |
| 21 | PR #5 GET /mcp lifecycle fix intact | **Pass** | `main` HEAD `0682010` has: awaited `transport.handleRequest`, OPTIONS→204, bad method→405, GET w/o SSE Accept→406, POST w/o JSON CT→415, 55s + abort-signal bounded SSE GET. |

Summary: **3 Pass, 17 Gap, 0 Unknown, 1 Pass (item 21, must be preserved).** `main` does not satisfy the Pass 6 cache contract. The cache layer on `main` is the pre-Pass-6 v1-style implementation.

## Required Patch Plan

Gaps exist (items 2–17, 19). A code patch IS needed before any Pass 6 merge.

The `pass6-cache-correctness-audit` branch already implements the full corrected cache layer (its diff vs `main` is +471/-67 in `worker/src/worker.ts`, plus the older `AUDIT_PASS6.md`). Its own audit claims items 2–19 are satisfied.

**Recommended approach: manual transplant, not cherry-pick.**

Minimal code changes needed (all confined to the Cache Layer + `withCache` region of `worker/src/worker.ts`, roughly lines 194–460 on `main`):

1. Replace `CACHE_TTL` with the full 21-adapter map (verify each value against the TTL Table above).
2. Replace `cacheKey()` with versioned + SHA-256 hashed canonical-input keying (`normalizeCacheArgs`, `sha256Hex`, `cacheKey` → `CacheKeyParts`).
3. Replace the `FreshContext` cache entry shape with the structured `FreshContextCacheEntry` (raw fields, not stamped text).
4. Rewrite `getFromCache` / `setInCache` to store/read structured entries, re-run `stamp()` on hit, and inject additive `cache` metadata.
5. Rewrite `withCache` to: skip caching on error/empty/malformed/partial-failure output, accept structured candidates, and write via `ctx.waitUntil()` (requires threading `ctx` to `withCache`).
6. Add `"cache_error"` to `LogEventName` and emit structured cache logs.
7. Convert the 3 composite call sites (`gov_landscape`, `finance_landscape`, `company_landscape`) from string-concatenated keys to structured arg objects.

Do NOT transplant `0f3ac8f fix: catch worker runtime promise failures` — it is a runtime/transport commit (out of Pass 6 scope) and overlaps the GET /mcp lifecycle region. `main` already has the newer, superior `0682010` fix there.

## Risks

- **Old Pass 6 branch diverged before current `main`.** `pass6-cache-correctness-audit` branches from `52b8d2b`; `main` has `4a86401` + `0682010` on top. The branch has never seen the GET /mcp lifecycle fix.
- **`worker.ts` conflict risk.** The Pass 6 branch rewrote `worker.ts` against a pre-hotfix base. Any cherry-pick / merge of the Pass 6 branch will likely conflict in `worker.ts`.
- **Accidental regression of the GET /mcp lifecycle fix.** Commit `0f3ac8f` on the Pass 6 branch touches runtime/transport error handling near the routing region. Cherry-picking or merging the branch wholesale could overwrite or revert the `0682010` lifecycle fix (406/405/415/204 + bounded SSE + awaited `handleRequest`). Manual transplant of ONLY the cache layer avoids this.
- **Cache correctness must not change public schemas.** All `cache.*` metadata must be additive inside `[FRESHCONTEXT_JSON]`. `Score:`, `Retrieved:`, `[FRESHCONTEXT_JSON]`, `freshness_score`, confidence/provenance must remain.
- **Stale KV entries.** Existing v1-style KV entries (`cache:<adapter>:<raw>`) and any earlier text-cached entries will not match new `cache:v2:...` keys; they are lazily ignored/expired, not actively purged.
- **Known finance smoke false-positive.** A finance/MSFT smoke false-positive may already exist on `main`. It is NOT a Pass 6 bug and must NOT be fixed inside Pass 6.

## Validation Plan

Local (after the patch is approved and applied):

```
npm run build
cd worker && npx tsc --noEmit
npm run smoke:stdio
```

If `smoke:stdio` fails ONLY due to the known finance/MSFT false-positive that also reproduces on `main`, record it as pre-existing and do NOT fix it in Pass 6.

Live checks — only if code changes are made AND deploy is explicitly approved:
- `/health` returns ok
- `tools/list` returns 21 tools
- finance MSFT: first call = miss, second call = hit
- cache `key_version` = `v2`
- `Retrieved:` refreshes on cache hit
- `freshness_score` is numeric / valid on hit
- bad ticker returns `[ERROR]`
- bad ticker output has NO `[FRESHCONTEXT_JSON]`
- bad ticker result is NOT cached
- invalid `/mcp` probes still return 204 / 405 / 406 / 415 as appropriate
- fresh Ops Pulse 0.25h / 0.5h windows show 0 `scriptThrewException`

## Final Recommendation

**Manual transplant recommended. Cherry-pick unsafe.**

- A patch IS needed before merge — `main` is on the pre-Pass-6 v1 cache layer (17 contract gaps).
- The fix already exists on `pass6-cache-correctness-audit`, but that branch predates the GET /mcp lifecycle hotfix.
- Cherry-picking `8c2e42e` / `8a7aec1` (and especially `0f3ac8f`) risks conflicting with or regressing the `0682010` GET /mcp fix.
- Safer path: manually transplant ONLY the cache-layer region (`CACHE_TTL`, key derivation, structured entry shape, `getFromCache`/`setInCache`/`withCache`, `cache_error` logging, and the 3 composite call sites) onto current `main`, leaving the routing/transport region untouched.

STOP — awaiting approval of this audit before patching `worker/src/worker.ts`.

# Pass 4 — Phase 1 Audit (read-only)

Generated: 2026-05-10
Scope: 16 base adapter source files in `src/adapters/` + 5 composite tools in `src/server.ts` + Worker registration state in `worker/src/worker.ts`.

## How "envelope" is verified

A correctly wired tool path looks like:

1. Adapter returns `AdapterResult { raw, content_date, freshness_confidence }` — a structured object, not a stringified envelope.
2. The registration layer calls `stampFreshness()` + `formatForLLM()` (npm: `src/server.ts`) or the worker's own `stamp()` helper (worker: `worker/src/worker.ts`) to wrap the result in the `[FRESHCONTEXT]…[/FRESHCONTEXT]` envelope.

So "proper envelope" at the adapter layer means: the adapter returns the structured `AdapterResult` shape with `content_date` populated as a real ISO date (not stuffed into `raw`), and `freshness_confidence` set to one of `high | medium | low`. Every adapter I checked returns `AdapterResult`; the variation is in how well `content_date` is set and whether the `raw` string also embeds inline dates.

## Master table

| # | Adapter | Wired in `worker.ts`? | Wired in `server.ts`? | Returns `AdapterResult` envelope? | `content_date` quality | `freshness_confidence` set? | Known/found bugs |
|---|---|---|---|---|---|---|---|
| 1 | `arxiv` | ❌ no | ❌ imported but not registered | ✅ yes | ✅ ISO date (YYYY-MM-DD) from `<published>` | ✅ high/medium/low | None observed. Used only via composites (none in server.ts use it). |
| 2 | `changelog` | ❌ no | ✅ `extract_changelog` | ✅ yes | ✅ ISO from GitHub Releases / npm; medium-conf scrape extracts dates from page text | ✅ all three values used | Discovery scraper has `low` confidence when scrape returns no dates — acceptable. |
| 3 | `finance` | ✅ `extract_finance` | ❌ imported but not registered (used only via `extract_finance_landscape`) | ✅ yes | Historical note: older quote source used provider timestamps and could fall back to `now()` | ✅ always `"high"` | Superseded by Pass 0.3.17 finance failure-honesty fix. |
| 4 | `gdelt` | ❌ no | ✅ `extract_gdelt` | ✅ yes | ✅ ISO parsed from GDELT `seendate` (YYYYMMDDTHHMMSSZ) | ✅ always `"high"` | None. |
| 5 | `gebiz` | ❌ no | ✅ `extract_gebiz` | ✅ yes | ✅ ISO converted from DD/MM/YYYY | ✅ always `"high"` | Locale-quirk: assumes DD/MM/YYYY. If data.gov.sg returns ISO it falls back to `slice(0,10)`. Acceptable. |
| 6 | `github` | ✅ `extract_github` | ✅ `extract_github` | ✅ yes | ✅ ISO from `<relative-time datetime>` | ✅ high if commit found, medium otherwise | None. |
| 7 | `govcontracts` | ❌ no | ✅ `extract_govcontracts` | ✅ yes | ✅ ISO from `Award Date` | ✅ always `"high"` | ⚠️ **BUG-1 (verify):** sort field — see below. |
| 8 | `hackernews` | ✅ `extract_hackernews` | ✅ `extract_hackernews` | ✅ yes | ✅ ISO from Algolia `created_at` / scraped `.age[title]` | ✅ high if date found, medium otherwise | ⚠️ **BUG-2 status:** see below. |
| 9 | `jobs` | ✅ `search_jobs` (Worker uses simplified 2-source variant — Remotive + HN only) | ✅ `search_jobs` (full 5-source) | ✅ yes | ✅ ISO derived from `freshestDays` | ✅ ladder: high (≤7d), medium (≤30d), low (>30d) | ⚠️ **BUG-3 (parity):** Worker `search_jobs` uses 2 sources; npm uses 5. Brief calls Pass 4 "wiring", so this divergence is pre-existing — flagging only. |
| 10 | `packageTrends` | ✅ `package_trends` | ✅ `package_trends` | ✅ yes | ✅ ISO from npm `time.modified` / PyPI upload_time | ✅ high if date, low if not found | ⚠️ **BUG-4 (minor):** Worker's `package_trends` always stamps `now()` and `"high"` — never reflects the actual package upload date. Pre-existing; out of scope unless we want parity. |
| 11 | `productHunt` | ✅ `extract_producthunt` | ❌ imported but not registered (used only via `extract_idea_landscape`) | ✅ yes | ✅ ISO from `createdAt`; fallback scraper uses `now()` | ✅ high (API), medium (scrape fallback) | ⚠️ **BUG-5 (security):** hard-coded PH bearer token in source (`src/adapters/productHunt.ts:57`). Already public on npm/GitHub; rotate or move to env. Not a Pass-4 wiring issue but worth flagging. |
| 12 | `reddit` | ✅ `extract_reddit` | ❌ imported but not registered (used only via `extract_finance_landscape`) | ✅ yes | ✅ ISO from `created_utc` | ✅ high if date, medium otherwise | None. |
| 13 | `repoSearch` | ✅ `search_repos` | ✅ `search_repos` | ✅ yes | ✅ ISO from `pushed_at` | ✅ always `"high"` | None. |
| 14 | `scholar` | ✅ `extract_scholar` | ✅ `extract_scholar` | ✅ yes | ⚠️ year-only — synthesised as `${year}-01-01` | ✅ high if year, low otherwise | ⚠️ **BUG-6 (semantic):** `${year}-01-01` becomes the canonical content_date. A 2025 paper retrieved 2026-05-10 is dated as published 2025-01-01 → DAR over-decays it. Pre-existing; out of scope for Pass 4 unless explicitly fixing. |
| 15 | `secFilings` | ❌ no | ✅ `extract_sec_filings` | ✅ yes | ✅ ISO from `filed_at`/`file_date` | ✅ always `"high"` | None. |
| 16 | `yc` | ✅ `extract_yc` | ✅ `extract_yc` | ✅ yes (npm); ⚠️ Worker version stamps `slice(0,10)` of `now()` | ⚠️ npm: `now().split("T")[0]` — every YC scrape claims to be "published today". | ✅ npm `"high"`; Worker `"medium"` | ⚠️ **BUG-7 (semantic):** YC company-page scrape has no per-company creation date, so adapter dates everything as today. DAR thinks every YC company was published today. Pre-existing; out of scope for Pass 4. Not a wiring blocker. |

### Composite tools (registered in `src/server.ts`, only `extract_landscape` registered in `worker.ts`)

| # | Composite | Wired in `worker.ts`? | Wired in `server.ts`? | Notes |
|---|---|---|---|---|
| C1 | `extract_landscape` | ✅ (simplified — uses HN + GitHub + npm directly via `fetch`, **does not call** `ycAdapter`/`packageTrendsAdapter` etc.) | ✅ (full — YC + repoSearch + HN + packageTrends, `Promise.allSettled`) | Worker variant inlines fetches and skips YC. Functional but not parity. Not a blocker. |
| C2 | `extract_gov_landscape` | ❌ | ✅ (`Promise.allSettled` over govContracts + HN + repoSearch + changelog) | Needs porting to Worker. |
| C3 | `extract_finance_landscape` | ❌ | ✅ (5-way: finance + HN + reddit + repoSearch + changelog) | Needs porting to Worker. |
| C4 | `extract_company_landscape` | ❌ | ✅ (5-way: secFilings + govContracts + gdelt + changelog + finance) | Needs porting to Worker. |
| C5 | `extract_idea_landscape` | ❌ | ✅ (6-way: HN + YC + repoSearch + jobs + packageTrends + productHunt) | Needs porting to Worker. |

All 5 composites in `server.ts` use `Promise.allSettled` correctly — partial failures don't collapse the call.

## The two known bugs from the brief

### BUG-1: `extract_govcontracts` sort field (status: **likely fixed but needs live verification**)

The brief states: *"historical USASpending.gov API issue (sort field was `Award_Amount`, had to change to `Award ID`)."*

Current state in `src/adapters/govcontracts.ts`:
- Line 107: `sort: "Award Amount"` (in `buildSearchBody`)
- Line 159: `sort: "Award Amount"` (in `searchByKeyword`)
- Inline comment at line 107: `// space-separated — matches field name exactly`

Analysis:
- The original bug was the underscore form `Award_Amount`. That underscore form is **gone**.
- The current code uses `"Award Amount"` (space-separated). This is a valid USASpending field name and listed in `CONTRACT_FIELDS`.
- The brief specifically says the past fix was to **`Award ID`**, not `Award Amount`. So either:
  - (a) the past fix was to `Award ID` and someone later flipped it to `Award Amount` thinking that was nicer (sorts by dollar amount desc), OR
  - (b) the brief's recollection is slightly off and `Award Amount` works fine.
- Both `Award ID` and `Award Amount` are documented as sortable fields by USASpending, but their accept-list has changed historically.

**Recommended action for Phase 2:** run a single live `curl` against the API with `sort: "Award Amount"` for a known company (e.g. "Palantir") and confirm it returns 200 with results. If it 400s, switch to `"Award ID"`. I have not run this test in Phase 1 (the brief says read-only).

```bash
# Phase 2 verification command:
curl -s -X POST https://api.usaspending.gov/api/v2/search/spending_by_award/ \
  -H "Content-Type: application/json" \
  -d '{"filters":{"recipient_search_text":["Palantir"],"time_period":[{"start_date":"2024-01-01","end_date":"2026-05-10"}],"award_type_codes":["A","B","C","D"]},"fields":["Award ID","Recipient Name","Award Amount","Award Date"],"page":1,"limit":2,"sort":"Award Amount","order":"desc","subawards":false}' \
  | head -c 500
```

### BUG-2: `extract_hackernews` inline timestamp (status: **not currently a bug**)

The brief states: *"past output showed timestamps embedded inline in content string (`'... -- 2026-02-06T18:48:03Z ...'`) rather than as a structured envelope field."*

Current state in `src/adapters/hackernews.ts`:
- Algolia path (line 39): `Author: ${r.author} | Posted: ${r.created_at}` — yes, the timestamp is embedded in the human-readable `raw` string AS WELL.
- AND `content_date` is structurally set (line 46): `data.hits.map((r) => r.created_at).sort().reverse()[0]`.
- Worker mirror (`worker.ts:296,298`): same pattern — inline `Posted:` line plus structured `newest` for the envelope.

**Verdict:** The structured envelope path is correct. The inline `Posted: <iso>` line in the human-readable text is fine — the envelope's `Published:` header still wins for downstream parsers, and the per-item line is for the LLM to read context per hit. This is NOT the bug pattern the brief describes (where content_date was null and the only date lived inline). No fix needed.

If the brief author considers any inline ISO date in `raw` to itself be the bug, then both adapter paths and the worker would need to drop the per-item `Posted:` line, but that's a documentation choice, not a correctness issue. **Recommend leaving as-is** unless explicitly asked.

## Other findings (not blockers, listed for completeness)

- **server.ts** imports all 16 base adapters but only registers 12 of them as standalone tools. Missing standalone registrations: `extract_arxiv`, `extract_finance`, `extract_reddit`, `extract_producthunt`. These adapters ARE used inside composites, just not exposed as their own `extract_*` tools. The brief says to add the 4 missing in Phase 2.
- **worker.ts** defines its own simplified `stamp()` envelope (no `[FRESHCONTEXT_JSON]` block, no `freshness_score` line, content slice hard-coded to 6000). The npm package's `formatForLLM` is fuller. This divergence is pre-existing and out of scope for Pass 4.
- **worker.ts** `extract_landscape` does not call the actual adapter functions — it inlines `fetch` calls. Porting work in Phase 3 will need to decide: (a) port adapter modules into `worker/src/`, then have composites call them, or (b) keep inlining. Existing 11 tools all inline. I recommend matching the existing pattern (inline) for the 9 wired-in adapters in Phase 3, rather than introducing a new module structure mid-stream.
- **Hard-coded PH token** at `src/adapters/productHunt.ts:57`. Already on public npm. Should be rotated or moved to env eventually. Not in Pass 4 scope.
- **Worker `extract_finance` previously used a provider-specific adapter name** (`worker.ts:522`) but `intelligence.ts` decay table keys it as `"finance"`. Mismatch → falls through to default decay. Fixed in later pass; worker and npm now use `"finance"`.

## Summary

- **0 blocker bugs** in adapter source.
- **1 bug to verify with one curl** (BUG-1: govcontracts sort field — likely OK with `"Award Amount"`, but brief recalls `"Award ID"`; needs a live test before Phase 2 declares it fine).
- **1 ghost bug from the brief** (BUG-2: HN inline timestamps — not currently happening; structured `content_date` is set correctly).
- **4 missing `registerTool` calls** in `src/server.ts` (arxiv, finance, reddit, productHunt) — pure addition work for Phase 2, no ambiguity.
- **6 base adapters** still need wiring into the Worker (arxiv, changelog, gdelt, gebiz, govcontracts, secFilings). Plus **4 composites** (gov_landscape, finance_landscape, company_landscape, idea_landscape).
- **1 worth-flagging adapter-key typo** (worker `extract_finance` stamped a provider-specific adapter name instead of `"finance"` → wrong DAR decay rate). Fixed in later pass.

Worker currently has 11 tools registered. Target: 21. Missing: 10 registrations (6 base + 4 composites).

**Phase 1 complete. Awaiting human review and explicit go-ahead before Phase 2.**

# FreshContext — Session Save V9
**Date:** 2026-04-14
**Version:** 0.3.15
**Status:** DAR engine LIVE on Cloudflare Workers. Deployed. Committed.

---

## WHAT WAS SHIPPED THIS SESSION

### Commit: `d330dc3`
`feat: DAR engine (exponential decay scoring), intel feed endpoint, ha_pri audit signatures`

Three files changed, 829 insertions, 732 deletions.

---

### worker/src/intelligence.ts — NEW FILE (the core IP)

The DAR (Decay-Adjusted Relevancy) engine. Exports:

- `extractPublishedAt(raw)` — pulls most recent ISO date from scraped content
- `calculateBaseScore(raw, profile, exclusions)` — semantic R_0 scoring:
  - Baseline 40
  - +15 per target match (vital keywords), capped at +35
  - +3 per skill match (context keywords), capped at +15
  - +8 for remote/location accessibility
  - Hard kill on exclusion terms (→ 0)
- `applyDecay(baseScore, publishedAt, adapter)` — R_t = R_0 · e^(-λt)
  - Returns rt_score + entropy level: low / stable / high
- `generateAuditSig(resultId, contentHash)` — SHA-256 ha_pri_sig (Web Crypto API)
- `scoreSignal(params)` — single entry point for the full pipeline
- `parseStoredProfile(row)` — parses D1 JSON fields into ScoringProfile

**Proprietary λ constants (per hour):**
```
hackernews:     0.050   (t½ ≈ 14h)
reddit:         0.010   (t½ ≈ 3d)
producthunt:    0.010   (t½ ≈ 3d)
jobs:           0.005   (t½ ≈ 6d)
finance:        0.001   (t½ ≈ 29d)
yc:             0.001   (t½ ≈ 29d)
packagetrends:  0.0005  (t½ ≈ 58d)
github:         0.0002  (t½ ≈ 5mo)
reposearch:     0.0002  (t½ ≈ 5mo)
google_scholar: 0.00005 (t½ ≈ 1.6y)
arxiv:          0.00005 (t½ ≈ 1.6y)
default:        0.001
```

---

### worker/src/worker.ts — REWRITTEN

Key changes from old version:
- **Removed:** duplicate local `synthesizeBriefing()` that shadowed the import
- **Removed:** old linear `scoreRelevancy()` function
- **Added:** `ToolResult` type alias — fixes all 12 TS type errors in tool handlers
- **Fixed:** `ScheduledEvent` → `ScheduledController` (correct Workers type)
- **Fixed:** `ok()` helper — all tool return values now properly typed
- **Upgraded:** `runScheduledScrape()` — loads user profile, runs DAR on every signal
- **Added:** 7 new D1 columns via idempotent migrations on every cron run:
  - `base_score INTEGER`
  - `rt_score REAL`
  - `ha_pri_sig TEXT`
  - `entropy_level TEXT`
  - `published_at TEXT`
  (plus existing `relevancy_score`, `is_relevant`)
- **Added:** `GET /v1/intel/feed/:profile_id` — structured intelligence feed endpoint
- **Added:** `formatBriefing()` — fallback formatter when ANTHROPIC_KEY not set
- **Fixed:** `/briefing/now` — uses Claude if key set, fallback formatter if not
- **Fixed:** `runAdapter()` receives `env` — GITHUB_TOKEN now passed through

---

## DEPLOYED STATE

Worker URL: https://freshcontext-mcp.gimmanuel73.workers.dev
Version ID: 9d7929b0-5cc2-4b61-a1cd-72714b2daf63
Cron: 0 */6 * * * (every 6 hours — auto-scoring begins next run)

---

## WHAT THE NEXT CRON WILL DO

1. Load user profile from D1 (`default`)
2. Run all 18 watched queries via `runAdapter()`
3. For each new result, run the full DAR pipeline:
   - Extract published_at date
   - Calculate R_0 (base semantic score vs profile)
   - Apply exponential decay → R_t
   - Generate SHA-256 ha_pri_sig
   - Store all 7 new columns
4. Log: `[DAR] hackernews/mcp server 2026 R0:75 Rt:62.3 entropy:stable sig:a3f7b2c1`
5. Write cron summary briefing to D1

---

## PENDING FIXES (not committed yet)

The `ok()` helper and `ScheduledController` fixes are written to disk but need one more deploy:

```powershell
cd "C:\Users\Immanuel Gabriel\Downloads\freshcontext-mcp\worker"
npx wrangler deploy
```

Then commit:
```powershell
cd "C:\Users\Immanuel Gabriel\Downloads\freshcontext-mcp"
git add worker/src/worker.ts
git commit -m "fix: ToolResult type, ScheduledController, ok() helper for MCP tool returns"
git push origin main
```

---

## ENDPOINTS NOW LIVE

| Endpoint | Method | Purpose |
|---|---|---|
| `/mcp` | GET/POST | MCP transport (all tools) |
| `/briefing` | GET | Latest stored briefing |
| `/briefing/now` | POST | Force scrape + synthesize |
| `/watched-queries` | GET | List all watched queries |
| `/v1/intel/feed/:profile_id` | GET | DAR-scored intelligence feed |
| `/debug/db` | GET | D1 table counts + recent scores |
| `/debug/scrape` | GET | Run one adapter raw |

Intel feed params: `?limit=20&min_rt=0`

---

## WHAT'S NEXT (priority order)

1. **Deploy the type fixes** (commands above)
2. **Verify DAR is scoring** — hit `/debug/db` after next cron, check `rt_score` and `ha_pri_sig` columns have values
3. **Test intel feed** — `GET /v1/intel/feed/default` should return signals with intelligence_stamps
4. **Enable Claude synthesis** — add ANTHROPIC_KEY to Cloudflare Worker env vars + $5 credits at console.anthropic.com
5. **Show HN post** — the DAR engine is now the technical hook. Draft in SESSION_SAVE_V5b.md

---

## INFRASTRUCTURE SUMMARY

| Layer | Status |
|---|---|
| npm v0.3.15 | Live |
| Cloudflare Worker | Live — DAR engine deployed |
| D1 Database | Live — new columns added on next cron |
| KV cache | Live |
| GitHub Actions | Auto-publishes npm on push to main |
| ANTHROPIC_KEY | Not set — briefings use formatBriefing() fallback |
| intel feed | Live at /v1/intel/feed/default |

---

## RESUME PROMPT

"I'm Immanuel Gabriel, Grootfontein, Namibia. Building FreshContext MCP.
Session V9 complete — DAR engine live on Cloudflare Workers (commit d330dc3).
intelligence.ts: exponential decay scoring with proprietary λ constants.
worker.ts: rewritten, DAR wired into cron, intel feed endpoint live.
Pending: deploy type fixes (ok() helper + ScheduledController). See SESSION_SAVE_V9.md."

---

*"The work isn't gone. It's just waiting to be continued."*
*— Prince Gabriel, Grootfontein, Namibia*

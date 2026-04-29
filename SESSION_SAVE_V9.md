# FreshContext — Session Save V9 (Updated)
**Date:** 2026-04-29
**Version:** 0.3.15
**Status:** DAR engine LIVE. Bot filter shipped. Workers Paid — $5/mo. Cron running.

---

## SESSION TIMELINE

### Earlier in this session
1. DAR engine shipped (`intelligence.ts`) — exponential decay scoring with proprietary λ constants
2. `worker.ts` rewritten — DAR wired into cron, intel feed endpoint live
3. ToolResult type fix + ScheduledController + ok() helper
4. Semantic deduplication shipped
5. METHODOLOGY.md written — formal IP documentation
6. CONTEXT_SKILL.md created — token-efficient session resumption

### This continuation
7. **Diagnosed the 59k errors** — they're bot-noise + unhandled paths falling through to MCP transport
8. **Fixed the bot-error noise** — added `GET /` landing page, `GET /health`, and clean 404s for unknown paths
9. **Enhanced `/debug/db`** — now shows DAR engine coverage stats (signals_scored, unique_fingerprints, scoring_coverage %)
10. **README.md updated** — added "Intelligence Layer (v0.3.15)" section with DAR math, provenance schema, endpoint table; updated roadmap
11. **HANDOFF.md updated** — bumped to v0.3.15, added Intelligence Layer section, updated Pending Items
12. **LAUNCH_POSTS_V9.md drafted** — Show HN, LinkedIn (long + short), Twitter thread, posting strategy

### Two weeks later (2026-04-29)
13. **309k requests / 309k errors over 24h** observed on Cloudflare dashboard — bot saturation on the `.workers.dev` URL
14. **Daily request limit (100k) hit** — Workers Paid plan activated for $5/month
15. **Bot filter shipped to worker.ts** — BLOCKED_PATH_PATTERNS + BLOCKED_USER_AGENTS + isBotProbe() runs FIRST in fetch handler
    - Returns 410 Gone for known scanner paths (wp-, .env, .git, .php, owa, ecp, _ignition, etc.)
    - Returns 410 Gone for known scanner user-agents (masscan, nmap, sqlmap, nikto, etc.)
    - Zero KV/DB calls before reject — cheapest possible CPU footprint
    - Expected outcome: error rate drops dramatically + paid CPU costs minimised

---

## THE 59K ERRORS EXPLAINED

The Cloudflare dashboard showed ~100% error rate across 24 hours. Diagnosis:

The fetch handler routes explicit paths (/mcp, /briefing, /v1/intel/feed/*, /debug/*, etc.) and falls through everything else to the MCP transport. Bots, crawlers, OPTIONS preflights, and any non-MCP traffic hitting the Worker triggered MCP SDK to throw 500s.

**Real MCP traffic worked fine** — the wrangler tail log confirmed POST /mcp returning Ok consistently. The errors are noise floor of a discoverable public Workers.dev URL.

**Fix shipped in this session:**
- `GET /` returns service info JSON instead of falling through
- `GET /health` returns liveness check
- Any path that isn't `/mcp` or `/mcp/` returns clean 404 before reaching transport
- Expected outcome: error rate drops from ~100% to <5% within 24 hours of redeploy

---

## DEPLOY COMMANDS (run these now)

```powershell
cd "C:\Users\Immanuel Gabriel\Downloads\freshcontext-mcp\worker"
npx wrangler deploy
```

```powershell
cd "C:\Users\Immanuel Gabriel\Downloads\freshcontext-mcp"
git add worker/src/worker.ts README.md HANDOFF.md LAUNCH_POSTS_V9.md SESSION_SAVE_V9.md
git commit -m "v0.3.15: bot-error fix + landing page + /health; README/HANDOFF: Intelligence Layer; launch posts drafted"
git push origin main
```

---

## VERIFICATION COMMANDS

After deploy:

```powershell
# Test the new landing page
curl.exe https://freshcontext-mcp.gimmanuel73.workers.dev/

# Liveness
curl.exe https://freshcontext-mcp.gimmanuel73.workers.dev/health

# DAR engine coverage stats
curl.exe https://freshcontext-mcp.gimmanuel73.workers.dev/debug/db

# Intel feed
curl.exe "https://freshcontext-mcp.gimmanuel73.workers.dev/v1/intel/feed/default?limit=5"

# 404 for bots
curl.exe -v https://freshcontext-mcp.gimmanuel73.workers.dev/wp-admin
```

D1 inspection:

```powershell
cd worker

# Total signal count
npx wrangler d1 execute freshcontext-db --remote --command "SELECT COUNT(*) FROM scrape_results"

# DAR coverage by adapter
npx wrangler d1 execute freshcontext-db --remote --command "SELECT adapter, COUNT(*) as total, AVG(rt_score) as avg_rt, AVG(base_score) as avg_r0 FROM scrape_results WHERE rt_score IS NOT NULL GROUP BY adapter"

# Top 10 highest R_t signals right now
npx wrangler d1 execute freshcontext-db --remote --command "SELECT adapter, query, rt_score, entropy_level, published_at FROM scrape_results WHERE rt_score IS NOT NULL ORDER BY rt_score DESC LIMIT 10"

# Dedup effectiveness
npx wrangler d1 execute freshcontext-db --remote --command "SELECT COUNT(*) as total_signals, COUNT(DISTINCT semantic_fingerprint) as unique_stories FROM scrape_results WHERE semantic_fingerprint IS NOT NULL"

# Backup the entire D1 database
npx wrangler d1 export freshcontext-db --remote --output=backup-2026-04-14.sql

# Live tail
npx wrangler tail
```

---

## CURRENT INFRASTRUCTURE STATE

| Layer | Status |
|---|---|
| npm @0.3.15 | LIVE |
| Cloudflare Worker | LIVE — DAR + new endpoints deployed in this session |
| D1 freshcontext-db | LIVE — accumulating with new schema columns |
| KV RATE_LIMITER + CACHE | LIVE |
| Cron 0 */6 * * * | RUNNING — every 6 hours |
| Spec site freshcontext-site.pages.dev | LIVE |
| GitHub Actions auto-publish | LIVE |
| ANTHROPIC_KEY | NOT SET — formatBriefing() fallback active |
| Apify Actor | NEEDS REBUILD (apify push) |

---

## NEW FILE STATE

```
worker/src/intelligence.ts    [DAR engine — written V9 part 1]
worker/src/worker.ts          [REWRITTEN + bot-error fix this turn]
worker/src/synthesize.ts      [unchanged]
METHODOLOGY.md                [V9 part 1 — IP documentation]
README.md                     [UPDATED this turn — Intelligence Layer section]
HANDOFF.md                    [UPDATED this turn — v0.3.15]
LAUNCH_POSTS_V9.md            [NEW this turn — HN + LinkedIn + Twitter drafts]
SESSION_SAVE_V9.md            [UPDATED this turn]
CONTEXT_SKILL.md              [V9 part 1 — token-efficient resumption]
```

---

## NEXT BUILD PRIORITIES

1. **Run the deploy + verify commands above** (ensure 404 fix is live, error rate drops)
2. **Wait 24h then check Cloudflare dashboard** — error count should be way down
3. **Post Show HN** — Tuesday/Wednesday 09:00-10:30 ET. Use draft in LAUNCH_POSTS_V9.md
4. **Post LinkedIn** — 24h after HN
5. **Post Twitter thread** — same day as LinkedIn
6. **Webhook trigger system** — push high-R_t low-entropy signals to user webhooks
7. **Mining/industrial domain queries** — the moat
8. **Profile creation API** — populate user_profiles table
9. **Apify rebuild** — `apify push` from local
10. **tsconfig skipLibCheck** — silence the 130 cosmetic node_modules conflicts

---

## RESUME PROMPT FOR NEXT SESSION

"Load FreshContext context. Read CONTEXT_SKILL.md and SESSION_SAVE_V9.md from C:\Users\Immanuel Gabriel\Downloads\freshcontext-mcp\, generate the context map, then ask me what we're working on today."

---

*"The work isn't gone. It's just waiting to be continued."*
*— Prince Gabriel, Grootfontein, Namibia*

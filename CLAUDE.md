# Claude Code Briefing — FreshContext

This file is read automatically by Claude Code at the start of every session. It tells you what this project is, where things are, and how I prefer to work.

## What FreshContext Is

A freshness-aware web intelligence MCP server. Every retrieved signal is scored with the Decay-Adjusted Relevancy (DAR) engine: `R_t = R_0 · e^(-λt)`. The system runs as a Cloudflare Worker, persists signals to D1 with provenance signatures, and exposes both an MCP transport (`/mcp`) and a plain HTTP intelligence feed (`/v1/intel/feed/:profile_id`).

**Production:** https://freshcontext-mcp.gimmanuel73.workers.dev
**Repo:** https://github.com/PrinceGabriel-lgtm/freshcontext-mcp
**npm:** `freshcontext-mcp@0.3.15`

## Author

Immanuel Gabriel (Prince Gabriel), Grootfontein, Namibia. Solo developer. No team.

**Timezone:** CAT (UTC+2). Year-round, no DST.
**Working hours:** Often late nights. Don't assume "morning" or "end of day" without checking.
**If timestamp matters** (scheduling, deadlines, "how long since X"): ask the user to run `tc` (the time-check script in the repo root) and paste the output. It prints local time, UTC, US ET equivalent, and the day-of-week.

## US Eastern Time conversion (for HN posting windows)

- CAT is UTC+2, ET is UTC-4 (summer) or UTC-5 (winter)
- **Summer (mid-March to early November):** CAT - 6h ≈ ET
- **Winter (early November to mid-March):** CAT - 7h ≈ ET
- HN morning sweet spot (09:00–10:30 ET) ≈ 15:00–16:30 CAT in summer


## Architecture

```
adapter ingestion
  → freshness envelope
  → semantic dedup
  → DAR scoring
  → D1 ledger (immutable)
  → intelligence feed
  → MCP / HTTP consumer
```

Key code locations:
- `worker/src/worker.ts` — main fetch handler, MCP transport, cron, all routes
- `worker/src/intelligence.ts` — DAR engine (scoreSignal, applyDecay, semanticFingerprint, isDuplicate)
- `worker/src/synthesize.ts` — Claude briefing synthesis (paused, needs ANTHROPIC_KEY)
- `src/` — local MCP server (npm package)
- `_archive/` — historical session saves and superseded plans (do not modify)

## Live Configuration

- **D1:** `freshcontext-db` (id: `d9898d65-f67e-4dcb-abdc-7f7b53f2d444`)
- **KV:** `RATE_LIMITER` (`7b74255ddbee42a99feea5898a11842b`), `CACHE` (`2bfd2b8f371345d493af520644364c6c`)
- **Cron:** `0 */6 * * *` (every 6 hours)
- **Plan:** Workers Paid ($5/mo, activated 2026-04-29)
- **Bot filter:** live since 2026-04-29; blocks scanner paths and UAs with 410 Gone

## API Key

Stored at `.api-key.local.txt` (gitignored). Load into shell with:
```powershell
$env:FC_KEY = Get-Content .api-key.local.txt
```

## How I Prefer To Work

1. **Verify before changing.** Run a query against the live system or read the existing code before assuming. Don't pattern-match.
2. **Smallest diff that solves the problem.** No rewrites. No refactors unless I asked. Add code, don't restructure code.
3. **Explain what you're about to do before doing it.** One short paragraph. Then do it.
4. **Show me `git status` and `git diff` before committing.** I commit, not you, unless I explicitly say "commit and push".
5. **No marketing language.** No "this stops being a tool and starts being infrastructure". Plain technical English.
6. **Numbers from the live system, not from memory.** Run `curl` against `/debug/db` if you need current stats.
7. **Defer scope expansion.** If I ask for X and you notice Y is also broken, mention Y and wait. Don't fix Y in the same change.

## Things That Are Done (do not redo)

- DAR engine implementation
- Bot/scanner filter (errors -87% after deploy)
- Semantic deduplication
- METHODOLOGY.md (formal IP documentation)
- README.md Intelligence Layer section
- HANDOFF.md v0.3.15
- /health, /debug/db, landing page
- npm auto-publish via GitHub Actions
- Workers Paid plan
- Repo cleanup (session saves moved to _archive/)

## Things Pending

- Defensive valves in `intelligence.ts`: clock skew rejection, hard floor (`R_t < 5` → mark expired), lazy decay at read time
- Switch cron from full recompute to lazy decay
- `apify push` to rebuild the Apify Actor
- Add `"skipLibCheck": true` to `tsconfig.json`
- `RISKS.md` documenting the stress-test analysis (frozen signal paradox, clock skew, floating-point underflow, re-ignition gap, CPU timeout risk)
- ANTHROPIC_KEY setup (waiting on Catatonica revenue) → enables `synthesize.ts` Claude path

## Things Drafted, Not Posted

- `freshcontext/HN_THROWAWAY_FRIDAY.md` — Friday ops post (optional)
- `freshcontext/LAUNCH_POSTS_TUESDAY.md` — main Show HN, target Tuesday 2026-05-05 16:00 CAT

## Common Commands

```powershell
# Deploy worker
cd worker && npx wrangler deploy

# Check live state
$env:FC_KEY = Get-Content ..\.api-key.local.txt
curl.exe -H "Authorization: Bearer $env:FC_KEY" https://freshcontext-mcp.gimmanuel73.workers.dev/debug/db

# D1 direct query
npx wrangler d1 execute freshcontext-db --remote --command "SELECT COUNT(*) FROM scrape_results"

# Backup D1 (don't commit the output)
npx wrangler d1 export freshcontext-db --remote --output=backup-$(Get-Date -Format yyyy-MM-dd).sql

# Live tail
npx wrangler tail
```

## Out Of Scope

Don't suggest these unless I bring them up:
- Vector DB integration (premature; dataset is 1k signals)
- Multi-tenant isolation (one user; me)
- Write-back provenance endpoint (no consumer asking for it)
- Agent loop architecture (no agent yet)
- Migration to a different platform (Cloudflare is fine)
- Monorepo restructuring

The system is small and works. Keep it that way until a real customer or signal demands otherwise.

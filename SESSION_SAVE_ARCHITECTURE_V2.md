# FreshContext — Architecture Session V2 Save
**Date:** 2026-03-19
**Session type:** Architecture upgrades complete + new composite adapters planned
**npm version:** 0.3.10 (GitHub Actions publishes automatically on every push now)

---

## What Was Completed This Session

### All 7 Architecture Upgrades — DONE

| # | Upgrade | Status | Notes |
|---|---|---|---|
| 1 | freshness_score numeric field | DONE | Implemented in src/tools/freshnessStamp.ts |
| 2 | Cloudflare KV response caching | DONE | Already in worker.ts — discovered not missing |
| 3 | Apify Actor timeout increase | DONE | Changed to 3600s in Apify UI |
| 4 | D1 deduplication in cron job | DONE | Already in runScheduledScrape as hash-based dedup |
| 5 | Structured JSON response form | DONE | FRESHCONTEXT_JSON block appended to every response |
| 6 | GitHub Actions CI/CD | DONE | .github/workflows/publish.yml live, 23s green run |
| 7 | server.json version sync | DONE | Updated to 0.3.10, description to 13 tools |

### Key implementation details

Upgrade 1 — freshnessStamp.ts now calculates max(0, 100 - (days × decayRate)) per adapter.
Decay rates: finance=5.0, jobs=3.0, hackernews/reddit/producthunt=2.0, yc/govcontracts=1.5,
github/repoSearch/packageTrends/changelog=1.0, scholar/arxiv=0.3, default=1.5.
Returns null when content_date is unknown. Returns 0 when score would go negative.
Score label added: current (90+), reliable (70+), verify before acting (50+), use with caution (<50).

Upgrade 5 — Every response now emits both:
  [FRESHCONTEXT]...[/FRESHCONTEXT]  ← text envelope for AI agents
  [FRESHCONTEXT_JSON]...{...}...[/FRESHCONTEXT_JSON]  ← structured JSON for programmatic use
JSON form contains: source_url, content_date, retrieved_at, freshness_confidence,
freshness_score, adapter, content. toStructuredJSON() is exported from freshnessStamp.ts.

### Command reference HTML cheat sheet
FRESHCONTEXT_COMMANDS.html was created and delivered as a downloadable file.
Dark theme, click-to-copy cards, organized by: Landscape, Intelligence, Competitive,
Market data, Unique adapters, Power combos. Open in any browser, click a card to copy
the command, paste into Claude.

---

## Next Session — Two New Composite Adapters

### Adapter 1: extract_gov_landscape
"Gov contracts for developers"

The idea: a single call that gives a complete government intelligence picture on a
company or keyword. Not just the contract data, but whether the companies winning
those contracts are actually shipping code and whether the developer community knows
about them.

Sources to combine in parallel:
  - extract_govcontracts — who won, how much, which agency, when
  - extract_github — are the winning companies actually building (stars, last commit, language)
  - extract_hackernews — does the dev community know about them
  - extract_changelog — are they shipping product (release velocity as a health signal)

Input: company name, keyword, or NAICS code (same as extract_govcontracts)
Output: unified FreshContext envelope with sections for each source, all timestamped

Why it matters: A $50M DoD contract winner with no GitHub commits in 6 months and
zero HN mentions is a very different company from one that's been pushing code weekly
and has 3 HN front-page mentions. This composite surfaces that difference in one call.

Location: src/adapters/govLandscape.ts
Tool name: extract_gov_landscape

### Adapter 2: extract_finance_landscape
"Finance for developers"

The idea: a stock price is a backward-looking lagging indicator. What a technical
investor or developer actually needs is price combined with the signals only FreshContext
can surface — developer community sentiment, engineering velocity, ecosystem activity.

Sources to combine in parallel:
  - extract_finance — live price, market cap, P/E, 52w range (Yahoo Finance)
  - extract_hackernews — what are developers saying about this company right now
  - extract_reddit — investor and developer community sentiment (r/investing + tech subs)
  - search_repos — how many GitHub repos orbit this company's ecosystem
  - extract_changelog — is the company actually shipping product (release velocity)

Input: ticker symbol(s) e.g. "PLTR" or "PLTR,MSFT"
Output: unified FreshContext envelope with sections for each source, all timestamped

Why it matters: Bloomberg Terminal doesn't read GitHub commit history as a company
health signal. FreshContext does. This composite is something no existing financial
tool offers — developer-native market intelligence with freshness scores on every source.

Location: src/adapters/financeLandscape.ts
Tool name: extract_finance_landscape

### Pattern to follow
Both adapters should follow the exact same structure as extract_landscape in
src/adapters/landscape.ts — use Promise.allSettled for parallel calls, handle
partial failures gracefully (if one source fails, the others still return),
wrap the combined output in a single FreshContext envelope with sections clearly
labelled per source.

---

## Current Stack State

| Layer | Status |
|---|---|
| npm | freshcontext-mcp@0.3.10, auto-publishes via GitHub Actions |
| Cloudflare Worker | Live, KV caching active, rate limiting active |
| D1 Database | 18 watched queries, 6h cron, hash-based dedup |
| Synthesis | PAUSED — needs $5 Anthropic credits at console.anthropic.com |
| Apify Actor | Published, Dockerfile fixed, timeout 3600s |
| GitHub Actions | Live — push to main = auto build + publish |
| MCP Registry | server.json v0.3.10, 13 tools description |
| Payoneer | Approved — Customer ID 102746504 |

## Outreach Status

| Target | Email | Status |
|---|---|---|
| Apify | jan@apify.com | Sent |
| Clay | kareem@clay.com | Sent |
| n8n | jan@n8n.io | Sent |
| Cloudflare Startups | startups@cloudflare.com | Sent — awaiting reply (10 business days) |
| Anthropic | partnerships@anthropic.com | Sent |
| Apollo.io | hello@apollo.io | Sent this session |
| Harmonic.ai | hello@harmonic.ai | Sent this session |
| GitHub Partnerships | partnerships@github.com | Sent this session |

---

## Resume Prompt for Next Session

"I'm building freshcontext-mcp — 13-tool web intelligence MCP server, fully
spec-compliant, GitHub Actions CI/CD live, all 7 architecture upgrades complete.
Next task: build two new composite adapters — extract_gov_landscape (govcontracts +
github + hackernews + changelog in parallel) and extract_finance_landscape (finance
+ hackernews + reddit + search_repos + changelog in parallel). Both follow the
extract_landscape pattern in src/adapters/landscape.ts. See SESSION_SAVE_ARCHITECTURE_V2.md
for full spec."

*"The work isn't gone. It's just waiting to be continued."*
*— Prince Gabriel, Grootfontein, Namibia*

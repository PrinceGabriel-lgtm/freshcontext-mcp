# FreshContext — Handoff Document
**Version:** 0.3.14 (npm) / 0.21 (Apify)
**Spec:** v1.1
**Date:** 2026-04-09
**Author:** Immanuel Gabriel (Prince Gabriel), Grootfontein, Namibia
**Contact:** gimmanuel73@gmail.com

---

## What You Are Receiving

FreshContext is a **data freshness layer for AI agents** — an open standard and reference implementation that makes retrieved data trustworthy.

Every piece of web data an AI agent retrieves has an age. Most tools ignore it. FreshContext surfaces it — wrapping every result in a structured envelope:

```
[FRESHCONTEXT]
Source: https://github.com/owner/repo
Published: 2024-11-03
Retrieved: 2026-04-05T09:19:00Z
Confidence: high
---
... content ...
[/FRESHCONTEXT]
```

**20 tools. No API keys. Deployed globally on Cloudflare's edge.**

Listed on the official MCP Registry, npm, and Apify Store. The FreshContext Specification v1.1 is published as an open standard under MIT license — any tool that wraps retrieved data in this envelope is FreshContext-compatible.

**npm downloads (first week, zero marketing): 191**

---

## The 20 Tools

### Standard (11)
`extract_github`, `extract_hackernews`, `extract_scholar`, `extract_arxiv`,
`extract_reddit`, `extract_yc`, `extract_producthunt`, `search_repos`,
`package_trends`, `extract_finance`, `search_jobs`

### Composite Landscapes (5)
| Tool | Sources | What it delivers |
|---|---|---|
| `extract_landscape` | 6 | YC + GitHub + HN + Reddit + Product Hunt + npm |
| `extract_idea_landscape` | 6 | HN + YC + GitHub + Jobs + npm + Product Hunt — full idea validation |
| `extract_gov_landscape` | 4 | Gov contracts + HN + GitHub + changelog |
| `extract_finance_landscape` | 5 | Finance + HN + Reddit + GitHub + changelog |
| `extract_company_landscape` | 5 | SEC + govcontracts + GDELT + changelog + finance |

### Unique — Not Available in Any Other MCP Server (5)
| Tool | Source | What it delivers |
|---|---|---|
| `extract_changelog` | GitHub Releases API / npm / auto-discover | Update history from any repo, package, or website |
| `extract_govcontracts` | USASpending.gov | US federal contract awards — company, amount, agency, period |
| `extract_sec_filings` | SEC EDGAR | 8-K filings — legally mandated material event disclosures |
| `extract_gdelt` | GDELT Project | Global news intelligence — 100+ languages, every country, 15-min updates |
| `extract_gebiz` | data.gov.sg | Singapore Government procurement tenders — open dataset, no auth |

---

## Services and Infrastructure

### 1. GitHub Repository
URL: https://github.com/PrinceGabriel-lgtm/freshcontext-mcp
Branch: main
Transfer method: GitHub Settings → Transfer ownership
Contents: All TypeScript source, Dockerfile, specs, session saves, roadmap, CI/CD

### 2. npm Package
Package: `freshcontext-mcp` (v0.3.14)
URL: https://www.npmjs.com/package/freshcontext-mcp
Account: immanuel-gabriel on npmjs.com
Transfer method: `npm owner add new-username freshcontext-mcp`
Note: Auto-published via GitHub Actions on every push to main

### 3. Cloudflare Account
| Resource | Details |
|---|---|
| Worker | freshcontext-mcp — the live MCP endpoint |
| D1 | freshcontext-db — ID: d9898d65-f67e-4dcb-abdc-7f7b53f2d444 |
| KV | RATE_LIMITER and CACHE — IDs in wrangler.jsonc |
| Cron | `0 */6 * * *` — runs automatically every 6 hours |
| Endpoint | https://freshcontext-mcp.gimmanuel73.workers.dev/mcp |

Transfer method: Add new account as Super Administrator, remove original.
D1 export: `wrangler d1 export freshcontext-db --output=dump.sql`

Features live on the Worker:
- KV response caching (adapter-specific TTLs)
- Global rate limiting (60 req/min per IP across all edge nodes)
- 6-hour cron scraper with relevancy scoring (0-100, noise below 35 filtered)
- Hash-based deduplication on all cron results

### 4. Apify Actor
Actor: `prince_gabriel/freshcontext-mcp`
Version: 0.21 (build 0.21.2 — tested and confirmed working April 2026)
URL: https://apify.com/prince_gabriel/freshcontext-mcp
Monetization: $50.00 per 1,000 results (Pay per event)
Transfer method: Re-publish under new Apify account using `apify push`
Note: Use `apify push` from local — GitHub cloning is blocked on Apify's build servers

### 5. MCP Registry Listing
Entry: `io.github.PrinceGabriel-lgtm/freshcontext`
Config: `server.json` in the GitHub repo
Transfer method: Update server.json with new repo URL and re-submit

### 6. GitHub Actions CI/CD
File: `.github/workflows/publish.yml`
Action: On every push to main — `npm ci` → `tsc` → `npm publish`
Secret: `NPM_TOKEN` (granular access token from npmjs.com, renew annually)

### 7. PitchHut Listing
URL: https://pitchhut.com/project/freshcontext-mcp-tools
Account: gimmanuel73@gmail.com
Status: Claimed April 2026

---

## Credentials Map

| Credential | Where Used | Location |
|---|---|---|
| API_KEY | Worker auth header | Cloudflare env var |
| ANTHROPIC_KEY | Synthesis/briefing endpoint | Cloudflare env var |
| GITHUB_TOKEN | GitHub API rate limit bypass | Cloudflare env var |
| NPM_TOKEN | GitHub Actions auto-publish | GitHub secret |
| Stripe keys | Catatonica payments | Supabase / Cloudflare env |

---

## Codebase Map

```
src/
  server.ts          — MCP stdio server, all 20 tools registered here
  apify.ts           — Apify Actor entry point (read input, call adapter, exit)
  security.ts        — URL validation, SSRF prevention, domain allowlists
  types.ts           — FreshContext, AdapterResult, ExtractOptions interfaces
  adapters/          — One file per data source (18 files)
    changelog.ts         UNIQUE: GitHub Releases API + npm + auto-discover
    govcontracts.ts      UNIQUE: USASpending.gov federal contract awards
    secFilings.ts        UNIQUE: SEC EDGAR 8-K filings
    gdelt.ts             UNIQUE: GDELT global news intelligence
    gebiz.ts             UNIQUE: Singapore GeBIZ procurement
  tools/
    freshnessStamp.ts  — Score calculation, JSON form, text envelope

worker/src/worker.ts   — Cloudflare Worker: 20 tools + KV cache + rate limit
                         + D1 cron scraper + relevancy scoring + briefing formatter

.actor/
  Dockerfile         — apify/actor-node-playwright-chrome:20 base image
  actor.json         — version: "0.21", Apify Actor metadata

FRESHCONTEXT_SPEC.md   — The open standard v1.1 (MIT license)
ROADMAP.md             — 10-layer product vision
HANDOFF.md             — This file
SESSION_SAVE_V6.md     — Most recent session save (April 2026)
server.json            — MCP Registry listing
.github/workflows/
  publish.yml          — GitHub Actions CI/CD
```

---

## D1 Database Schema

```
watched_queries     18 active monitored topics
  id, adapter, query, label, filters, enabled, last_run_at

scrape_results      Raw results, deduplicated by content hash
  id, watched_query_id, adapter, query, raw_content, result_hash,
  is_new, scraped_at, relevancy_score

briefings           Formatted intelligence reports per cron run
  id, user_id, summary, new_results_count, adapters_run, created_at

user_profiles       Personalization data for briefing synthesis
  id, name, skills, certifications, targets, location, context
```

---

## The FreshContext Specification v1.1

`FRESHCONTEXT_SPEC.md` is the open standard, MIT license, authored March 2026, updated April 2026.

Key additions in v1.1 vs v1.0:
- Domain-specific decay rate table (financial: 5.0 → academic: 0.3)
- Composite Adapters section — defines how multi-source tools handle envelopes
- Compatibility Levels: compatible / aware / scored
- Reference implementation updated to 20 adapters

Any implementation returning the `[FRESHCONTEXT]...[/FRESHCONTEXT]` envelope or the structured JSON form with `freshcontext.retrieved_at` and `freshcontext.freshness_confidence` is FreshContext-compatible.

**The spec is the durable asset. The code is the reference implementation.**

---

## The Best Demo

Run this in Claude with FreshContext connected:

```
Use extract_company_landscape with company "Palantir" and ticker "PLTR"
```

Returns in one call, all timestamped:
- Q4 2025 SEC 8-K filing — revenue $1.407B (+70% YoY), Rule of 40 score 127%
- $1.1B+ in federal contracts from USASpending.gov across DoD, DHS, VA, DoE
- Global news coverage from GDELT — ICE/Medicaid controversy, UK MoD warning
- Live PLTR price, market cap ~$370B, P/E 244x from Yahoo Finance

Bloomberg Terminal doesn't read commit history as a company health signal. FreshContext does.

---

## What Keeps Running Without You

The Cloudflare cron fires every 6 hours automatically. Every run:
1. Scrapes all 18 watched queries across all adapters
2. Deduplicates results by content hash
3. Scores each result for relevancy (0-100)
4. Filters noise below 35
5. Stores new signals in D1
6. Formats a briefing sorted by relevancy score

The dataset accumulates indefinitely. No action required.

---

## Valuation Reference

### FreshContext
| Deal type | Ask | Accept | Walk below |
|---|---|---|---|
| White-label licence | $8K/mo | $2–3K/mo | $1,500/mo |
| Full acquisition | $500K | $80–150K | $50K |

### Catatonica
| Deal type | Ask | Accept | Walk below |
|---|---|---|---|
| White-label licence | $5K/mo | $1.5–2.5K/mo | $800/mo |
| Full acquisition | $250K | $30–75K | $20K |

---

## Active Outreach at Time of Handoff (April 2026)

### FreshContext — AGI Leasing Pitch Sent
OpenAI (partner form submitted + partnerships@openai.com),
Anthropic (partnerships@anthropic.com),
Google (partnerships@google.com),
xAI (partnerships@x.ai),
Cohere (partnerships@cohere.com),
Meta AI (ai-partnerships@meta.com),
Perplexity (partnerships@perplexity.ai),
Mistral (partnerships@mistral.ai),
Hugging Face (partnerships@huggingface.co),
DeepSeek (partnerships@deepseek.com)

### FreshContext — Other
Palantir, GovTech Singapore (GeBIZ adapter delivered),
LangChain, LlamaIndex, CrewAI, Zalando, Celonis, Vercel,
FactSet, Morningstar, LSEG, PatSnap, Klarna, MiniMax,
Apify, Cloudflare Startups

### Catatonica — Wellness / Wearables
Calm (+ partnership form submitted via Monday.com),
Headspace, Whoop, Oura, WellHub, Eight Sleep

### Catatonica — Japan
Recruit Holdings, LY Corporation (LINE), Mercari,
DeNA, KDDI, Meiji Yasuda Life

### LinkedIn Activity
Profile post live (origin story), 3 group posts live across
AI/ML groups — 107+ impressions. Stephen Petersilge
(Head of BizOps, OpenAI) messaged directly.

---

## Pending Items

| Item | Notes |
|---|---|
| Synthesis endpoint `/briefing/now` | Paused — needs ANTHROPIC_KEY in Worker env + credits at console.anthropic.com. Infrastructure fully built. |
| Apify store description | Still shows old tool count — update to 20 tools |
| Dashboard (Layer 5) | React frontend for D1 pipeline — designed, not yet built |
| `extract_gdelt` GKG upgrade | Tone scores, Goldstein scale, event codes — planned |
| Agnost AI analytics | Free MCP analytics via Apify. Sign up at app.agnost.ai |

---

## Also Built: Catatonica

A second project by the same author.

Live at: https://catatonica.pages.dev
Stack: Vanilla HTML/CSS/JS, Cloudflare Pages, Supabase (magic link auth), Stripe
Pricing: Free / $9/mo Deep / $29/mo The Order
Philosophy: The Art of Doing Nothing — structured stillness practice for high-intensity minds
Mechanics: Situations → Sessions → Catatons → Planned Obsolescence → Chronicle

Catatonica is available for separate acquisition or white-label arrangement.
See HANDOFF.md valuation section above.

---

*"The work isn't gone. It's just waiting to be continued."*
*— Prince Gabriel, Grootfontein, Namibia*

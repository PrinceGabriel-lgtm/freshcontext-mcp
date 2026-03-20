# FreshContext — Handoff Document
**Version:** 0.3.11
**Date:** 2026-03-20
**Author:** Immanuel Gabriel (Prince Gabriel), Grootfontein, Namibia
**Contact:** gimmanuel73@gmail.com

---

## What You Are Receiving

FreshContext is a web intelligence engine for AI agents. It wraps every piece of
retrieved web data in a structured freshness envelope — exact retrieval timestamp,
publication date estimate, freshness confidence (high/medium/low), and a 0-100
numeric score with domain-specific decay rates.

15 tools. No API keys required. Deployed globally on Cloudflare's edge. Listed on
Anthropic's official MCP Registry, npm, and Apify Store.

The two tools that exist nowhere else: extract_govcontracts (US federal contract
intelligence via USASpending.gov) and extract_changelog (product release velocity
from any GitHub repo, npm package, or website).

---

## Services and Infrastructure

### 1. GitHub Repository
URL: https://github.com/PrinceGabriel-lgtm/freshcontext-mcp
Branch: main
Transfer method: GitHub Settings > Transfer ownership
What it contains: All source code, Dockerfile, specs, session saves, roadmap

### 2. npm Package
Package: freshcontext-mcp (v0.3.11)
URL: https://www.npmjs.com/package/freshcontext-mcp
Account: immanuel-gabriel on npmjs.com
Transfer method: npm owner add new-username freshcontext-mcp
Note: Published automatically via GitHub Actions on every push to main

### 3. Cloudflare Account
What lives here:
  Worker:     freshcontext-mcp (the live MCP endpoint)
  D1:         freshcontext-db (ID: d9898d65-f67e-4dcb-abdc-7f7b53f2d444)
  KV:         RATE_LIMITER and CACHE (IDs in wrangler.jsonc)
  Cron:       0 */6 * * * (every 6 hours, runs automatically)
  Endpoint:   https://freshcontext-mcp.gimmanuel73.workers.dev/mcp

Transfer method: Add new account as Super Administrator, remove original.
D1 export: wrangler d1 export freshcontext-db --output=dump.sql

### 4. Apify Actor
Actor:        prince_gabriel/freshcontext-mcp
URL:          https://apify.com/prince_gabriel/freshcontext-mcp
Monetization: $50.00 per 1,000 results (Pay per event)
Transfer method: Re-publish under new Apify account

### 5. MCP Registry Listing
Entry:  io.github.PrinceGabriel-lgtm/freshcontext
Config: server.json in the GitHub repo
Transfer method: Update server.json with new repo URL and re-submit

### 6. GitHub Actions CI/CD
File:   .github/workflows/publish.yml
Action: On every push to main — npm ci > tsc > npm publish
Secret: NPM_TOKEN (granular access token from npmjs.com, renew annually)

---

## Credentials Map (categories only — not values)

| Credential | Where Used | Location |
|---|---|---|
| API_KEY | Worker auth header | Cloudflare env var |
| ANTHROPIC_KEY | Synthesis/briefing endpoint | Cloudflare env var |
| GITHUB_TOKEN | GitHub API rate limit bypass | Cloudflare env var |
| NPM_TOKEN | GitHub Actions auto-publish | GitHub secret |

---

## Codebase Map

src/server.ts          — MCP stdio server, all 15 tools registered here
src/apify.ts           — Apify Actor entry point (read input, call adapter, exit)
src/security.ts        — URL validation, SSRF prevention
src/types.ts           — FreshContext, AdapterResult, ExtractOptions interfaces
src/adapters/          — One file per data source (13 files)
  changelog.ts         — UNIQUE: GitHub Releases API + npm + auto-discover
  govcontracts.ts      — UNIQUE: USASpending.gov federal contract awards
src/tools/
  freshnessStamp.ts    — Score calculation, JSON form, text envelope
worker/src/worker.ts   — Cloudflare Worker: 15 tools + KV cache + rate limit
                         + D1 cron scraper + briefing formatter
.actor/Dockerfile      — Apify build config (Node 20, runs dist/apify.js)
.actor/actor.json      — Apify Actor metadata
FRESHCONTEXT_SPEC.md   — The open standard (MIT license)
ROADMAP.md             — 10-layer product vision
server.json            — MCP Registry listing
.github/workflows/
  publish.yml          — GitHub Actions CI/CD

---

## The 15 Tools

Standard (11):
  extract_github, extract_hackernews, extract_scholar, extract_arxiv,
  extract_reddit, extract_yc, extract_producthunt, search_repos,
  package_trends, extract_finance, search_jobs

Composite landscapes (3):
  extract_landscape      — YC + GitHub + HN + Reddit + Product Hunt + npm
  extract_gov_landscape  — govcontracts + HN + GitHub + changelog
  extract_finance_landscape — finance + HN + Reddit + GitHub + changelog

Unique — not in any other MCP server (2):
  extract_changelog    — release history from any repo, package, or website
  extract_govcontracts — US federal contract awards from USASpending.gov

---

## D1 Database Schema

watched_queries  — 18 active monitored topics
  id, adapter, query, label, filters, enabled, last_run_at

scrape_results   — raw results, deduplicated by content hash
  id, watched_query_id, adapter, query, raw_content, result_hash, is_new, scraped_at

briefings        — formatted intelligence reports per cron run
  id, user_id, summary, new_results_count, adapters_run, created_at

user_profiles    — personalization data for briefing synthesis
  id, name, skills, certifications, targets, location, context

---

## The FreshContext Specification

FRESHCONTEXT_SPEC.md is the open standard, MIT license, authored March 2026.
Any implementation returning the [FRESHCONTEXT]...[/FRESHCONTEXT] envelope
or the structured JSON form with freshcontext.retrieved_at and
freshcontext.freshness_confidence is FreshContext-compatible.

The spec is the durable asset. The code is the reference implementation.

---

## What Keeps Running Without You

The Cloudflare cron fires every 6 hours automatically. Every run scrapes all 18
watched queries, deduplicates by content hash, stores new signals in D1, and
generates a briefing. The dataset accumulates indefinitely. No action required.

---

## Pending Items at Time of Handoff

Apify Playwright — extract_reddit, extract_yc, extract_producthunt may error on
Apify. Fix: add RUN npx playwright install chromium --with-deps to .actor/Dockerfile.

Synthesis endpoint — /briefing/now is paused. Needs ANTHROPIC_KEY in Worker env
and credits loaded at console.anthropic.com. Infrastructure is fully built.

Agnost AI analytics — free MCP analytics offered by Apify. Sign up at app.agnost.ai,
add one line to server.ts. Gives tool call tracking and usage dashboards.

Apify GitHub Actions trigger — npm publish is automated but Apify rebuild is
manual. Add a workflow step calling Apify's API to auto-rebuild on push.

---

## Outreach Status at Time of Handoff

19 confirmed delivered emails across US, Singapore, China, and Europe.
Cloudflare for Startups — awaiting reply (10 business day window).
GovTech Singapore — auto-acknowledged, reply expected by March 25, 2026.
All others — first contact sent, no replies yet.

HN post live: https://news.ycombinator.com/user?id=Prince-Gabriel

---

*"The work isn't gone. It's just waiting to be continued."*
*— Prince Gabriel, Grootfontein, Namibia*

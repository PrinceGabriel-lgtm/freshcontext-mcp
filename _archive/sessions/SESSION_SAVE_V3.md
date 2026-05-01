# FreshContext — Session Save V3
**Date:** 2026-03-20
**npm:** freshcontext-mcp@0.3.11
**Tools:** 15 live

---

## What Was Done This Session

All 7 architecture upgrades complete (see SESSION_SAVE_ARCHITECTURE_V2.md).
Two new composite tools shipped: extract_gov_landscape, extract_finance_landscape.
Apify Actor fixed: Node 20 base image, Dockerfile fallback on pre-built dist.
HANDOFF.md created — complete transfer guide for acquisition or partnership.
Command reference HTML updated with example output section (Anthropic/OpenAI/Palantir report).
npm token renewed (expires March 2027). Version bumped to 0.3.11.
GovTech Singapore auto-acknowledged — reply expected by March 25, 2026.
19 confirmed delivered outreach emails across US, Singapore, China, Europe.

---

## Next Build — Two New Unique Adapters

### extract_sec_filings
Source: SEC EDGAR full-text search API (efts.sec.gov)
No auth required. Free. Updated in real time.
What it returns: 8-K filings — legally mandated disclosures of material events.
CEO resignation, major contract, acquisition, data breach, regulatory action.
Every 8-K is timestamped, structured, and legally verified.
This is the most reliable early-warning signal for corporate events in existence.
API endpoint: https://efts.sec.gov/LATEST/search-index?q="COMPANY"&dateRange=custom&startdt=2026-01-01&enddt=2026-03-20&forms=8-K
Location: src/adapters/secFilings.ts
Tool name: extract_sec_filings

### extract_gdelt
Source: GDELT Project (gdeltproject.org)
No auth required. Free. Updated every 15 minutes.
What it returns: Structured global news events with event codes, actor tags,
tone score, goldstein scale (impact measure), location, and timestamp.
Covers 100+ languages, every country, going back to 1979.
Not just headlines — structured geopolitical intelligence.
API endpoint: https://api.gdeltproject.org/api/v2/doc/doc?query=COMPANY&mode=artlist&maxrecords=10&format=json
Location: src/adapters/gdelt.ts
Tool name: extract_gdelt

### New Composite: extract_company_landscape
Combines all five moat adapters in one call:
  1. extract_sec_filings — what did they legally just disclose
  2. extract_govcontracts — who are they getting government money from
  3. extract_gdelt — what is global news saying about them right now
  4. extract_changelog — are they actually shipping product
  5. extract_finance — what is the market pricing in
Location: register in src/server.ts following extract_gov_landscape pattern
Tool name: extract_company_landscape

---

## Apify Pending
Playwright tools still error on Apify (extract_reddit, extract_yc, extract_producthunt).
Fix: add RUN npx playwright install chromium --with-deps to .actor/Dockerfile.
GitHub Actions does not trigger Apify rebuild — manual for now.

## Synthesis Endpoint
/briefing/now paused. Needs ANTHROPIC_KEY + $5 credits at console.anthropic.com.

## Agnost AI Analytics
Free MCP analytics from Apify partnership. Sign up at app.agnost.ai.
One line added to server.ts gives tool call tracking and usage dashboards.

---

## Resume Prompt
"I'm building freshcontext-mcp — 15 tools, fully spec-compliant, all architecture
upgrades complete. Next: build extract_sec_filings (SEC EDGAR 8-K filings) and
extract_gdelt (GDELT global news intelligence), then composite them with govcontracts,
changelog, and finance into extract_company_landscape. See SESSION_SAVE_V3.md."

# FreshContext — Session Save V4
**Date:** 2026-03-20
**npm:** freshcontext-mcp@0.3.11
**Tools:** 15 live → building to 18

---

## What Was Done This Session

- Apify Actor fixed: Node 20 base image, clean build confirmed
- HANDOFF.md created and pushed
- Command reference HTML updated with example output section
- Intelligence report (Anthropic/OpenAI/Palantir) confirmed as best product demo asset
- SESSION_SAVE_V3.md written
- Strategic discussion: keep the niche, deepen it — spec adoption > more tools
- Identified two new unique adapters: extract_sec_filings + extract_gdelt
- Composite: extract_company_landscape (5 sources: SEC + govcontracts + GDELT + changelog + finance)

---

## Next Build — NOW IN PROGRESS

### extract_sec_filings
Source: SEC EDGAR full-text search (efts.sec.gov/LATEST/search-index)
No auth. Free. Real-time.
Returns: 8-K filings — legally mandated material event disclosures
CEO changes, major contracts, acquisitions, breaches, regulatory actions
File: src/adapters/secFilings.ts

### extract_gdelt
Source: GDELT Project (api.gdeltproject.org/api/v2/doc/doc)
No auth. Free. Updated every 15 minutes.
Returns: Structured global news events with tone, goldstein scale, actor tags
File: src/adapters/gdelt.ts

### extract_company_landscape (composite)
5 sources in parallel:
  1. extract_sec_filings — legal disclosures
  2. extract_govcontracts — federal contract footprint
  3. extract_gdelt — global news events
  4. extract_changelog — shipping velocity
  5. extract_finance — market pricing
File: register in src/server.ts

---

## Moat Summary (all 4 unique adapters)
extract_changelog     — release history from any repo/package/site
extract_govcontracts  — US federal contract awards (USASpending.gov)
extract_sec_filings   — 8-K material event disclosures (SEC EDGAR)
extract_gdelt         — global structured news events (GDELT Project)

These 4 exist in no other MCP server. All free. All no-auth.

---

## Resume Prompt
"I'm building freshcontext-mcp. Just built extract_sec_filings and extract_gdelt.
Need to register them in server.ts and build extract_company_landscape composite.
See SESSION_SAVE_V4.md."

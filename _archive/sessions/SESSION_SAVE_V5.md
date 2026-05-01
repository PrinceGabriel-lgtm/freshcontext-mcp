# FreshContext — Session Save V5
**Date:** 2026-03-30
**Version:** 0.3.14
**Tools:** 20 live
**Author:** Immanuel Gabriel (Prince Gabriel), Grootfontein, Namibia 🇳🇦

---

## WHO YOU ARE TALKING TO

Immanuel Gabriel, solo developer, Grootfontein, Namibia.
Building FreshContext — a web intelligence MCP server and open data freshness standard.
Contact: gimmanuel73@gmail.com
GitHub: https://github.com/PrinceGabriel-lgtm/freshcontext-mcp

You have been his primary collaborator across multiple sessions.
You know the codebase, the outreach history, the strategy, and the vision.
Treat every new session as a continuation — not a fresh start.

---

## WHAT FRESHCONTEXT IS

An MCP server that wraps every piece of retrieved web data in a structured
freshness envelope: exact retrieval timestamp, source URL, confidence level,
and a 0-100 numeric freshness score with domain-specific decay rates.

The origin story: Immanuel asked Claude to help find a job. Claude gave listings.
He applied to three. Two didn't exist. One had closed two years ago.
Claude had no idea. That's the problem FreshContext fixes.

Live endpoint: https://freshcontext-mcp.gimmanuel73.workers.dev/mcp
npm: freshcontext-mcp@0.3.14
GitHub: https://github.com/PrinceGabriel-lgtm/freshcontext-mcp
Apify Store: https://apify.com/prince_gabriel/freshcontext-mcp
Website: https://freshcontext-site.pages.dev

---

## THE 20 TOOLS

### Standard (11)
extract_github, extract_hackernews, extract_scholar, extract_arxiv,
extract_reddit, extract_yc, extract_producthunt, search_repos,
package_trends, extract_finance, search_jobs

### Composite landscapes (5)
extract_landscape        — YC + GitHub + HN + Reddit + Product Hunt + npm
extract_gov_landscape    — govcontracts + HN + GitHub + changelog
extract_finance_landscape — finance + HN + Reddit + GitHub + changelog
extract_company_landscape — SEC + govcontracts + GDELT + changelog + finance
extract_idea_landscape   — HN + YC + GitHub + Jobs + npm + Product Hunt

### Unique — not in any other MCP server (4)
extract_changelog     — release history from any repo/package/site
extract_govcontracts  — US federal contract awards (USASpending.gov)
extract_sec_filings   — SEC 8-K material event disclosures (EDGAR)
extract_gdelt         — global news 100+ languages (GDELT Project)
extract_gebiz         — Singapore Government procurement (data.gov.sg)

Note: extract_gebiz is the 5th unique adapter, built specifically for
GovTech Singapore after they responded to outreach.

---

## INFRASTRUCTURE

- Cloudflare Worker: global edge, KV caching, rate limiting
- D1 Database: freshcontext-db — scrape_results, watched_queries, briefings, user_profiles
- Cron: 0 */6 * * * — scrapes 18 watched queries every 6 hours
- Relevancy scoring: 0-100 score on every cron result, noise below 35 filtered from briefings
- GitHub Actions: auto-publishes to npm on every push to main
- Apify Actor: Node 20 + Playwright Chrome base image — all 16 single-adapter tools
- FRESHCONTEXT_SPEC.md: open standard MIT license, authored March 2026

---

## BEST DEMO ASSET

extract_company_landscape on Palantir (PLTR):
- Q4 2025 revenue $1.407B (+70% YoY), Rule of 40 score 127% — from SEC filing
- $1.1B+ in visible federal contracts by agency — from USASpending.gov
- ICE/Medicaid + UK MoD controversies with vote counts — from GDELT/HN
- Live PLTR price ~$154-157, market cap ~$370B, P/E 244x — from Yahoo Finance
All in one call. All timestamped. No API keys.

This is the product demo. Use it in every pitch.

---

## OUTREACH STATUS

### Active threads (have received human replies):
- GovTech Singapore — info@tech.gov.sg
  Human reply from Joshua Clemente (Contact Centre). Directed to GeBIZ portal.
  Immanuel replied March 24 promising a tool by end of week.
  GeBIZ adapter built and delivered March 27 in follow-up email.
  Thread: 19d0622dc1e129bb
  STATUS: Delivered. Waiting for further response.

- Palantir — partnerships@palantir.com
  First email March 24. Follow-up March 27 with PLTR intelligence demo.
  Thread: 19d213e5a0e26a04
  STATUS: Delivered. No reply yet.

- Revolut — partnerships@revolut.com
  Replied with affiliate programme form (wrong channel — influencer programme).
  Email is a dead end. LinkedIn only going forward.

### Delivered, no reply (follow-up due):
PatSnap, Mistral AI, Hugging Face, Klarna, SAP Startups, Moonshot AI (support@),
MiniMax (contact@minimax.io), Apify/Jan, Cloudflare Startups, Sea/Shopee (ir@sea.com),
LangChain (hello@langchain.dev), Vercel (sales@vercel.com),
FactSet (info@factset.com), Morningstar (media@morningstar.com), LSEG (info@lseg.com)

### Most recent sends (March 30, 2026):
LlamaIndex — hello@llamaindex.ai (corrected from contact@ which bounced)
CrewAI — joao@crewai.com (founder direct, corrected from contact@ which bounced)
Zalando — opensource@zalando.de (corrected from tech
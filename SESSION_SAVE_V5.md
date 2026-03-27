# FreshContext — Session Save V5
**Date:** 2026-03-27
**npm:** freshcontext-mcp@0.3.13
**Tools:** 19 live

---

## What Was Done This Session

- npm tokens renewed: freshcontext-publish + NPM_TOKEN (both renewed, NPM_TOKEN updated in GitHub secrets)
- GitHub granular token renewed
- v0.3.13 pushed — extract_gebiz added (Singapore GeBIZ procurement via data.gov.sg)
- README fully rewritten — 19 tools, company landscape section with PLTR demo, all unique adapters documented
- GovTech Singapore follow-up sent (delivered on commitment: GeBIZ tool built and live)
- Palantir follow-up sent (references PLTR company landscape report, $1.1B contracts, Rule of 40 127%)
- 10 follow-up drafts created in Gmail (PatSnap, Mistral, HF, Klarna, SAP, Moonshot, MiniMax, Apify, Cloudflare, Sea)
- PLTR company landscape report confirmed working — full intelligence output documented
- Apify rebuild needed for v0.3.13 (manual trigger required)

---

## Current Tool Count: 19

**Standard (11):** extract_github, extract_hackernews, extract_scholar, extract_arxiv,
extract_reddit, extract_yc, extract_producthunt, search_repos, package_trends,
extract_finance, search_jobs

**Composite landscapes (4):**
- extract_landscape — YC + GitHub + HN + Reddit + Product Hunt + npm
- extract_gov_landscape — govcontracts + HN + GitHub + changelog
- extract_finance_landscape — finance + HN + Reddit + GitHub + changelog
- extract_company_landscape — SEC + govcontracts + GDELT + changelog + finance

**Unique — not in any other MCP server (4 + GeBIZ):**
- extract_changelog — release history from any repo/package/site
- extract_govcontracts — US federal contract awards (USASpending.gov)
- extract_sec_filings — 8-K material event disclosures (SEC EDGAR)
- extract_gdelt — global news events (GDELT Project, 100+ languages)
- extract_gebiz — Singapore Government procurement (data.gov.sg) ← NEW

---

## Outreach Status

**Active threads:**
- GovTech Singapore — delivered GeBIZ tool, awaiting response
- Palantir — follow-up sent with PLTR company landscape report

**Follow-up drafts sitting in Gmail (10):**
- PatSnap — contact@patsnap.com
- Mistral AI — contact@mistral.ai
- Hugging Face — api-enterprise@huggingface.co
- Klarna — partnerships@klarna.com
- SAP Startups — startups@sap.com
- Moonshot AI — support@moonshot.cn
- MiniMax — contact@minimax.io
- Apify / Jan — jan@apify.com
- Cloudflare Startups — startups@cloudflare.com
- Sea / Shopee — ir@sea.com

**Bounced — need correct addresses (9):**
- Revolut — bd@revolut.com + press@revolut.com both dead
- Zalando — partnerships@zalando.de + tech@zalando.de both dead
- Celonis — partnerships@celonis.com dead
- Grab — partnerships@grab.com + developer@grab.com both dead
- Sea Limited — partnerships@sea.com dead (ir@sea.com delivered but wrong team)
- Zhipu AI — bd@zhipuai.cn + contact@zhipuai.cn both dead
- MiniMax — bd@minimaxi.com dead (contact@minimax.io delivered)
- Moonshot AI — business@moonshot.cn dead (support@moonshot.cn delivered)
- Apollo — hello@apollo.io dead

**New targets identified (not yet contacted):**
- IMDA Singapore (Infocomm Media Development Authority)
- Australian Digital Transformation Agency
- UK Government Digital Service (GDS)
- LangChain / LangSmith
- LlamaIndex
- CrewAI
- Vercel AI SDK
- FactSet
- Morningstar

**Correct addresses to find for bounced:**
- Revolut → try partnerships@revolut.com
- Grab → try business@grab.com
- Celonis → try hello@celonis.com
- Apollo.io → try partnerships@apollo.io
- Zhipu AI → LinkedIn outreach (email dead)

---

## Pending Items

- Send 10 follow-up drafts from Gmail Drafts folder
- Trigger Apify rebuild for v0.3.13
- Find correct addresses for 9 bounced companies
- Contact new targets: IMDA, GDS, LangChain, LlamaIndex, CrewAI, FactSet
- GKG upgrade for extract_gdelt (tone scores, goldstein scale) — deferred
- Agnost AI analytics integration — sign up at app.agnost.ai, one line in server.ts
- Synthesis endpoint (/briefing/now) — needs ANTHROPIC_KEY + $5 credits

---

## Demo Assets
1. intelligence-report.html — Anthropic/OpenAI/Palantir government intelligence report
2. PLTR company landscape — Q4 2025 earnings, $1.1B contracts, Rule of 40 127%

Both are best-in-class product demos. Use these in outreach.

---

## Resume Prompt
"I'm building freshcontext-mcp — 19 tools live at v0.3.13. Last session: built extract_gebiz
(Singapore GeBIZ), sent GovTech and Palantir follow-ups, drafted 10 follow-up emails.
Next: send the 10 drafts, fix bounced email addresses, contact new targets.
See SESSION_SAVE_V5.md."

---

*"The work isn't gone. It's just waiting to be continued."*
*— Prince Gabriel, Grootfontein, Namibia 🇳🇦*

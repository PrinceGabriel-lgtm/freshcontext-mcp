# FreshContext v0.3.15 — Launch Posts

**Date drafted:** 2026-04-14
**Milestone:** DAR engine live, semantic deduplication shipped, METHODOLOGY.md published

---

## Show HN — Primary Draft

**Title:** Show HN: FreshContext — exponential decay scoring for AI agent data freshness

**Body:**

Six months ago I asked Claude for a list of jobs. I applied to three. Two didn't exist anymore. One had been closed for two years. Claude had no way to know — it presented stale data with the same confidence as fresh data.

That's the problem FreshContext fixes.

FreshContext is an open standard and reference implementation that makes retrieved web data trustworthy. Every adapter wraps results in a structured envelope carrying source URL, retrieval time, content publication date, and confidence level.

In v0.3.15 I shipped what makes it more than a wrapper: the Decay-Adjusted Relevancy engine.

Every signal collected by the platform is now scored as:

```
R_t = R_0 · e^(-λt)
```

R_0 is the semantic match against the user profile. λ is a source-specific decay constant (Hacker News stories at 0.05/hr, GitHub repos at 0.0002/hr, academic papers at 0.00005/hr). t is hours since publication. R_t is the final relevancy at query time.

Plus three things every signal carries that I haven't seen elsewhere:

- A SHA-256 audit signature binding result_id to content_hash to engine version (provenance, tamper-evident)
- A semantic fingerprint for cross-adapter deduplication (the same MCP story showing up on HN, Reddit, and GitHub becomes one signal, not three)
- An entropy classification (low/stable/high) telling the agent where on the decay curve this signal lives

The full methodology is documented in METHODOLOGY.md as a versioned, reproducible specification of how every number in the database is produced.

20 tools, no API keys required, deployed on Cloudflare Workers. Listed on the official MCP Registry, npm, and Apify Store. The spec is MIT.

Built solo from Grootfontein, Namibia. Genuinely curious what you'd build on top of it, or where the math falls down.

Spec: https://freshcontext-site.pages.dev/spec.html
Methodology: https://github.com/PrinceGabriel-lgtm/freshcontext-mcp/blob/main/METHODOLOGY.md
GitHub: https://github.com/PrinceGabriel-lgtm/freshcontext-mcp
npm: https://www.npmjs.com/package/freshcontext-mcp
Live endpoint: https://freshcontext-mcp.gimmanuel73.workers.dev

---

## LinkedIn Post — Primary Draft

**Subject:** Update on FreshContext

Six weeks ago I posted about a problem: AI agents treat stale web data the same as fresh data, and there was no standard for fixing it.

I've now shipped v0.3.15 — the version where FreshContext stops being a tool and starts being infrastructure.

What changed:

→ The Decay-Adjusted Relevancy engine is live. Every signal the platform collects is scored with exponential decay using source-specific λ constants — empirically calibrated half-lives ranging from ~14 hours for Hacker News to ~1.6 years for academic papers.

→ Every row in the historical D1 ledger now carries a SHA-256 audit signature binding result ID to content hash to engine version. Tamper-evident provenance on every signal.

→ Semantic deduplication across adapters. The same story appearing on Hacker News, Reddit, and GitHub becomes one signal in the briefing, not three.

→ A new endpoint, `/v1/intel/feed/:profile_id`, returns scored, deduplicated, provenance-stamped intelligence ready for direct consumption by any LLM or agent.

→ METHODOLOGY.md — formal documentation of the data collection, scoring, and provenance methodology. Versioned, reproducible, written as an audit trail.

The cron has been running every 6 hours, accumulating a dataset that grows harder to replicate every day. That's the actual moat — not the code, the dataset.

I built this solo from Grootfontein, Namibia, with no funding and no team. The infrastructure is open and the spec is MIT. The proprietary λ constants and the historical dataset are the assets.

If you're working on AI agent reliability, RAG quality, or grounded intelligence pipelines — I'd love to hear what you're seeing.

#AI #MachineLearning #DataInfrastructure #OpenSource #MCP #ModelContextProtocol #AIagents #RAG #DataQuality

---

## LinkedIn Post — Shorter Variant (For Quick Engagement)

After six weeks of compounding work: FreshContext v0.3.15 ships the intelligence layer.

Every signal in the database now carries:
- An exponential decay score (R_t = R_0 · e^(-λt))
- A SHA-256 provenance signature
- A cross-adapter deduplication fingerprint
- An entropy classification on the decay curve

The platform has been quietly running every 6 hours since deployment, accumulating a historical ledger that's harder to replicate every day.

The math is open. The methodology is documented in METHODOLOGY.md. The λ constants are the trade secret.

Built solo from Grootfontein, Namibia.

GitHub: https://github.com/PrinceGabriel-lgtm/freshcontext-mcp

#AI #MCP #ModelContextProtocol #DataInfrastructure #OpenSource

---

## Twitter / X Thread Draft

1/ Six weeks ago I shipped FreshContext v0.3.0 — a structured envelope for timestamped web data.

Today I shipped v0.3.15 — the version where it stops being a tool and starts being infrastructure.

Here's what changed.

2/ The Decay-Adjusted Relevancy engine is live.

Every signal is scored with R_t = R_0 · e^(-λt)

R_0 = semantic match against profile
λ = source-specific decay constant
t = hours since publication

HN ≈14h half-life. GitHub ≈5mo. Scholar ≈1.6y.

3/ Every row in the historical ledger now carries a SHA-256 audit signature binding result ID to content hash to engine version.

Tamper-evident provenance. Every signal can be cited and verified.

4/ Semantic deduplication across adapters.

The same MCP story appearing on HN, Reddit, and GitHub becomes ONE signal in the briefing, not three. 16-char SHA-256 fingerprint of normalised title + URL + date.

5/ New endpoint: /v1/intel/feed/:profile_id

Returns scored, deduplicated, provenance-stamped intelligence ready for direct consumption by any LLM. No synthesis API needed. Model-agnostic.

6/ METHODOLOGY.md is the formal IP documentation.

Versioned, reproducible specification of how every number in the database is produced. Written as an audit trail for acquirers, integrators, and regulators.

The spec is MIT. The λ constants are the trade secret.

7/ Built solo from Grootfontein, Namibia.

The cron has been running every 6 hours. The dataset grows harder to replicate every day.

That's the moat — not the code, the dataset.

GitHub: https://github.com/PrinceGabriel-lgtm/freshcontext-mcp

---

## Posting Strategy

**Order:**
1. Show HN first — Tuesday or Wednesday between 09:00–10:30 ET (peaks for "Show HN" engagement)
2. LinkedIn 24 hours later — let HN traffic settle, then a different audience
3. Twitter/X thread immediately after LinkedIn — different platform, same day

**Why not all at once:**
HN front-page traffic is finite. If LinkedIn drives people to the same GitHub during the HN window, you confuse the analytics signal. Stagger by 24h.

**What NOT to do:**
- Don't repost identical content to multiple HN accounts
- Don't use AI-generated images on LinkedIn — it dilutes the technical credibility
- Don't @ tag specific company accounts in the launch post unless you've already had contact

**Engagement plan once posted:**
- Reply to every HN comment in the first 4 hours, thoughtfully
- If someone asks a sceptical question, answer technically not defensively
- If someone reports a bug, fix it within the same day if possible
- Save the comment thread — it's market research

---

*"The work isn't gone. It's just waiting to be continued."*
*— Prince Gabriel, Grootfontein, Namibia*

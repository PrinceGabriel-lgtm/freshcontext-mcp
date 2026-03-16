# FreshContext Roadmap

> *This document describes what FreshContext is becoming — not just what it is today.*
> *Built by Prince Gabriel — Grootfontein, Namibia 🇳🇦*

---

## Where We Are Today

FreshContext is a working, deployed, monetized web intelligence engine for AI agents.

**What's live and functional right now:**

- 11 MCP adapters — GitHub, Hacker News, Google Scholar, arXiv, Reddit, YC Companies, Product Hunt, npm/PyPI trends, finance, job search, and `extract_landscape` (all 6 sources in one call)
- Cloudflare Worker deployed globally at the edge with KV caching and rate limiting
- D1 database with 18 active watched queries running on a 6-hour cron schedule
- `GET /briefing` and `POST /briefing/now` endpoints for scheduled AI synthesis (synthesis paused pending Anthropic credits — infrastructure fully built)
- Listed on npm (`freshcontext-mcp@0.3.1`) and the official MCP Registry
- Published FreshContext Specification v1.0 — the standard this project is authoring
- Apify Store listing pending approval (account under manual review)

---

## Layer 5 — Dashboard (Next Build)

**Status: Designed, not yet built**

A React frontend that makes the intelligence pipeline visible and beautiful.

The dashboard pulls from live endpoints already built:

- `GET /briefing` → renders the latest AI-generated briefing with per-adapter sections
- `POST /briefing/now` → force-triggers a fresh synthesis on demand
- `GET /watched-queries` → manage what topics are being monitored
- User profile editor → update skills, targets, and context that shape briefing personalization

**Design targets:**
- Freshness confidence indicators on every source card (high/medium/low with color coding)
- Briefing history timeline showing how signal has evolved over time
- Watched query manager — add, pause, delete, and score queries by signal quality
- "Force refresh" button with live streaming output

**Deployment:** Cloudflare Pages — stays entirely within the Cloudflare free tier ecosystem.

---

## Layer 6 — Personalization Engine

**Status: Schema designed in D1, logic not yet built**

The `user_profiles` table already exists in D1 with fields for skills, certifications, targets, location, and context. The synthesis prompt already uses this data. What's missing is the user-facing surface:

- Onboarding flow — build your profile in the app in under 3 minutes
- Multiple profiles — team mode where each member gets their own briefing
- Custom briefing schedules — not just every 6h, but user-defined intervals
- Notification delivery — push briefings to Slack, email, or SMS via webhook

---

## Layer 7 — Watched Query Intelligence

**Status: Data accumulating, intelligence layer not yet built**

Every query run leaves a result in `scrape_results`. Over time this becomes a dataset with genuine historical value. The intelligence layer turns it into signal:

- **Relevance scoring** — each result is scored against the user profile (0–100) before inclusion in briefings
- **Deduplication** — same story appearing on HN and Reddit counts as one signal, not two
- **Query performance scoring** — which watched queries are generating signal vs. noise? Surface the top performers.
- **Smart suggestions** — "Based on your profile, you should also watch: mcp server rust, cloudflare workers ai"
- **Trend detection** — alert when a topic spikes across multiple adapters simultaneously

---

## Layer 8 — New Adapters

**Status: Planned, prioritised by acquisition value**

These adapters extend FreshContext into new intelligence categories with zero API key requirements:

| Adapter | Source | What it adds |
|---|---|---|
| `extract_devto` | dev.to public API | Developer article sentiment with clean publish dates |
| `extract_changelog` | Any `/changelog` or `/releases` URL | Track any product's update cadence |
| `extract_crunchbase_free` | Crunchbase public feed | Funding announcements with date signals |
| `extract_govcontracts` | USASpending.gov API | Government contract awards — unique GTM signal |
| `extract_npm_releases` | npm registry API | Package release velocity and adoption signals |
| `extract_twitter_trends` | Nitter public endpoints | Real-time trending topics with no auth |
| `extract_linkedin_jobs` | LinkedIn public job search | Job freshness — the origin story, completed |

The `extract_changelog` and `extract_govcontracts` adapters are not available in any other MCP server. They represent a genuine capability gap in the market.

---

## Layer 9 — The Freshness Score Standard

**Status: Spec written (FRESHCONTEXT_SPEC.md), numeric score not yet implemented**

The FreshContext Specification v1.0 defines an optional `freshness_score` field (0–100) calculated as:

```
freshness_score = max(0, 100 - (days_since_retrieved × decay_rate))
```

Domain-specific decay rates will allow different categories of data to age at appropriate speeds:

| Category | Decay Rate | Half-life |
|---|---|---|
| Financial data | 5.0 | ~10 days |
| Job listings | 3.0 | ~17 days |
| News / HN | 2.0 | ~25 days |
| GitHub repos | 1.0 | ~50 days |
| Academic papers | 0.3 | ~167 days |

Once implemented, agents can filter results by `freshness_score > threshold` instead of relying on string confidence levels. This makes FreshContext usable as a query parameter, not just a label.

---

## Layer 10 — API + Monetization Infrastructure

**Status: Pricing designed, billing not yet built**

The monetization architecture planned for FreshContext:

**Free tier**
- 1 user profile
- 5 watched queries
- Daily briefings
- All 11 adapters via MCP

**Pro ($19/month)**
- Unlimited watched queries
- 6-hour briefings
- All adapters including new ones
- Freshness score on every result
- API access (100k calls/month)

**Team ($79/month)**
- Multiple user profiles
- Shared briefing feed
- Slack / email delivery
- 500k API calls/month
- Priority support

**Enterprise (custom)**
- Dedicated Cloudflare Worker deployment
- Custom adapter development
- SLA-backed uptime
- White-label briefing output

**Billing implementation:** Lemon Squeezy (Namibia-compatible, merchant-of-record, no Stripe required)

---

## The Bigger Picture

FreshContext started as a fix for a personal problem — AI giving stale job listings with no warning. It's becoming something more structural: a **data freshness layer for the AI agent ecosystem.**

Every agent needs to know how old its data is. Right now, none of them do — not reliably, not with a standard format, not with a confidence signal. FreshContext is the first project to address this as a named, specified, open standard with a working reference implementation.

The opportunity is to become the layer that other AI tools plug into when they need grounded, timestamped intelligence — not a scraper, not a search engine, but the envelope that makes retrieved data trustworthy.

**The unfair advantage:** One developer, Cloudflare's global edge, a working spec, and a dataset that grows every six hours whether or not anyone is watching. The longer FreshContext runs, the more historical signal accumulates, and the harder it becomes to replicate from scratch.

---

## Contribution

The FreshContext Specification is open. New adapters are the highest-value contribution — see `src/adapters/` for the pattern and `FRESHCONTEXT_SPEC.md` for the contract any adapter must fulfill.

If you're building something FreshContext-compatible, open an issue and we'll add you to the ecosystem list.

---

*"The work isn't gone. It's just waiting to be continued."*

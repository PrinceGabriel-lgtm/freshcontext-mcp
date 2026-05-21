# FreshContext Data Intelligence Methodology
**Version 1.2 — May 2026**
*Authored by Immanuel Gabriel (Prince Gabriel) — Grootfontein, Namibia*

---

## What This Document Is

This document formally describes the data collection, scoring, ranking, storage, and provenance methodology underlying FreshContext.

It exists for four audiences:

1. **Technical integrators** — teams embedding FreshContext into their agent infrastructure who need to understand what the data represents and how it is scored.
2. **Agent/retrieval system builders** — teams designing retrieval pipelines that need temporal relevance instead of undated context.
3. **Auditors and reviewers** — people verifying that timestamped AI context is represented honestly and reproducibly.
4. **Future licensing or platform partners** — entities evaluating FreshContext as infrastructure, who need to audit the methodology that makes the data defensible.

---

## Section 1: Core Methodology and Source Collection

### 1.1 Architecture

FreshContext Core methodology describes the signal contract and temporal scoring primitives that can be used by MCP servers, APIs, CLIs, dashboards, agents, or internal retrieval systems.

The Core methodology covers:

- **Signal schema** — source, content, timestamps, confidence, adapter identity
- **Source/provenance** — where the observation came from and how it was retrieved
- **Published/content date** — when the source claims the content became true or available
- **Retrieved timestamp** — when FreshContext observed the content
- **Confidence** — how reliable the timestamp extraction is
- **Decay-Adjusted Relevancy (DAR)** — temporal utility after source-specific decay
- **Failure honesty** — failed adapters must not be promoted as fresh successful context
- **Ranking/explain primitives** — fields that let agents and systems explain why a signal ranked where it did

FreshContext also supports a Store/Ledger methodology for systems that persist recurring signals over time. The production Worker implementation uses Cloudflare runtime pieces for MCP transport, KV cache policy, rate limiting, D1 persistence, feeds, cron collection, and deployment concerns. Those runtime concerns are implementation layers, not requirements for every FreshContext-compatible system.

### 1.2 Store / Ledger Collection Layer

The Store/Ledger methodology describes a continuous data collection pipeline that can run on Cloudflare's global edge infrastructure. A deployment may execute scheduled collection via cron and query watched definitions stored in D1 or another durable store.

Each watched query specifies:
- **Adapter** — the data source to query (e.g., `hackernews`, `jobs`, `reposearch`)
- **Query** — the search term or URL
- **User ID** — the profile this query serves
- **Filters** — optional parameters (location, exclusion terms, etc.)

This D1 cron ledger is one implementation layer and future Store direction. It is not required for every FreshContext-compatible envelope implementation.

### 1.3 Example Adapter / Source Classes

FreshContext currently has:

- A reference MCP implementation with 21 read-only MCP tools / reference adapters
- Separate feed products such as Fresh HN Feed and Fresh Jobs Feed
- A Store/Ledger methodology for systems that collect recurring signals over time

The following table describes example source classes used by FreshContext implementations. Not every source class is necessarily collected by every cron/feed deployment.

| Adapter class | Source | Auth Required | Typical Update Frequency |
|---|---|---|---|
| `hackernews` | Hacker News Algolia API | None | Real-time |
| `jobs` | Remotive API | None | Continuous |
| `reposearch` | GitHub Search API | Optional (rate limit) | Real-time |
| `github` | GitHub Repository API | Optional | Real-time |
| `reddit` | Reddit JSON API | None | Real-time |
| `yc` | YC Open Source API | None | Per batch cycle |
| `packagetrends` | npm Registry + npm Downloads API | None | Per publish |
| `finance` | Stooq quote API | None | Market hours / quote feed cadence |
| `producthunt` | Product Hunt launch data | Token when API-backed | Launch cadence |
| `changelog` | GitHub Releases / npm package metadata | Optional | Per release |
| `arxiv` / `scholar` | Academic sources | None | Publication cadence |
| `gdelt` | GDELT global news | None | 15-minute feed cadence |
| `govcontracts` / `gebiz` | Government procurement datasets | None | Dataset cadence |
| `sec_filings` | SEC EDGAR filings | None | Filing cadence |

FreshContext adapters operate on publicly accessible or publicly documented data sources. Most reference adapters require no credentials. Some APIs may optionally use tokens for rate limits or official API access, but FreshContext-compatible adapters should not require private user data unless explicitly documented by the implementation. All fetch requests include a `User-Agent` header identifying the FreshContext crawler where the runtime/source supports it.

### 1.4 Content Hash Deduplication

Before any signal is stored, the platform computes a 32-bit rolling hash of the raw content. If the most recent stored result for a given watched query carries an identical hash, the current result is discarded. This prevents storing unchanged content across cron cycles.

### 1.5 Semantic Deduplication

Beyond exact-match deduplication, FreshContext implements semantic deduplication to prevent the same underlying story appearing as multiple signals because it was covered by multiple sources (e.g., the same GitHub release appearing in both HN and Reddit).

The semantic fingerprint is computed as follows:

1. Extract the first canonical URL from the raw content
2. Extract the first ISO 8601 publication date from the raw content
3. Extract and normalise the first substantive line (title) — lowercased, punctuation stripped, truncated to 80 characters
4. Concatenate: `normalised_title|canonical_url|publication_date`
5. Compute SHA-256 of the concatenated string
6. Retain the first 16 hex characters as the fingerprint

If any signal stored within the preceding 48 hours carries an identical fingerprint, the new result is discarded. The 48-hour window is configurable.

---

## Section 2: Temporal Scoring — The DAR Engine

### 2.1 Overview

The Decay-Adjusted Relevancy (DAR) engine scores every collected signal on two axes:

- **R_0 (Base Score)** — semantic relevancy of the content against the user's profile, independent of time
- **R_t (Decay-Adjusted Score)** — R_0 adjusted for how much time has elapsed since the content was published

The final stored `rt_score` is what drives signal ranking in briefings and the intelligence feed.

FreshContext measures temporal utility, not truth. A source can be valid and still have low utility for the current query if it is stale. A source can be fresh but low-confidence if its timestamp is missing, malformed, inferred, or contradicted.

### 2.2 Base Score Calculation (R_0)

R_0 is the starting relevance or utility before temporal decay. In the Store/Feed implementation, R_0 is computed by matching content against the user profile:

```
R_0 = baseline (40)
    + vital_keyword_matches × 15   [capped at +35]
    + skill_keyword_matches × 3    [capped at +15]
    + location_accessibility_bonus  [+8 if remote/accessible]
    - error_penalty                 [−40 if content is empty/error]
```

Vital keywords are drawn from the `targets` field of the user profile — job titles, company names, and technology domains the user is specifically tracking.

Skill keywords are drawn from the `skills` field — the user's technical competencies. A match here adds relevancy signal but at lower weight than a direct target match.

The location accessibility bonus is applied when the content explicitly mentions "remote", "worldwide", "anywhere", or the user's stated location. This is not a geographic filter — it is a signal boost for content that is accessible to the user regardless of their physical location.

**Hard exclusions:** If any term from the `exclusion_terms` list appears in the content, R_0 is forced to zero. The result is still stored (for audit purposes) but marked `is_relevant = 0`.

This profile formula is a Store/Feed implementation example, not the only possible way to produce base relevance. For Core/MCP envelope scoring, R_0 may be normalised to 100. For feed/ranking systems, R_0 may come from semantic relevance, profile relevance, adapter-specific relevance, or another documented scoring layer.

### 2.3 Decay Function (R_t)

```
R_t = R_0 · e^(-λt)
```

Where:
- `λ` = source-specific decay constant (per hour)
- `t` = hours elapsed since `published_at` / `content_date`
- `R_t` = current temporal utility score

If `published_at` / `content_date` cannot be extracted, the system must not pretend the signal is fresh. Core-compatible envelope scoring SHOULD use `freshness_score: null` and low confidence. Store/feed systems MAY apply a conservative fallback assumption, such as one source half-life, but must mark confidence low and explain the assumption.

### 2.4 Source Decay Constants (λ)

These constants are reference/default calibration values for how quickly signals from each source class lose temporal utility:

| Source | λ (per hour) | Half-life |
|---|---|---|
| Hacker News | 0.050 | ~14 hours |
| Reddit | 0.010 | ~3 days |
| Product Hunt | 0.010 | ~3 days |
| Job listings | 0.005 | ~6 days |
| Financial data | 0.001 | ~29 days |
| YC companies | 0.001 | ~29 days |
| Package trends | 0.0005 | ~58 days |
| GitHub repositories | 0.0002 | ~5 months |
| Academic papers | 0.00005 | ~1.6 years |

These constants are reference defaults used by the FreshContext methodology and may be tuned by implementation. Hosted or private deployments may use calibrated variants per source, query type, or user profile. The calibration process and production tuning may be proprietary, even when public reference defaults are documented.

### 2.5 Entropy Classification

Each signal is classified into one of three entropy states based on its position on the decay curve:

| State | Condition | Interpretation |
|---|---|---|
| `low` | `t < half_life / 2` | Signal near peak value — act now |
| `stable` | `t < 1.5 × half_life` | Usable signal — monitor |
| `high` | `t ≥ 1.5 × half_life` | Significantly degraded — verify before acting |

Entropy labels describe signal decay state, not confidence level. A high-entropy signal may still be factually accurate, but it has lost temporal utility for current retrieval unless reinforced by newer evidence.

### 2.6 Relevancy Threshold

Signals with `rt_score < 35` are stored with `is_relevant = 0`. They remain in the database for audit and historical analysis but are excluded from briefings and the intelligence feed by default. The threshold is configurable per profile.

### 2.7 Failure Honesty

Failed adapters must not be promoted by freshness scoring. Empty, blocked, timeout, malformed, rate-limited, access-denied, or error-only outputs reduce R_0 or mark the signal status as failed/unknown.

A failed result should not receive high confidence. A failed result should not produce `Score: 100/100`. Partial composites should preserve successful upstream results while marking failures explicitly.

---

## Section 3: FreshContext Store / Ledger Methodology

### 3.1 The Ha-Pri Audit Signature

Every signal stored in a FreshContext Store/Ledger deployment carries a `ha_pri_sig` — a SHA-256 audit signature computed as:

```
SHA-256( result_id + ":" + content_hash + ":" + "FRESHCONTEXT_DAR_V1" )
```

This signature serves three purposes:

1. **Tamper detection** — the signature binds the content hash to the result ID and the engine version. Any modification to the stored content would invalidate the signature.
2. **Provenance chain** — every row in the `scrape_results` table is cryptographically linked to the moment it was scored by the DAR engine.
3. **Licensing audit** — when FreshContext data is provided to a third party under licence, the `ha_pri_sig` column provides an immutable record of exactly what was delivered and when.

### 3.2 D1 Historical Ledger

The `scrape_results` table functions as a **Contextual Ledger** — not merely a cache, but a time-series record of intelligence signals with full provenance.

This Store/Ledger methodology is not required for basic FreshContext-compatible envelope implementations. It is the methodology for systems that persist recurring signals and want auditability over time.

Key properties of the ledger:
- Every row is immutable once written (no UPDATE operations on scored rows)
- Every row carries a `scraped_at` timestamp with second precision
- Every row carries a `published_at` date extracted from content (where available)
- The ledger accumulates continuously at 6-hour intervals regardless of active user sessions
- The ledger enables time-travel queries: "what was the intelligence landscape for topic X at date Y?"

### 3.3 Schema Reference

```sql
scrape_results (
  id                  TEXT PRIMARY KEY,    -- sr_{timestamp}_{random}
  watched_query_id    TEXT,                -- FK → watched_queries.id
  adapter             TEXT,                -- source adapter name
  query               TEXT,                -- the search term used
  raw_content         TEXT,                -- scraped content (max 8000 chars)
  result_hash         TEXT,                -- 32-bit rolling hash of raw_content
  semantic_fingerprint TEXT,               -- 16-char SHA-256 of normalised title|url|date
  is_new              INTEGER,             -- 1 until consumed by briefing
  scraped_at          TEXT,                -- ISO 8601 UTC timestamp
  published_at        TEXT,                -- extracted content publication date
  relevancy_score     INTEGER,             -- = round(rt_score), 0-100
  is_relevant         INTEGER,             -- 1 if rt_score >= 35, else 0
  base_score          INTEGER,             -- R_0 semantic score, 0-100
  rt_score            REAL,                -- R_t decay-adjusted score, 0-100
  ha_pri_sig          TEXT,                -- SHA-256 audit signature (64 hex chars)
  entropy_level       TEXT                 -- 'low' | 'stable' | 'high'
)
```

---

## Section 4: The Intelligence Feed

### 4.1 Endpoint

```
GET /v1/intel/feed/{profile_id}
```

Optional parameters:
- `limit` — maximum signals to return (default: 20)
- `min_rt` — minimum rt_score filter (default: 0)

### 4.2 Response Structure

```json
{
  "feed_metadata": {
    "profile_id": "default",
    "generated_at": "2026-04-14T09:00:00Z",
    "signal_count": 18,
    "version": "freshcontext-1.2"
  },
  "signals": [
    {
      "signal_id": "sr_1744628412_a3f7b",
      "source": "hackernews",
      "label": "HN: MCP Servers",
      "content": {
        "preview": "...",
        "url": "mcp server 2026"
      },
      "intelligence_stamps": {
        "scraped_at": "2026-04-14T08:12:00Z",
        "published_at": "2026-04-14",
        "base_score": 78,
        "rt_score": 61.4,
        "entropy_level": "stable",
        "ha_pri_sig": "a3f7b2c1d4e5f6a7b8c9d0e1f2a3b4c5..."
      }
    }
  ]
}
```

### 4.3 LLM Integration

The intelligence feed is designed to be consumed directly by any language model or AI agent without modification. The `intelligence_stamps` block gives the agent everything it needs to reason about data freshness:

- `rt_score` — a single number representing current signal value
- `entropy_level` — human-readable decay state
- `published_at` — the actual content date (not the retrieval date)
- `ha_pri_sig` — provenance reference the agent can cite

This is the core value proposition: **AI agents get grounded, timestamped, scored intelligence rather than undated web content of unknown age.**

MCP is one interface over this methodology, not the whole system. The same scoring, timestamp, confidence, and provenance primitives can support APIs, CLIs, npm packages, dashboards, agents, and internal services.

---

## Section 5: Asset Summary

For technical integrators, auditors, and future platform partners:

**What FreshContext owns:**

1. **The FreshContext Specification v1.2** (MIT licence, open standard) — defines the envelope format, confidence levels, structured JSON form, freshness score behavior, and failure-honesty requirements. Timestamped in the public GitHub repository.

2. **The DAR Engine** — the exponential decay scoring methodology with source-specific λ reference defaults and calibrated production tuning.

3. **The Semantic Fingerprinting Method** — the three-field normalisation and SHA-256 fingerprinting approach for cross-adapter deduplication.

4. **The Ha-Pri Audit Signature scheme** — the provenance binding method that makes the historical ledger tamper-evident.

5. **The Store / Ledger design** — support for recurring watched queries, historical signal accumulation, D1-backed storage, and time-series auditability.

6. **The Reference Implementation** — `freshcontext-mcp@0.3.17`, 21 read-only MCP tools / reference adapters, listed on the official MCP Registry and npm. Deployed globally on Cloudflare's edge infrastructure.

---

## Changelog

### Version 1.2 — May 2026
- Clarified Core methodology vs Store/Ledger methodology.
- Preserved DAR as the mathematical scoring backbone.
- Updated reference implementation language for 21 MCP tools/reference adapters.
- Reframed source decay constants as reference defaults/calibration values.
- Added failure-honesty methodology.
- Clarified missing timestamp behavior.
- Clarified MCP as one interface, not the whole system.

### Version 1.1 — April 2026
- Existing methodology version.

---

*"The work isn't gone. It's just waiting to be continued."*
*— Prince Gabriel, Grootfontein, Namibia*

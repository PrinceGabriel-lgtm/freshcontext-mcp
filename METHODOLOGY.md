# FreshContext Data Intelligence Methodology
**Version 1.1 — April 2026**
*Authored by Immanuel Gabriel (Prince Gabriel) — Grootfontein, Namibia*

---

## What This Document Is

This document formally describes the data collection, scoring, and provenance methodology underlying the FreshContext intelligence platform.

It exists for three audiences:

1. **Technical integrators** — teams embedding FreshContext into their agent infrastructure who need to understand what the data represents and how it is scored.
2. **Acquirers and licensing partners** — entities evaluating FreshContext as an asset, who need to audit the methodology that makes the data defensible.
3. **Regulators and auditors** — who may need to verify that the platform's data claims are substantiated by documented, reproducible methodology.

---

## Section 1: Data Collection

### 1.1 Architecture

FreshContext operates a continuous data collection pipeline running on Cloudflare's global edge infrastructure. The pipeline executes every 6 hours via a scheduled cron job and queries 18 watched query definitions stored in the platform's D1 database.

Each watched query specifies:
- **Adapter** — the data source to query (e.g., `hackernews`, `jobs`, `reposearch`)
- **Query** — the search term or URL
- **User ID** — the profile this query serves
- **Filters** — optional parameters (location, exclusion terms, etc.)

### 1.2 Adapters

FreshContext implements 11 production adapters covering the following sources:

| Adapter | Source | Auth Required | Update Frequency |
|---|---|---|---|
| `hackernews` | Hacker News Algolia API | None | Real-time |
| `jobs` | Remotive API | None | Continuous |
| `reposearch` | GitHub Search API | Optional (rate limit) | Real-time |
| `github` | GitHub Repository API | Optional | Real-time |
| `reddit` | Reddit JSON API | None | Real-time |
| `yc` | YC Open Source API | None | Per batch cycle |
| `packagetrends` | npm Registry + npm Downloads API | None | Per publish |
| `finance` | Yahoo Finance API | None | Market hours |
| `hackernews` | HN Algolia Full-Text Search | None | Real-time |

All adapters operate exclusively on **publicly accessible data**. No credentials are required or used for data access. All fetch requests include a `User-Agent` header identifying the FreshContext crawler.

### 1.3 Content Hash Deduplication

Before any signal is stored, the platform computes a 32-bit rolling hash of the raw content. If the most recent stored result for a given watched query carries an identical hash, the current result is discarded. This prevents storing unchanged content across cron cycles.

### 1.4 Semantic Deduplication

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

### 2.2 Base Score Calculation (R_0)

R_0 is computed by matching content against the user profile:

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

### 2.3 Decay Function (R_t)

```
R_t = R_0 · e^(-λt)
```

Where:
- `λ` = source-specific decay constant (per hour)
- `t` = hours elapsed since `published_at`

If `published_at` cannot be extracted from the content, `t` is assumed to equal one half-life for that source (conservative assumption — signal is treated as partially decayed but not dead).

### 2.4 Source Decay Constants (λ)

These constants represent the platform's proprietary calibration of how quickly signals from each source class lose intelligence value:

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

These constants are calibrated against observed information decay rates across source types. They are the platform's primary trade secret and are not exposed in API responses.

### 2.5 Entropy Classification

Each signal is classified into one of three entropy states based on its position on the decay curve:

| State | Condition | Interpretation |
|---|---|---|
| `low` | `t < half_life / 2` | Signal near peak value — act now |
| `stable` | `t < 1.5 × half_life` | Usable signal — monitor |
| `high` | `t ≥ 1.5 × half_life` | Significantly degraded — verify before acting |

### 2.6 Relevancy Threshold

Signals with `rt_score < 35` are stored with `is_relevant = 0`. They remain in the database for audit and historical analysis but are excluded from briefings and the intelligence feed by default. The threshold is configurable per profile.

---

## Section 3: Provenance and Auditability

### 3.1 The Ha-Pri Audit Signature

Every signal stored in the FreshContext database carries a `ha_pri_sig` — a SHA-256 audit signature computed as:

```
SHA-256( result_id + ":" + content_hash + ":" + "FRESHCONTEXT_DAR_V1" )
```

This signature serves three purposes:

1. **Tamper detection** — the signature binds the content hash to the result ID and the engine version. Any modification to the stored content would invalidate the signature.
2. **Provenance chain** — every row in the `scrape_results` table is cryptographically linked to the moment it was scored by the DAR engine.
3. **Licensing audit** — when FreshContext data is provided to a third party under licence, the `ha_pri_sig` column provides an immutable record of exactly what was delivered and when.

### 3.2 D1 Historical Ledger

The `scrape_results` table functions as a **Contextual Ledger** — not merely a cache, but a time-series record of intelligence signals with full provenance.

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
    "version": "freshcontext-1.1"
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

---

## Section 5: Asset Summary

For acquirers, investors, and licensing partners:

**What FreshContext owns:**

1. **The FreshContext Specification v1.1** (MIT licence, open standard) — defines the envelope format, confidence levels, and structured JSON form. Timestamped in the public GitHub repository.

2. **The DAR Engine** (proprietary) — the exponential decay scoring methodology with source-specific λ constants. These constants are not published and constitute trade secret IP.

3. **The Semantic Fingerprinting Method** (proprietary) — the three-field normalisation and SHA-256 fingerprinting approach for cross-adapter deduplication.

4. **The Ha-Pri Audit Signature scheme** (proprietary) — the provenance binding method that makes the historical ledger tamper-evident.

5. **The Historical D1 Ledger** (data asset) — the continuously accumulating time-series dataset. As of the date of this document, the ledger has been running since early 2026 with 6-hour collection intervals across 18 watched queries. The dataset grows in defensibility with every passing day.

6. **The Reference Implementation** — `freshcontext-mcp@0.3.15`, listed on the official MCP Registry and npm. Deployed globally on Cloudflare's edge infrastructure.

---

*"The work isn't gone. It's just waiting to be continued."*
*— Prince Gabriel, Grootfontein, Namibia*

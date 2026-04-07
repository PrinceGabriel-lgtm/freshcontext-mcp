# The FreshContext Specification
**Version 1.1 — April 2026**
*Authored by Immanuel Gabriel (Prince Gabriel) — Grootfontein, Namibia*

---

## What This Is

The FreshContext Specification defines a standard envelope format for AI-retrieved web data.

It exists to solve one problem: **AI models present stale data with the same confidence as fresh data, and users have no way to tell the difference.**

FreshContext fixes this by wrapping every piece of retrieved content in a structured envelope that carries three guarantees:

1. **When** the data was retrieved (exact ISO 8601 timestamp)
2. **Where** it came from (canonical source URL)
3. **How confident** we are that the content date is accurate (freshness confidence)

Any tool, agent, or system that implements this spec is **FreshContext-compatible**.

---

## The Envelope Format

Every FreshContext-compatible response MUST wrap its content in the following envelope:

```
[FRESHCONTEXT]
Source: <canonical_url>
Published: <content_date_or_"unknown">
Retrieved: <iso8601_timestamp>
Confidence: <high|medium|low>
---
<content>
[/FRESHCONTEXT]
```

### Field Definitions

| Field | Required | Format | Description |
|---|---|---|---|
| `Source` | Yes | Valid URL | The canonical URL of the original source |
| `Published` | Yes | ISO 8601 date or `"unknown"` | Best estimate of when the content was originally published |
| `Retrieved` | Yes | ISO 8601 datetime with timezone | Exact timestamp when this data was fetched |
| `Confidence` | Yes | `high`, `medium`, or `low` | Confidence level of the `Published` date estimate |

---

## Confidence Levels

### `high`
The publication date was sourced from a structured, machine-readable field — an API response, HTML metadata tag, RSS feed, or official timestamp. The date is reliable.

*Examples: GitHub API `pushed_at`, arXiv submission date, Hacker News `created_at`, SEC EDGAR filing date, USASpending.gov award date*

### `medium`
The publication date was inferred from page signals — visible date strings, URL patterns, or content heuristics. Likely correct but not guaranteed.

*Examples: Blog post date parsed from HTML, URL containing `/2025/03/`, footer copyright year*

### `low`
No reliable date signal was found. The date is an estimate based on indirect signals or is entirely unknown.

*Examples: Static page with no date, scraped content with no metadata, cached result of unknown age*

---

## Structured Form (JSON)

Implementations MAY additionally expose freshness metadata as structured JSON alongside the text envelope:

```json
{
  "freshcontext": {
    "source_url": "https://github.com/owner/repo",
    "content_date": "2026-03-05",
    "retrieved_at": "2026-03-16T09:19:00.000Z",
    "freshness_confidence": "high",
    "adapter": "github",
    "freshness_score": 94
  },
  "content": "..."
}
```

### `freshness_score` (optional)

A numeric representation of data freshness from 0–100, calculated as:

```
freshness_score = max(0, 100 - (days_since_retrieved × decay_rate))
```

Where `decay_rate` defaults to `1.5` for general web content. Implementations MAY use domain-specific decay rates to reflect how quickly different categories of data become unreliable.

#### Recommended Decay Rates by Domain

| Category | Decay Rate | Approximate Half-life | Examples |
|---|---|---|---|
| Financial data | 5.0 | ~10 days | Stock prices, market cap, P/E ratios |
| Job listings | 3.0 | ~17 days | Remote job boards, HN Who is Hiring |
| News / HN / Reddit | 2.0 | ~25 days | Top stories, community discussion |
| Government procurement | 1.5 | ~33 days | USASpending.gov, GeBIZ tenders |
| GitHub repositories | 1.0 | ~50 days | Stars, forks, last commit, README |
| Product releases | 1.0 | ~50 days | Changelog entries, npm versions |
| Academic papers | 0.3 | ~167 days | arXiv submissions, Google Scholar |
| General web content | 1.5 | ~33 days | Default for unclassified sources |

#### Score Interpretation

| Score | Interpretation |
|---|---|
| 90–100 | Retrieved within hours — treat as current |
| 70–89 | Retrieved within days — reliable for most uses |
| 50–69 | Retrieved within weeks — verify before acting |
| Below 50 | Retrieved more than a month ago — use with caution |

---

## Adapter Contract

Any data source that feeds into a FreshContext-compatible system is called an **adapter**. Adapters MUST:

1. Return raw content plus a `content_date` (or `null` if unknown)
2. Set a `freshness_confidence` level based on how the date was determined
3. Never fabricate or forward-date content timestamps
4. Clearly identify which source system produced the data via the `adapter` field

Adapters SHOULD:

- Prefer structured API sources over scraped content when both are available
- Log retrieval errors without silently returning cached or stale data
- Surface rate-limit or access-denied errors explicitly rather than returning empty content
- Use domain-specific decay rates from the recommended table above

---

## Composite Adapters

A **composite adapter** is a FreshContext-compatible adapter that calls multiple upstream adapters in parallel and combines their results into a single unified response. Each upstream result MUST retain its own FreshContext envelope — the composite wrapper MUST NOT collapse individual timestamps into a single envelope.

Composite adapters SHOULD:

- Fire all upstream calls in parallel (e.g. `Promise.allSettled`)
- Handle partial failures gracefully — if one upstream fails, return the rest
- Label each section clearly with its source adapter name
- Include a composite `retrieved_at` timestamp representing the time the composite call was initiated

*Examples in the reference implementation: `extract_landscape`, `extract_company_landscape`, `extract_idea_landscape`*

---

## Why This Matters for AI Agents

Large language models have no internal clock. When an agent retrieves web data, it cannot distinguish between something published this morning and something published three years ago — unless that information is explicitly surfaced.

Without FreshContext (or equivalent):
- An agent recommending job listings may recommend roles that no longer exist
- An agent summarising market trends may cite conditions from a previous cycle
- An agent checking a competitor's pricing may act on outdated information
- An agent synthesising news may present last year's controversy as current

With FreshContext:
- Every piece of retrieved data carries its own timestamp
- The agent can reason about data age before acting
- Users can see exactly how fresh their AI's information is
- Composite intelligence reports carry per-source freshness signals

---

## Compatibility

A tool, server, or API is **FreshContext-compatible** if:

- Its responses include the `[FRESHCONTEXT]...[/FRESHCONTEXT]` envelope, OR
- Its responses include the structured JSON form with `freshcontext.retrieved_at` and `freshcontext.freshness_confidence` fields

Partial implementations that include only `retrieved_at` without `freshness_confidence` are considered **FreshContext-aware** but not fully compatible.

### Compatibility Levels

| Level | Requirements |
|---|---|
| **FreshContext-compatible** | Full envelope OR full JSON form with `retrieved_at` + `freshness_confidence` |
| **FreshContext-aware** | Includes `retrieved_at` but not `freshness_confidence` |
| **FreshContext-scored** | Full compatible + numeric `freshness_score` with domain-specific decay |

---

## Reference Implementation

The canonical reference implementation of this specification is:

**freshcontext-mcp** — an MCP server with 20 adapters covering:

**Intelligence:** GitHub, Hacker News, Google Scholar, arXiv, Reddit

**Competitive research:** YC Companies, Product Hunt, GitHub repo search, npm/PyPI package trends

**Market data:** Yahoo Finance (up to 5 tickers), job listings (Remotive, RemoteOK, HN Hiring)

**Unique — not available in any other MCP server:**
- `extract_changelog` — release history from any repo, npm package, or website
- `extract_govcontracts` — US federal contract awards (USASpending.gov)
- `extract_sec_filings` — SEC 8-K material event disclosures (EDGAR)
- `extract_gdelt` — global news intelligence, 100+ languages, updated every 15 minutes
- `extract_gebiz` — Singapore Government procurement (data.gov.sg)

**Composite landscapes:** `extract_landscape`, `extract_idea_landscape`, `extract_gov_landscape`, `extract_finance_landscape`, `extract_company_landscape`

**Deployment:**
- npm: `freshcontext-mcp`
- GitHub: https://github.com/PrinceGabriel-lgtm/freshcontext-mcp
- Cloud endpoint: `https://freshcontext-mcp.gimmanuel73.workers.dev/mcp`
- Apify Store: `https://apify.com/prince_gabriel/freshcontext-mcp`
- MCP Registry: `io.github.PrinceGabriel-lgtm/freshcontext`

---

## Changelog

### Version 1.1 — April 2026
- Added Composite Adapters section
- Added domain-specific decay rate table with recommended values
- Added Compatibility Levels table (compatible / aware / scored)
- Updated reference implementation to 20 adapters
- Added `extract_gdelt`, `extract_gebiz`, `extract_sec_filings` to high-confidence examples
- Added Apify Store and MCP Registry to reference implementation listings

### Version 1.0 — March 2026
- Initial specification published

---

## Versioning

This document is version 1.1 of the FreshContext Specification.

Future versions will be tagged in this repository. Breaking changes to the envelope format will increment the major version. Additive changes (new optional fields, new confidence levels, new recommended values) will increment the minor version.

---

## License

This specification is published under the MIT License.
Implementations may be proprietary or open source.
Attribution to the FreshContext Specification is appreciated but not required.

---

*"The work isn't gone. It's just waiting to be continued."*
*— Prince Gabriel, Grootfontein, Namibia*

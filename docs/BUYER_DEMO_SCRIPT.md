# FreshContext Buyer Demo Script

## Demo title

Same query, conflicting/stale/fresh context.

## Demo goal

Show that FreshContext is a context-integrity layer, not just another retrieval tool.

The buyer should leave understanding that naive retrieval may pass stale, unknown, and failed context into an agent, while FreshContext scores, penalizes, explains, ranks, and wraps the context before the agent sees it.

Position the demo as Core scoring/envelope/provenance logic demonstrated through the current MCP/reference implementation. FreshContext is not presented as "just MCP"; it is currently an integrated MCP/Core IP package with Core-led architecture and MCP-backed proof.

## Setup

Use a single buyer-relevant query:

```text
Should our AI procurement agent prioritize Vendor Atlas for a 2026 public-sector workflow?
```

Do not implement a new demo for this phase. This script can be run as slides, a terminal walkthrough, a static HTML page, or a recorded narration using mocked/static signals.

## Cast of signals

Use four input signals that all appear semantically relevant.

### Signal A: stale but authoritative source

```json
{
  "source": "https://official-procurement.example/vendors/atlas",
  "adapter": "govcontracts",
  "published_at": "2022-05-10",
  "retrieved_at": "2026-05-24T10:00:00Z",
  "confidence": "high",
  "status": "success",
  "content": "Vendor Atlas was awarded a major public-sector modernization contract..."
}
```

Narration:

This source is authoritative and timestamp confidence is high, but the signal is old. A naive retriever may rank it highly because it exactly matches the query and comes from an official source.

### Signal B: fresh but weaker source

```json
{
  "source": "https://news.example/atlas-delivery-delay",
  "adapter": "gdelt",
  "published_at": "2026-05-22",
  "retrieved_at": "2026-05-24T10:00:00Z",
  "confidence": "medium",
  "status": "success",
  "content": "Recent local reporting suggests Vendor Atlas missed delivery milestones on a related project..."
}
```

Narration:

This source is less authoritative than the official contract record, but it is much newer. It may materially change the risk assessment.

### Signal C: unknown-date source

```json
{
  "source": "https://vendor-atlas.example/case-study",
  "adapter": "changelog",
  "published_at": null,
  "retrieved_at": "2026-05-24T10:00:00Z",
  "confidence": "low",
  "status": "success",
  "content": "Vendor Atlas describes successful public-sector deployments and customer outcomes..."
}
```

Narration:

The page was retrieved today, but its publication date is unknown. FreshContext should not treat retrieved today as published today.

### Signal D: failed/error source

```json
{
  "source": "https://registry.example/vendor-atlas-filings",
  "adapter": "sec_filings",
  "published_at": null,
  "retrieved_at": "2026-05-24T10:00:00Z",
  "confidence": "low",
  "status": "failed",
  "content": "429 rate limit exceeded"
}
```

Narration:

This is a relevant source class, but the retrieval failed. A context-integrity layer should preserve the diagnostic signal without passing it as successful current evidence.

## What naive retrieval might do

Show the naive context bundle:

```text
Naive retrieval bundle:

1. Official procurement result about Vendor Atlas
2. Recent article about delivery delays
3. Vendor Atlas case study
4. Registry filing result

All four are passed to the agent because all four match the query.
```

Narration:

Naive retrieval sees semantic match. It may not separate published time from retrieval time, may not penalize unknown dates, and may not distinguish failed retrieval from successful evidence. The agent receives a context window that looks complete but is temporally unsafe.

## FreshContext scoring pass

Show the FreshContext interpretation. This is the Core logic: timestamp handling, decay, confidence, status penalties, explanations, and envelope preparation. In the current product, that logic is demonstrated through the MCP/reference implementation and related Worker surfaces.

| Signal | Semantic relevance | Time status | Confidence | Result status | FreshContext treatment |
|---|---:|---|---|---|---|
| A: official contract | High | Stale | High | Success | Keep, but decay heavily and explain age |
| B: recent report | Medium | Fresh | Medium | Success | Rank higher for current risk relevance |
| C: case study | Medium | Unknown | Low | Success | Penalize because date is unknown |
| D: filings lookup | High source class | Unknown | Low | Failed | Do not rank as evidence; surface as failure |

Example scoring language:

```text
Signal A:
- Strong source authority
- High timestamp confidence
- Published in 2022
- Decayed for 2026 decision support

Signal B:
- Medium source confidence
- Published 2 days ago
- Higher current utility despite weaker authority

Signal C:
- Retrieved today but publication date unknown
- Low timestamp confidence
- Penalized to avoid false freshness

Signal D:
- Retrieval failed
- Score reduced to zero for evidence ranking
- Preserved as diagnostic context only
```

## FreshContext ranked result

Show a ranked result:

```json
[
  {
    "rank": 1,
    "source": "https://news.example/atlas-delivery-delay",
    "reason": "Fresh signal with medium timestamp confidence; current operational risk relevance.",
    "freshness_score": 82,
    "confidence": "medium",
    "status": "success"
  },
  {
    "rank": 2,
    "source": "https://official-procurement.example/vendors/atlas",
    "reason": "Authoritative but stale; useful background, not current decision evidence.",
    "freshness_score": 31,
    "confidence": "high",
    "status": "success"
  },
  {
    "rank": 3,
    "source": "https://vendor-atlas.example/case-study",
    "reason": "Unknown publication date; retrieved today does not prove content freshness.",
    "freshness_score": null,
    "confidence": "low",
    "status": "success"
  },
  {
    "rank": null,
    "source": "https://registry.example/vendor-atlas-filings",
    "reason": "Retrieval failed; not treated as evidence.",
    "freshness_score": null,
    "confidence": "low",
    "status": "failed"
  }
]
```

Narration:

FreshContext does not delete useful old evidence. It changes the label and rank. The authoritative 2022 source is still useful background, but the fresh risk signal should be seen before an agent recommends action.

## Final context envelope for the agent

Show the final packaged context:

```text
[FRESHCONTEXT]
Source: https://news.example/atlas-delivery-delay
Published: 2026-05-22
Retrieved: 2026-05-24T10:00:00Z
Confidence: medium
Freshness-Score: 82
Status: success
Reason: Fresh signal with current procurement risk relevance.
---
Recent local reporting suggests Vendor Atlas missed delivery milestones on a related project.
[/FRESHCONTEXT]

[FRESHCONTEXT]
Source: https://official-procurement.example/vendors/atlas
Published: 2022-05-10
Retrieved: 2026-05-24T10:00:00Z
Confidence: high
Freshness-Score: 31
Status: success
Reason: Authoritative but stale; use as historical background.
---
Vendor Atlas was awarded a major public-sector modernization contract.
[/FRESHCONTEXT]

[FRESHCONTEXT]
Source: https://vendor-atlas.example/case-study
Published: unknown
Retrieved: 2026-05-24T10:00:00Z
Confidence: low
Freshness-Score: null
Status: success
Reason: Publication date unknown; do not treat as current evidence.
---
Vendor Atlas describes successful public-sector deployments and customer outcomes.
[/FRESHCONTEXT]

[FRESHCONTEXT]
Source: https://registry.example/vendor-atlas-filings
Published: unknown
Retrieved: 2026-05-24T10:00:00Z
Confidence: low
Freshness-Score: null
Status: failed
Reason: Retrieval failed with rate-limit response; not evidence.
---
429 rate limit exceeded
[/FRESHCONTEXT]
```

## Agent answer before FreshContext

Use a short unsafe example:

```text
Vendor Atlas appears to be a strong procurement candidate based on official contract history, successful case studies, and registry relevance.
```

Narration:

The naive answer sounds confident because the retrieved context matched the query. It does not reveal that one source is stale, one is undated, and one failed.

## Agent answer after FreshContext

Use a short safer example:

```text
Vendor Atlas has authoritative historical procurement evidence, but the strongest current signal is a recent delivery-risk report. The case study is undated and should not be treated as current. The registry lookup failed and should be retried before a final recommendation.
```

Narration:

The model did not become smarter by itself. The context became more honest before it reached the model.

## Buyer close

Say:

```text
FreshContext is the layer that turns retrieved text into time-aware, source-aware, confidence-aware context. Today it is packaged as an integrated MCP/Core IP package: Core-led architecture, MCP-backed proof. The 21 tools prove the adapter pattern; they are not the whole product.
```

## Expected buyer takeaways

- FreshContext solves a real failure mode in agentic and RAG systems.
- Freshness is not treated as a vague label; it is scored and explained.
- Unknown dates and failed sources are not silently promoted.
- The current MCP/reference implementation demonstrates Core scoring, envelope, and provenance logic in a working package.
- The same Core-led logic can later support APIs, feeds, dashboards, or internal enterprise retrieval if extracted or licensed that way.
- The current product has enough proof for diligence without needing new feature work in this phase.

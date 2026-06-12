# Human-Readable Output Contract

Status: implemented MVP contract.

This document describes the reader-facing output layer over FreshContext Core decisions. The MVP is implemented as an additive Core helper and `evaluate_context` structured JSON field. It does not change Core behavior, ranking, decision labels, utility math, Worker behavior, package version, deployment state, or public site copy.

FreshContext is not truth itself. FreshContext records why context was trusted, down-ranked, questioned, refreshed, watched, backgrounded, or excluded before an AI system uses it.

## Purpose

FreshContext Core already returns machine decisions, reasons, warnings, utility, freshness, confidence, Source Profile context, and provenance material. The human-readable output layer should make those results understandable without exposing every internal score first.

The output should answer:

- Can I use this context?
- Why was this source treated this way?
- What reached the model?
- What was kept out?
- Can another agent inherit this context safely?

## Audiences

- Normal readers need a short status, reason, and warning.
- Analysts and buyers need an evidence table that shows why each source was treated differently.
- Developers need a stable JSON shape for future SDK, API, MCP, and CLI formatting.
- Multi-agent workflows need enough identity and judgment metadata for one agent to hand context to another without losing evidence boundaries.

## Non-Goals

This contract does not:

- certify truth
- provide professional guidance in legal, clinical, tax, employment, academic, or financial domains
- change Core scoring or ranking
- make utility control decision labels
- wire adapters into Core
- add `evaluate_source`
- define a live hosted API response
- replace Signal Contract v1
- claim Ha-Pri v2 production enforcement

## Decision Vocabulary

FreshContext should keep the current Core machine decisions as the stable machine layer.

| Machine decision | Reader label | Meaning | Human action | Agent action | Must not claim |
| --- | --- | --- | --- | --- | --- |
| `use_first` | Use first | Strong, current context for the task. | Read or place this near the top of the working context. | Prioritize in the context bundle. | This is guaranteed true. |
| `cite_as_primary` | Primary source | Relevant, current, and traceable enough to use as main evidence. | Use as main evidence while applying normal review. | Use as primary citation evidence. | This source proves the claim by itself. |
| `cite_as_supporting` | Supporting source | Useful evidence, but not enough to stand alone as the latest or strongest support. | Pair with a clearer, newer, or more authoritative source. | Include as supporting context, not sole evidence. | This is sufficient primary evidence. |
| `use_as_background` | Background only | Relevant context, but not strong enough for current-evidence claims. | Use for framing, history, or orientation. | Keep lower in the context bundle. | This is current proof. |
| `needs_verification` | Needs verification | Possibly useful, but timing, confidence, or traceability is uncertain. | Verify before relying on it. | Do not use as trusted primary context. | This source is false. |
| `needs_refresh` | Needs refresh | Possibly useful, but too stale or date-uncertain for this source type. | Re-query or find a newer source. | Refresh retrieval before use. | This source is useless or false. |
| `watch_only` | Watch only | Interesting signal, but not strong enough to prioritize. | Monitor or keep as weak signal. | Keep out of primary reasoning unless requested. | This is actionable evidence. |
| `exclude` | Excluded | Failed, too weak, unsafe, or not useful enough for the final context bundle. | Keep out unless manually reviewed. | Do not pass to the model as useful context. | This is legally or factually invalid. |

## Reader Card

The Reader Card is for normal humans. It should be short and decision-first.

Example:

```txt
Status: Primary source

Why:
Recent, directly relevant, and traceable enough for main evidence.

Watch-outs:
FreshContext does not certify truth.

What FreshContext did:
Ranked this source above weaker, stale, or unclear candidates before model use.
```

Recommended fields:

- `status`
- `why`
- `watch_outs`
- `what_freshcontext_did`

The Reader Card should not lead with raw scores unless a technical user asks for them.

The current MVP is the `readable` object returned inside each structured `evaluate_context` result:

```json
{
  "decision": "cite_as_primary",
  "label": "Cite as primary",
  "readable": {
    "label": "Primary source",
    "summary": "This source is strong enough to use as main evidence.",
    "why": [
      "Strong semantic match and current freshness for arxiv.",
      "source profile academic_research uses lenient date policy",
      "intent profile citation_check selected"
    ],
    "action": "Use this as main evidence while preserving citation and provenance.",
    "warnings": [
      "FreshContext judges citation readiness and context usefulness; it does not certify truth."
    ]
  }
}
```

`readable.why` is capped at five reasons to keep output readable and deterministic.

The readable object translates Core decisions into user-facing language. It does not change ranking, decision labels, utility scoring, or source intake.

## Analyst Evidence Table

The Analyst Evidence Table is for buyers, reviewers, and smart non-technical readers who need to compare multiple sources.

Recommended columns:

| Column | Plain meaning |
| --- | --- |
| Decision | How FreshContext says this context should be treated. |
| Source | Where the context came from. |
| Usefulness | How helpful the context is for this question. |
| Freshness | Whether the timing is current enough for this use. |
| Confidence | How reliable the context signal appears. |
| Provenance | Whether source identity and audit metadata are preserved. |
| Reason | Short explanation of the treatment label. |
| Warning | Non-advice or verification warning, if any. |

Example row:

```txt
Primary source | arxiv.org/... | High | Current | High | Clear | Recent, direct academic source | Does not certify truth
```

## Developer JSON Contract

This is a proposed future response shape for SDK, API, MCP, and CLI formatting. It is not a live API contract yet.

```json
{
  "context_id": "ctx_...",
  "decision": "cite_as_primary",
  "reader_label": "Primary source",
  "summary": "Recent, directly relevant source with clear provenance.",
  "source": {
    "id": "src_...",
    "url": "https://example.com/source",
    "type": "academic_research",
    "title": "Example source"
  },
  "scores": {
    "rank": 0.92,
    "freshness": 87,
    "utility": 81,
    "confidence": "high"
  },
  "provenance": {
    "published_at": "2026-06-01T00:00:00.000Z",
    "retrieved_at": "2026-06-09T00:00:00.000Z",
    "hash": "sha256:..."
  },
  "reasons": [
    "Strong semantic match and current freshness for arxiv."
  ],
  "warnings": [
    "FreshContext judges citation readiness and context usefulness; it does not certify truth."
  ],
  "handoff": {
    "safe_for_agent_handoff": true,
    "handoff_notes": []
  }
}
```

The JSON layer should preserve the current Core decision label while adding a reader label and summary. It should not rename the machine decision.

## Multi-Agent Handoff Contract

A multi-agent handoff should let Agent B understand what Agent A used, rejected, or questioned without re-reading the whole original prompt.

Required fields to consider:

- `context_id`
- `source_id`
- `decision`
- `reader_label`
- `source_profile`
- `intent_profile`
- `freshness_state`
- `confidence_state`
- `utility_state`
- `provenance_hash`
- `published_at`
- `retrieved_at`
- `judged_at`
- `judged_by`
- `handoff_safe`
- `handoff_reason`
- `reasons`
- `warnings`
- `excluded_context_refs`

Example:

```json
{
  "context_id": "ctx_123",
  "source_id": "src_456",
  "decision": "needs_verification",
  "reader_label": "Needs verification",
  "source_profile": "company_intel",
  "intent_profile": "business_due_diligence",
  "freshness_state": "unknown",
  "confidence_state": "medium",
  "utility_state": "partly useful",
  "provenance_hash": "sha256:...",
  "published_at": null,
  "retrieved_at": "2026-06-09T00:00:00.000Z",
  "judged_at": "2026-06-09T00:00:00.000Z",
  "judged_by": "freshcontext-core",
  "handoff_safe": false,
  "handoff_reason": "Useful but missing source date; verify before primary use.",
  "reasons": [
    "published_at/content_date was invalid; cleared"
  ],
  "warnings": [
    "FreshContext supports context triage only; it is not professional legal, tax, or financial guidance."
  ],
  "excluded_context_refs": []
}
```

## Utility Language

Utility means usefulness for the current question. It does not mean truth.

Allowed wording:

- High utility: useful for this question
- Medium utility: partly useful
- Low utility: weak fit for this question

Forbidden wording:

- true
- verified truth
- claims that accuracy is guaranteed
- claims that a source has official approval
- claims that FreshContext has settled the answer

Utility can appear in explanations and reasons, but it must not be described as controlling default decision labels unless a future policy pass explicitly changes that behavior.

## Provenance Language

Provenance means traceable source identity and audit material. It does not mean magical truth.

Allowed wording:

- clear provenance
- unclear provenance
- source identity preserved
- retrieval time recorded
- source timestamp recorded
- deterministic audit hash

Forbidden wording:

- absolute tamper resistance
- truth certification claims
- legal verification claims
- outside audit claims
- origin-authenticated unless a future signing model provides that guarantee

## Forbidden Claims

FreshContext output must not claim:

- it determines truth
- it proves correctness
- it replaces human review
- it is a legal, medical, tax, employment, academic, or investment advisor
- it validates facts beyond the provided context metadata
- it guarantees source authenticity
- it has production Ha-Pri v2 enforcement unless that enforcement is actually implemented

## Future Implementation Passes

Suggested next passes:

- Pass 14-D: review whether the Analyst Evidence Table should become a helper or stay documentation-only.
- Pass 14-E: decide whether to add human-readable text lines to `evaluate_context`, or keep the readable layer JSON-only.
- Later: design Diagnostic Mode on top of `why`, `warnings`, and replay mismatch evidence.

The MVP is intentionally small: it translates existing judgment into readable output without changing the judgment itself.

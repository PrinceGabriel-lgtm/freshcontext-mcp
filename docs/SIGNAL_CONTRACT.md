# FreshContext Signal Contract v1

FreshContext Signal Contract v1 is the current FreshContext input standard: the stable shape for candidate context that should be judged before it reaches a model.

In plain terms:

```text
candidate context -> Signal Contract v1 -> FreshContext judgment -> decision-ready context
```

The Signal Contract is live product architecture. It is used by Core normalization, `evaluate_context`, bring-your-own-context demos, reference adapter signal paths, and future batch validation.

Do not rename this with future-signal terminology. Future context signals, control signals, provenance confidence signals, and richer decision metadata are optional future layers on top of this stable input shape. They are not replacements for Signal Contract v1 and are not required fields today.

It is an additive Core API. It does not change MCP tool schemas, Worker runtime behavior, D1 schema, Store scoring, feeds, or deployment behavior.

## Contract Version

```ts
type SignalContractVersion = "freshcontext.signal.v1";
```

Every normalized signal includes:

```ts
contract_version: "freshcontext.signal.v1"
```

## Input Shape

`FreshContextSignalInput` accepts the common fields used by adapters, agents, ranking, `evaluate_context`, and future Store wiring:

```ts
interface FreshContextSignalInput {
  id?: string;
  source: string;
  source_type?: string;
  title?: string;
  content?: string;
  published_at?: string | null;
  content_date?: string | null;
  retrieved_at?: string | null;
  semantic_score?: number;
  date_confidence?: "high" | "medium" | "low" | "unknown";
  freshness_confidence?: "high" | "medium" | "low";
  status?: "success" | "partial" | "stale" | "failed" | "unknown";
  metadata?: Record<string, unknown>;
}
```

`published_at` is the canonical signal timestamp. `content_date` is accepted as an adapter/envelope compatibility alias.

Minimal caller-provided input usually looks like:

```json
{
  "title": "Example source",
  "content": "Candidate context text...",
  "source": "https://example.com/source",
  "source_type": "official_docs",
  "published_at": "2026-06-01T00:00:00.000Z",
  "retrieved_at": "2026-06-09T00:00:00.000Z",
  "semantic_score": 0.92
}
```

## Normalized Output

`normalizeSignal(input, options?)` returns a `FreshContextSignal`:

```ts
interface FreshContextSignal {
  contract_version: "freshcontext.signal.v1";
  id?: string;
  source: string;
  source_type: string;
  title?: string;
  content?: string;
  published_at: string | null;
  retrieved_at: string;
  semantic_score: number;
  date_confidence: "high" | "medium" | "low" | "unknown";
  status: "success" | "partial" | "stale" | "failed" | "unknown";
  metadata: Record<string, unknown>;
  reasons: string[];
}
```

## Normalization Rules

- Missing or invalid `published_at` / `content_date` becomes `published_at: null`.
- `content_date` maps to `published_at` when `published_at` is absent.
- Meaningfully future-dated timestamps are cleared and receive `date_confidence: "unknown"`.
- Small clock skew is tolerated by the same Core freshness policy used by envelope scoring.
- Failed, empty, timeout, blocked, or error-looking content becomes `status: "failed"`.
- Missing, invalid, negative, or oversized `semantic_score` is clamped into `0..1`.
- `metadata` is shallow-copied so normalization does not mutate caller-owned objects.
- `reasons` records meaningful normalization changes.

## Examples

These examples are intentionally small. They show the current contract shape, not future optional metadata.

### Valid Candidate Signals

Academic research:

```json
{
  "title": "A fresh retrieval-augmented generation benchmark",
  "content": "The paper reports a 2026 benchmark for retrieval-augmented generation systems.",
  "source": "https://arxiv.org/abs/2606.00001",
  "source_type": "arxiv",
  "published_at": "2026-06-01T09:00:00.000Z",
  "retrieved_at": "2026-06-09T12:00:00.000Z",
  "semantic_score": 0.94,
  "metadata": {
    "profile": "academic_research"
  }
}
```

Official docs:

```json
{
  "title": "API changelog",
  "content": "The official changelog documents the current API behavior.",
  "source": "https://docs.example.com/changelog",
  "source_type": "official_docs",
  "published_at": "2026-06-08T10:00:00.000Z",
  "retrieved_at": "2026-06-09T12:00:00.000Z",
  "semantic_score": 0.88
}
```

Jobs/opportunities:

```json
{
  "title": "AI tools engineer",
  "content": "A current remote role for an AI tools engineer.",
  "source": "https://jobs.example.com/ai-tools-engineer",
  "source_type": "jobs",
  "published_at": "2026-06-07T08:00:00.000Z",
  "retrieved_at": "2026-06-09T12:00:00.000Z",
  "semantic_score": 0.86
}
```

Market/finance:

```json
{
  "title": "Company quarterly update",
  "content": "The company reported current quarter revenue and guidance.",
  "source": "https://investors.example.com/q2-update",
  "source_type": "finance",
  "published_at": "2026-06-09T07:00:00.000Z",
  "retrieved_at": "2026-06-09T12:00:00.000Z",
  "semantic_score": 0.83
}
```

Social pulse:

```json
{
  "title": "Developer discussion",
  "content": "Developers are discussing setup friction and recent adoption.",
  "source": "https://news.ycombinator.com/item?id=123456",
  "source_type": "hackernews",
  "published_at": "2026-06-09T11:00:00.000Z",
  "retrieved_at": "2026-06-09T12:00:00.000Z",
  "semantic_score": 0.71
}
```

### Invalid Or Risky Candidate Signals

Missing date:

```json
{
  "title": "Relevant source with no date",
  "content": "Useful candidate context, but no publication timestamp is available.",
  "source": "https://example.com/no-date",
  "source_type": "official_docs",
  "retrieved_at": "2026-06-09T12:00:00.000Z",
  "semantic_score": 0.78
}
```

Invalid timestamp:

```json
{
  "title": "Invalid date source",
  "content": "Candidate context with malformed date metadata.",
  "source": "https://example.com/bad-date",
  "source_type": "official_docs",
  "published_at": "not-a-date",
  "retrieved_at": "2026-06-09T12:00:00.000Z",
  "semantic_score": 0.78
}
```

Meaningfully future-dated timestamp:

```json
{
  "title": "Future-dated source",
  "content": "Candidate context whose publication timestamp is after retrieval time.",
  "source": "https://example.com/future-date",
  "source_type": "official_docs",
  "published_at": "2026-06-09T12:06:00.000Z",
  "retrieved_at": "2026-06-09T12:00:00.000Z",
  "semantic_score": 0.78
}
```

Failed/error-looking content:

```json
{
  "title": "Blocked source",
  "content": "[Error] upstream timeout",
  "source": "https://example.com/blocked",
  "source_type": "official_docs",
  "published_at": "2026-06-09T10:00:00.000Z",
  "retrieved_at": "2026-06-09T12:00:00.000Z",
  "semantic_score": 0.91
}
```

Out-of-range semantic score:

```json
{
  "title": "Overscored source",
  "content": "Candidate context with an out-of-range relevance score.",
  "source": "https://example.com/overscored",
  "source_type": "official_docs",
  "published_at": "2026-06-09T10:00:00.000Z",
  "retrieved_at": "2026-06-09T12:00:00.000Z",
  "semantic_score": 1.7
}
```

## Relationship to Existing Core Types

The signal contract does not replace existing Core types:

- `AdapterResult` remains the adapter-to-envelope input shape.
- `FreshContext` remains the envelope output shape.
- `FreshSignal` and `RankedSignal` remain the ranking input/output shapes.
- `ContextUtilityInput` remains the pure context-conditioned utility primitive.

The contract gives these surfaces a shared signal vocabulary without requiring Store, Worker, or MCP schema changes.

## Boundary

Signal Contract v1 does not determine truth, certify data, or provide legal, medical, tax, or financial advice. It provides normalized context metadata for freshness, provenance, relevance, and workflow review.

## Future Metadata Boundary

Future context signals, control signals, ingestion quality signals, structure preservation signals, and provenance confidence signals may later improve decisions such as `cite_as_primary`, `needs_refresh`, `needs_verification`, or `exclude`.

Those are roadmap metadata layers. They should remain optional until tests prove they improve decisions. The public input contract should stay boring and stable:

```text
title + content + source + source_type + published_at + retrieved_at + semantic_score
```

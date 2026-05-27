# FreshContext Signal Contract v1

FreshContext Signal Contract v1 defines the Core shape for a retrieved signal before it is ranked, wrapped, stored, or passed to an agent workflow.

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

`FreshContextSignalInput` accepts the common fields used by adapters, agents, ranking, and future Store wiring:

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

## Relationship to Existing Core Types

The signal contract does not replace existing Core types:

- `AdapterResult` remains the adapter-to-envelope input shape.
- `FreshContext` remains the envelope output shape.
- `FreshSignal` and `RankedSignal` remain the ranking input/output shapes.
- `ContextUtilityInput` remains the pure context-conditioned utility primitive.

The contract gives these surfaces a shared signal vocabulary without requiring Store, Worker, or MCP schema changes.

## Boundary

Signal Contract v1 does not determine truth, certify data, or provide legal, medical, tax, or financial advice. It provides normalized context metadata for freshness, provenance, relevance, and workflow review.

# FreshContext Core API

FreshContext Core is the reusable engine layer in the current integrated MCP/Core package. It owns envelope creation, freshness scoring, failure honesty, rank/explain primitives, and the experimental context-utility primitive.

MCP, Worker HTTP, future REST, and future CLI/SDK surfaces should use Core as the contract center instead of redefining freshness or envelope behavior per host.

## Stable Public Core API

Import stable Core functions from:

```ts
import {
  calculateFreshnessScore,
  formatForLLM,
  looksLikeFailedAdapterContent,
  scoreLabel,
  stampFreshness,
  toStructuredJSON,
} from "./src/core/index.js";
```

### Envelope

- `stampFreshness(result, options, adapter)` creates a `FreshContext` object from adapter output.
- `formatForLLM(ctx, options?)` renders the text envelope and trailing structured JSON block.
- `toStructuredJSON(ctx)` returns the machine-readable FreshContext JSON shape.

### Scoring

- `calculateFreshnessScore(content_date, retrieved_at, adapter)` returns a freshness score from `0..100`, or `null` when the content date cannot be trusted.
- `scoreLabel(score)` maps a numeric freshness score to a human-readable label.

### Guards

- `looksLikeFailedAdapterContent(raw)` detects empty, security, timeout, and error-like adapter output so failed content is not stamped as fresh high-confidence context.

### Stable Types

- `FreshContext`
- `AdapterResult`
- `ExtractOptions`
- `EnvelopeFormatOptions`
- `SignalConfidence`

These types describe the stable envelope and adapter result contract.

## Signal Contract v1

Signal Contract v1 is the additive Core shape for a retrieved signal before it is ranked, wrapped, stored, or passed to an agent workflow.

Public exports:

- `SIGNAL_CONTRACT_VERSION`
- `normalizeSignal(input, options?)`
- `FreshContextSignalInput`
- `FreshContextSignal`
- `SignalDateConfidence`
- `SignalContractVersion`
- `SignalNormalizeOptions`

`published_at` is the canonical signal timestamp. `content_date` is accepted as an adapter/envelope compatibility alias. Normalization clears invalid or meaningfully future-dated timestamps, marks failed/error-looking content as `status: "failed"`, clamps `semantic_score` into `0..1`, and records normalization reasons.

See [Signal Contract v1](./SIGNAL_CONTRACT.md).

## Public Ranking Primitives

The ranking primitives are public, but consumers should treat their score scales carefully:

- `rankSignal(signal, options?)`
- `rankSignals(signals, options?)`
- `explainSignal(rankedSignalLike)`
- `FreshSignal`
- `RankedSignal`
- `RankOptions`

Score scales:

- `semantic_score`: normalized `0..1`
- `final_score`: normalized `0..1`
- `freshness_score`: FreshContext freshness score `0..100`, or `null`

Ranking combines semantic relevance and freshness into a deterministic order. It does not own retrieval, embedding, vector search, storage, or host-specific scoring policy.

## Experimental Utility Primitive

The context-conditioned utility primitive is pure and tested, but it is not production-wired into MCP ranking, Worker feeds, Store scoring, or runtime behavior.

Experimental exports:

- `calculateContextUtility`
- `ContextUtilityStatus`
- `ContextUtilityInput`
- `ContextUtilityResult`

These are part of Math Spine Phase 1. Treat them as experimental until a later math integration pass decides how they should affect production ranking or external APIs.

## Internal, Policy, and Compatibility Exports

- `clampScore` is an internal ranking helper. It is currently exported for tests and utility use, but it should not be presented as a primary buyer-facing API.
- `LAMBDA` is the current policy constant table used by freshness scoring. It documents the reference decay policy, but it is not a buyer-facing tuning API.

Compatibility lanes should remain:

- `src/types.ts` re-exports legacy adapter types from Core.
- `src/tools/freshnessStamp.ts` re-exports envelope helpers for older MCP/npm import paths.

These lanes protect existing imports while Core becomes the center. Do not remove them until downstream imports have been migrated intentionally.

## What Core Does Not Own

Core does not own:

- MCP transport
- Cloudflare runtime behavior
- KV cache policy
- Cache metadata injection
- D1, feed, or cron behavior
- Store/feed scoring and provenance persistence
- Ha-Pri v2
- Hosted dashboard, API, deployment, or runtime concerns

Hosts may wrap Core outputs with their own transport, cache, session, rate-limit, or persistence metadata, but they should not fork the Core envelope and freshness contract without an explicit compatibility reason.


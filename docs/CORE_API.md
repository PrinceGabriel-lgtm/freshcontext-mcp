# FreshContext Core API

FreshContext Core is the reusable engine layer in the current integrated Core/MCP package. It owns signal normalization, envelope creation, freshness scoring, failure honesty, Source Profiles, decision output, rank/explain primitives, the context-utility primitive, and pure provenance helpers.

MCP, Worker HTTP, future REST, and future CLI/SDK surfaces should use Core as the contract center instead of redefining freshness or envelope behavior per host.

For the package-level boundary between Core, MCP, adapters, and deployment surfaces, see [Core / MCP Boundary](./CORE_MCP_BOUNDARY.md).

## Stable Public Core API

Import stable Core functions from:

```ts
import {
  calculateFreshnessScore,
  evaluateSignals,
  formatForLLM,
  getSourceProfile,
  interpretEvaluations,
  looksLikeFailedAdapterContent,
  normalizeSignal,
  scoreLabel,
  stampFreshness,
  toStructuredJSON,
} from "freshcontext-mcp/core";
```

The `freshcontext-mcp/core` subpath is the direct Core import boundary inside the current MCP package. It does not create a standalone `freshcontext-core` package yet; that remains a future package-split lane.

### Envelope

- `stampFreshness(result, options, adapter)` creates a `FreshContext` object from adapter output.
- `formatForLLM(ctx, options?)` renders the text envelope and trailing structured JSON block.
- `toStructuredJSON(ctx)` returns the machine-readable FreshContext JSON shape.

### Scoring

- `calculateFreshnessScore(content_date, retrieved_at, adapter)` returns a freshness score from `0..100`, or `null` when the content date cannot be trusted.
- `scoreLabel(score)` maps a numeric freshness score to a human-readable label.

### Guards

- `looksLikeFailedAdapterContent(raw)` detects empty, security, timeout, and error-like adapter output so failed content is not stamped as fresh high-confidence context.

## Core Evaluation Pipeline

The Core evaluation pipeline is the pure orchestration layer over the existing primitives.

Public exports:

- `evaluateSignal(input, options?)`
- `evaluateSignals(inputs, options?)`
- `CoreSignalEvaluationOptions`
- `CoreSignalEvaluationResult`
- `CoreSignalEnvelopeResult`
- `CoreSignalProvenanceOptions`

`evaluateSignal` normalizes a signal, applies timestamp/failure guards, computes `freshness_score`, computes context-conditioned utility, ranks/explains the signal, optionally creates a FreshContext envelope, and optionally prepares Ha-Pri v2 provenance material.

It does not fetch, cache, write D1, inspect Worker bindings, know MCP tool schemas, deploy, or publish. Hosts decide whether to store, cache, transmit, or expose the returned result.

`evaluateSignals` evaluates each input and returns evaluations sorted by existing `rankSignal` final score, preserving input order when scores tie. Context utility is returned as a sidecar and does not replace `final_score`.

Context utility is returned as sidecar output in the current pipeline; it does not replace or modify the default `rankSignal` / `evaluateSignals` ordering. A future pass may add an explicit utility-weighted ranking mode.

Local demo:

```bash
npm run demo:evaluate:file -- examples/sources.academic.example.json
npm run demo:evaluate:file -- examples/sources.jobs.example.json
```

The demo reads caller-provided JSON with `profile`, `intent`, and `signals`, then returns decision-first output. It does not fetch URLs, crawl, read folders, deploy REST, or implement Operator mode.

### Stable Types

- `FreshContext`
- `AdapterResult`
- `ExtractOptions`
- `EnvelopeFormatOptions`
- `SignalConfidence`

These types describe the stable envelope and adapter result contract.

## Signal Contract v1

Signal Contract v1 is the current FreshContext input standard: the stable shape for candidate context before it is ranked, wrapped, stored, judged by `evaluate_context`, or passed to an agent workflow.

Public exports:

- `SIGNAL_CONTRACT_VERSION`
- `normalizeSignal(input, options?)`
- `FreshContextSignalInput`
- `FreshContextSignal`
- `SignalDateConfidence`
- `SignalContractVersion`
- `SignalNormalizeOptions`

`published_at` is the canonical signal timestamp. `content_date` is accepted as an adapter/envelope compatibility alias. Normalization clears invalid or meaningfully future-dated timestamps, marks failed/error-looking content as `status: "failed"`, clamps `semantic_score` into `0..1`, and records normalization reasons.

Future context signals and control signals are optional future metadata layers, not replacements for Signal Contract v1 and not required public input fields today.

See [Signal Contract v1](./SIGNAL_CONTRACT.md).

## Source Profiles

Source Profiles are early public Core metadata for describing how classes of information age, fail, rank, and explain.

Public exports:

- `BUILT_IN_SOURCE_PROFILES`
- `getSourceProfile(profileId)`
- `listSourceProfiles()`
- `SourceProfile`
- `SourceProfileId`
- `SourceAuthorityHint`
- `SourceDatePolicy`
- `SourceFailurePolicy`
- `SourceSurface`

They reframe the 21 named adapter tools as reference adapters and source-profile examples instead of the product identity. The MCP server also exposes `evaluate_context` as the generic caller-provided context evaluation path. Source Profiles do not implement `retrieve(...)`, Operator mode, adapter selection, crawling, local file search, or any host/runtime behavior.

## Decision Helper

The decision helper translates a Core evaluation result into user-facing action meaning.

Public exports:

- `interpretEvaluation(evaluation, options?)`
- `interpretEvaluations(evaluations, options?)`
- `ContextDecision`
- `IntentProfileId`
- `ContextDecisionOptions`
- `ContextDecisionResult`

Supported decisions:

- `use_first`
- `cite_as_primary`
- `cite_as_supporting`
- `use_as_background`
- `needs_verification`
- `needs_refresh`
- `watch_only`
- `exclude`

Supported intent profiles:

- `citation_check`
- `student_research`
- `developer_adoption`
- `job_search`
- `market_watch`
- `business_due_diligence`
- `medical_literature_triage`

The helper consumes existing `CoreSignalEvaluationResult` fields plus optional Source Profile metadata. It does not change `evaluateSignal`, `evaluateSignals`, `rankSignal`, ranking order, freshness math, utility math, envelopes, provenance, or host behavior.

FreshContext decisions judge citation readiness, context usefulness, freshness, traceability, and uncertainty. They do not certify truth or provide legal, medical, tax, employment, academic, or investment advice.

Demo output will be updated separately so presentation stays separate from Core decision logic.

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

These are pure Core math. They are now connected inside `evaluateSignal` as sidecar utility output, but they are not production-wired into MCP ranking, Worker feeds, Store scoring, or runtime behavior.

## Provenance Helpers

Ha-Pri v2 is available as pure Core helper functionality:

- `canonicalizeHaPriContent`
- `sha256Hex`
- `calculateHaPriV2`
- `verifyHaPriV2`
- `HaPriV2Input`
- `HaPriV2Result`
- `HaPriV2VerificationResult`

`evaluateSignal` can optionally prepare Ha-Pri v2 material when `includeProvenance` is set and required input material is present. Core does not persist provenance, add D1 columns, verify rows on read, reject rows, or replace Worker Ha-Pri v1 behavior.

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
- Hosted dashboard, API, deployment, or runtime concerns

Hosts may wrap Core outputs with their own transport, cache, session, rate-limit, or persistence metadata, but they should not fork the Core envelope and freshness contract without an explicit compatibility reason.


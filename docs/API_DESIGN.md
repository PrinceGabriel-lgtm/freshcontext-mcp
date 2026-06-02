# FreshContext REST API Design

Status: design only

FreshContext REST is a future host around FreshContext Core. It should make the Core pipeline easy to use over HTTP without moving runtime, cache, storage, billing, dashboard, or adapter behavior into Core.

## Purpose

FreshContext turns raw retrieval results into freshness-ranked, provenance-aware context for agents.

The REST host should expose the simplest useful path:

1. User has raw retrieved signals.
2. User sends those signals to FreshContext.
3. Core evaluates freshness, confidence, ranking, explanation, optional envelope, and optional provenance.
4. Host returns ranked context.
5. Agent or app uses best context first.

## Product Spine

```text
raw signals
  -> FreshContext Core evaluation
  -> freshness-ranked, explained, provenance-aware context
  -> agent / app / workflow
```

REST should wrap Core. It should not become a crawler, dashboard, cache, Store, billing system, or Worker replacement.

## Endpoint Table

| Method | Path | Purpose | Core function |
|---|---|---|---|
| POST | `/v1/evaluate` | Evaluate one signal | `evaluateSignal` |
| POST | `/v1/evaluate-batch` | Evaluate and rank multiple signals | `evaluateSignals` |
| POST | `/v1/stamp` | Produce FreshContext envelope text and JSON | `evaluateSignal` with `includeEnvelope: true` |
| GET | `/v1/health` | Return host health/version | host-only |
| GET | `/v1/spec` | Return static spec metadata and docs links | host-only |

## POST /v1/evaluate

Evaluates one signal.

### Request

```json
{
  "signal": {
    "id": "sig_001",
    "source": "https://example.com/article",
    "source_type": "blog",
    "title": "Example retrieved result",
    "content": "Raw retrieved content...",
    "published_at": "2026-05-24T12:00:00.000Z",
    "retrieved_at": "2026-05-24T13:00:00.000Z",
    "semantic_score": 0.84,
    "date_confidence": "high",
    "status": "success",
    "metadata": {
      "query": "browser agents"
    }
  },
  "options": {
    "includeEnvelope": true,
    "includeProvenance": false
  }
}
```

### Response

Shape: `CoreSignalEvaluationResult`.

```json
{
  "signal": {
    "contract_version": "freshcontext.signal.v1",
    "id": "sig_001",
    "source": "https://example.com/article",
    "source_type": "blog",
    "title": "Example retrieved result",
    "content": "Raw retrieved content...",
    "published_at": "2026-05-24T12:00:00.000Z",
    "retrieved_at": "2026-05-24T13:00:00.000Z",
    "semantic_score": 0.84,
    "date_confidence": "high",
    "status": "success",
    "metadata": {
      "query": "browser agents"
    },
    "reasons": []
  },
  "freshness_score": 98,
  "utility": {
    "score": 83.6,
    "contextualRelevance": 84,
    "decayFactor": 0.995,
    "dateConfidenceFactor": 1,
    "statusFactor": 1,
    "lambda": 0.001,
    "ageHours": 1,
    "status": "success",
    "reasons": []
  },
  "ranked": {
    "id": "sig_001",
    "source": "https://example.com/article",
    "source_type": "blog",
    "title": "Example retrieved result",
    "content": "Raw retrieved content...",
    "published_at": "2026-05-24T12:00:00.000Z",
    "retrieved_at": "2026-05-24T13:00:00.000Z",
    "semantic_score": 0.84,
    "date_confidence": "high",
    "status": "success",
    "metadata": {
      "query": "browser agents"
    },
    "freshness_score": 98,
    "final_score": 0.882,
    "confidence": "high",
    "reason": "Strong semantic match and current freshness for blog."
  },
  "explanation": "Strong semantic match and current freshness for blog.",
  "envelope": {
    "context": {},
    "text": "[FRESHCONTEXT]...",
    "structured": {}
  },
  "reasons": []
}
```

The REST host must not fetch upstream data, cache results, write D1, enforce Ha-Pri, or alter ranking policy.

## POST /v1/evaluate-batch

Evaluates and ranks multiple signals.

### Request

```json
{
  "signals": [
    {
      "id": "sig_a",
      "source": "https://example.com/fresh",
      "source_type": "blog",
      "content": "Fresh relevant content...",
      "published_at": "2026-05-24T12:00:00.000Z",
      "retrieved_at": "2026-05-24T13:00:00.000Z",
      "semantic_score": 0.8
    },
    {
      "id": "sig_b",
      "source": "https://example.com/old",
      "source_type": "blog",
      "content": "Older relevant content...",
      "published_at": "2025-01-01T00:00:00.000Z",
      "retrieved_at": "2026-05-24T13:00:00.000Z",
      "semantic_score": 0.9
    }
  ],
  "options": {
    "includeEnvelope": false,
    "includeProvenance": false
  }
}
```

### Response

```json
{
  "evaluations": [
    {
      "signal": {},
      "freshness_score": 98,
      "utility": {},
      "ranked": {
        "final_score": 0.85
      },
      "explanation": "Strong semantic match and current freshness for blog.",
      "reasons": []
    }
  ]
}
```

`evaluate-batch` must use `evaluateSignals`. Ordering follows `ranked.final_score`, with stable tie ordering. `utility.score` is sidecar output and must not be used as default ordering.

The REST host must not fetch upstream data, add host-specific scoring, replace Core ranking, or silently enable utility-weighted ranking.

## POST /v1/stamp

Produces a FreshContext envelope and structured JSON for one result.

### Request

```json
{
  "signal": {
    "source": "https://example.com/source",
    "source_type": "blog",
    "content": "Raw content to wrap...",
    "published_at": "2026-05-24T12:00:00.000Z",
    "retrieved_at": "2026-05-24T13:00:00.000Z",
    "semantic_score": 0.75,
    "date_confidence": "high"
  },
  "options": {
    "envelopeMaxLength": 8000,
    "envelopeFormat": {
      "publishedLabel": "Published",
      "unknownDateText": "Publish date: unknown"
    }
  }
}
```

### Response

```json
{
  "context": {
    "content": "Raw content to wrap...",
    "source_url": "https://example.com/source",
    "content_date": "2026-05-24T12:00:00.000Z",
    "retrieved_at": "2026-05-24T13:00:00.000Z",
    "freshness_confidence": "high",
    "freshness_score": 98,
    "adapter": "blog"
  },
  "text": "[FRESHCONTEXT]...",
  "structured": {
    "freshcontext": {
      "source_url": "https://example.com/source",
      "content_date": "2026-05-24T12:00:00.000Z",
      "retrieved_at": "2026-05-24T13:00:00.000Z",
      "freshness_confidence": "high",
      "freshness_score": 98,
      "adapter": "blog"
    },
    "content": "Raw content to wrap..."
  }
}
```

Implementation should prefer `evaluateSignal(..., { includeEnvelope: true })`.

This endpoint must not become a cache metadata endpoint. Cache status, cache age, TTL, key version, KV/D1 state, and Worker-specific cache metadata belong to hosts that own cache policy.

## GET /v1/health

Returns host health and version metadata.

### Response

```json
{
  "ok": true,
  "service": "freshcontext-rest",
  "version": "0.1.0",
  "core_available": true
}
```

The health endpoint must not expose secrets, tokens, environment values, private diagnostics, Cloudflare internals, or account metadata.

## GET /v1/spec

Returns static spec metadata and documentation links.

### Response

```json
{
  "service": "freshcontext-rest",
  "spec_version": "1.2",
  "signal_contract": "freshcontext.signal.v1",
  "docs": {
    "core_api": "/docs/CORE_API.md",
    "signal_contract": "/docs/SIGNAL_CONTRACT.md",
    "freshcontext_spec": "/FRESHCONTEXT_SPEC.md",
    "methodology": "/METHODOLOGY.md"
  }
}
```

This endpoint must not become a dynamic registry, dashboard, account page, or source catalog.

## Error Shape

REST errors should use one stable JSON shape:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Request body must include signal.",
    "details": []
  }
}
```

Recommended initial codes:

| HTTP | Code | Meaning |
|---:|---|---|
| 400 | `invalid_request` | Missing or malformed JSON/body fields |
| 405 | `method_not_allowed` | Wrong method for endpoint |
| 413 | `payload_too_large` | Request exceeds host limit |
| 415 | `unsupported_media_type` | Non-JSON request body |
| 500 | `internal_error` | Unexpected host error |

Do not encode Core ranking/freshness uncertainty as HTTP errors. Missing timestamps, failed content, low confidence, and omitted provenance are valid evaluation outcomes and should appear in the Core result with reasons.

## REST Non-Goals

The first REST design does not include:

- dashboard
- auth
- tenancy
- billing
- webhooks
- D1 persistence
- cache policy
- feed replacement
- production Ha-Pri enforcement
- utility-weighted ranking
- vector database
- adapter fetching
- crawler/scraper orchestration
- Worker runtime migration

## Host / Core Boundary

Core owns:

- signal normalization
- timestamp/future-date/failure guards
- freshness scoring
- context utility sidecar
- default rank/explain behavior
- optional envelope generation
- optional Ha-Pri v2 material preparation

REST host owns:

- HTTP routing
- JSON parsing and response formatting
- HTTP status codes
- payload size limits
- request IDs/logging policy
- CORS policy if needed
- documentation examples

MCP host owns:

- MCP tool schemas
- reference adapter invocation
- MCP response shape
- client compatibility

Worker runtime owns:

- Cloudflare runtime behavior
- MCP transport
- KV cache policy
- D1/feed/cron/rate limiting
- cache metadata injection

Adapters own:

- fetching
- source-specific parsing
- raw source normalization before Core

Ops Pulse owns:

- runtime diagnostics
- Cloudflare health checks
- operational assays

Trust Scanner owns:

- repo/package/release integrity
- public-claim checks
- trust gate reporting

## Security and Privacy Notes

- Do not log full request bodies by default.
- Do not return environment variables, tokens, API keys, Cloudflare metadata, or private diagnostics.
- Treat submitted content as client data.
- Keep provenance optional and explicit.
- Do not claim Ha-Pri v2 production enforcement unless a future Store/read-time verification path is implemented.
- Do not accept non-JSON request bodies for evaluation endpoints.
- Apply conservative host-level request size limits before invoking Core.

## Tests Needed Before Implementation

Before adding REST route code, add tests for:

- `POST /v1/evaluate` request/response fixtures
- `POST /v1/evaluate-batch` ordering parity with `evaluateSignals`
- invalid JSON and missing body errors
- unsupported content type
- payload-too-large handling
- missing timestamp and future timestamp outcomes
- failed content cannot rank as fresh/high confidence
- envelope opt-in behavior
- provenance opt-in behavior and missing-material reasons
- no cache/D1/fetch side effects
- stable error shape

## Future Expansion

Later phases may add:

- auth
- tenancy
- billing
- dashboard
- webhooks
- D1 persistence
- cache policy
- utility-weighted ranking as an explicit mode
- production Ha-Pri enforcement
- vector database integration
- adapter fetching

Each expansion should be opt-in and separately designed. The first REST host should remain a thin wrapper around Core evaluation.

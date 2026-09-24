# Commercial Host v1 — Build Blueprint

**Status:** scaffold only — not mounted, not deployed, not a public API promise  
**Branch:** `feat/commercial-host-v1`

## Why this exists

FreshContext already has the hard technical primitives: Core evaluation, MCP distribution, REST handlers, D1, signed verdicts, public verification and Cloudflare infrastructure.

This blueprint defines the **minimum commercial state layer** needed when a real customer requires a hosted FreshContext deployment.

It is intentionally not being completed speculatively. The next engineer should build from an actual signed customer scope, not from imagined SaaS requirements.

## Product boundary

FreshContext Core remains the reusable engine.

A commercial host is only one host over Core:

```text
customer workflow
      |
      v
project-scoped API key
      |
      v
POST /v1/evaluate
POST /v1/evaluate-batch
      |
      v
FreshContext Core
      |
      +--> signed verdict / ledger
      |
      +--> per-project usage state
```

MCP remains a separate public host/distribution surface.

## Minimum customer-facing surface

### Required

- `POST /v1/evaluate`
- `POST /v1/evaluate-batch`
- `GET /v1/usage`
- project-scoped API keys
- project identity
- request IDs
- per-project rate limiting
- monthly request quota
- per-project usage accounting
- privacy-safe request log
- association between customer project and retained verdicts/history
- admin/manual key creation and revocation

### Not required for Customer #1

- web dashboard
- self-serve signup
- Stripe checkout
- automatic billing
- organization hierarchy
- SSO
- RBAC beyond simple project credentials
- complex plan catalog
- marketplace
- public SDK split
- SLA automation

A CLI, SQL/admin script or operator-only flow is sufficient for the first customer.

## Current scaffold

`worker/src/commercialHost.ts` contains a deliberately unmounted scaffold for:

- Bearer API-key authentication
- SHA-256 key hashing
- project lookup
- per-project request quota checks
- per-project native rate-limit keying
- request IDs
- monthly request/signal/byte usage accounting
- privacy-safe request logging
- `GET /v1/usage`
- delegation into the existing REST evaluation handler

It is **not wired into worker.ts**, and therefore changes no production behavior.

Do not mount it until the schema, tests, operational key-issuance process and customer scope below are complete.

## Proposed D1 schema

The next implementation should add a reviewed migration with these logical tables.

### `commercial_projects`

- `id TEXT PRIMARY KEY`
- `slug TEXT UNIQUE NOT NULL`
- `name TEXT NOT NULL`
- `status TEXT NOT NULL` — active / suspended / closed
- `monthly_request_limit INTEGER NOT NULL`
- `retention_days INTEGER` — null means contract-specific/default
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

### `commercial_api_keys`

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL`
- `key_hash TEXT UNIQUE NOT NULL`
- `key_prefix TEXT NOT NULL`
- `label TEXT`
- `status TEXT NOT NULL` — active / revoked
- `created_at TEXT NOT NULL`
- `last_used_at TEXT`
- `revoked_at TEXT`

Never store the raw API key after issuance.

### `commercial_usage_monthly`

Composite key: `(project_id, month)`

- `requests INTEGER NOT NULL DEFAULT 0`
- `signals INTEGER NOT NULL DEFAULT 0`
- `bytes_in INTEGER NOT NULL DEFAULT 0`
- `updated_at TEXT NOT NULL`

This is metering evidence, not billing truth by itself.

### `commercial_request_log`

- `id TEXT PRIMARY KEY` — request ID
- `project_id TEXT NOT NULL`
- `api_key_id TEXT NOT NULL`
- `route TEXT NOT NULL`
- `status_code INTEGER NOT NULL`
- `signal_count INTEGER NOT NULL`
- `body_bytes INTEGER NOT NULL`
- `duration_ms INTEGER NOT NULL`
- `created_at TEXT NOT NULL`

Do not store request body/content here.

### Ledger association

Prefer adding a nullable `project_id` to future `evaluation_snapshots` rows or using a separate immutable association table.

Do not mutate historical rows merely to manufacture customer history.

## Authentication contract

Recommended raw key format:

`fc_live_<random secret>`

Requirements:

- at least 256 bits of random secret material
- show raw key only at creation
- store SHA-256 hash only
- support revoke without deleting audit history
- never log Authorization headers
- never return hashes publicly
- use constant-scope project lookup by hash

## Public/private routing

Do **not** make hosted Evaluate anonymous.

Recommended production routing:

- public:
  - `GET /health`
  - `GET /v1/health`
  - `POST /v1/verify`
  - signing-key document
  - MCP surface under its existing policy

- project-authenticated:
  - `POST /v1/evaluate`
  - `POST /v1/evaluate-batch`
  - `GET /v1/usage`

Do not expose admin key/project CRUD on the public Worker in v1. Operate it through an internal admin path, CLI or direct audited D1 tooling.

## Quota semantics

For v1:

- quota unit = accepted HTTP request
- batch request counts as one request plus N signals
- signal count is retained for economics and abuse analysis
- project-level native rate limiting protects burst cost
- monthly quota protects contract economics

Quota checking and accounting should be fail-closed for authenticated hosted Evaluate if D1 quota state cannot be established.

The actual evaluation engine remains deterministic and independent of billing state.

## Privacy/logging

Commercial logs may contain:

- request ID
- project ID
- key ID
- route
- status
- signal count
- body byte size
- duration
- timestamp

Do not log:

- Authorization header
- raw API key
- signal content
- source content
- prompts
- customer secrets

If a customer wants retained raw input/output, make that an explicit contract/data-retention decision rather than a default.

## Required tests before mounting

1. missing auth -> 401
2. malformed auth -> 401
3. revoked key -> 401
4. suspended project -> 401/403 according to chosen contract
5. valid project key -> Evaluate succeeds
6. key A cannot access project B state
7. usage increments only for the authenticated project
8. request body is not present in commercial logs
9. monthly quota -> 429
10. burst limit -> 429
11. `GET /v1/usage` returns only current project
12. malformed JSON still produces the existing REST error contract
13. oversized body remains rejected by existing REST guard
14. batch signal counts are metered correctly
15. production public MCP/verify behavior is unchanged
16. migration is forward-only and does not rewrite historical ledger rows

## Customer #1 activation checklist

Only mount this host after:

- signed SOW exists
- exact target workflow is known
- customer data/privacy assumptions are documented
- project identifier is created
- API key issuance/revocation operator flow exists
- migration is reviewed and applied
- mounted-route integration tests are green
- smoke test runs against staging
- quota and burst numbers reflect the signed engagement
- rollback path is documented

## Deliberate non-goals

This blueprint is **not** a SaaS roadmap.

It is enough infrastructure to turn one paid FreshContext implementation into:

```text
customer
  -> project
  -> authenticated use
  -> evaluations
  -> signed evidence
  -> usage history
  -> accepted deployment
```

That is the first economically useful state.

Build more only when a real customer contract requires more.

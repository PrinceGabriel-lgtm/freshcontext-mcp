# Technical Evidence Index

An index, not a pitch. Each row maps a claim this project makes to the thing you can run or
read to check it. Where a claim is not currently provable, the row says so.

Nothing here is a valuation, a price, or a performance guarantee.

**Package version at time of writing: 0.5.1.** Check it against `package.json`, `server.json`,
and the `version` field returned by `GET /health` — those three should agree, and disagreeing is
itself a finding.

## Evaluation behaviour

| Claim | Where to check it |
| --- | --- |
| Core evaluates candidate context without fetching, crawling or calling adapters | `src/core/pipeline.ts`, `src/core/index.ts`; `tests/corePipeline.test.ts`, `tests/adapterNetworkBoundary.test.ts` |
| `evaluate_context` accepts caller-provided context and is the generic path | `src/tools/evaluateContext.ts`; `tests/evaluateContextTool.test.ts` (17 tests), `tests/evaluateContextSnapshot.test.ts` |
| Freshness scoring is decay over `retrieved_at`, not a wall-clock read | `src/core/decay.ts:52-69`; `tests/mathSpine.test.ts`, `tests/lambdaSingleSource.test.ts` |
| Decisions are explanatory, not truth claims | `src/core/decision.ts`; `tests/decision.test.ts` (28 tests) |
| Source Profiles exist and most of their metadata is declarative rather than load-bearing | `src/core/sourceProfiles.ts`, `docs/SOURCE_PROFILES.md`; `tests/sourceProfiles.test.ts`; benchmark family D |
| The public Core import surface is stable | `docs/CORE_API.md`, `docs/CORE_MCP_BOUNDARY.md`; `tests/coreApiContract.test.ts`, `tests/coreSubpathExport.test.mjs` |
| Evaluation is reproducible at a fixed clock | `docs/CORE_API.md` → "Deterministic Evaluation"; benchmark family E |
| 22 MCP tools = `evaluate_context` + 21 read-only reference adapters | `src/server.ts`, `src/adapters/registry.ts`; enforced by `scripts/smoke-stdio.mjs` and `scripts/trust-scan.mjs` |

## Measured behaviour

| Claim | Where to check it |
| --- | --- |
| The evaluation contract holds against labelled cases | `npm run benchmark:context-integrity` — 9 cases, 41 checks |
| Runs are reproducible | Two runs emit an identical `result_sha256`; asserted by `tests/contextIntegrityBenchmark.test.ts` |
| Methodology and non-claims are stated | `benchmarks/context-integrity-v1/README.md` |
| The harness actually fails when an expectation breaks | Negative-control test in `tests/contextIntegrityBenchmark.test.ts` |
| Downloadable run manifest for a named commit | `Context integrity benchmark` workflow → artifacts |

The benchmark reports a temporal correction rate of **2 of 3** labelled inversion cases. The case
that does not correct is in the fixtures deliberately — see the README. A rate of 3 of 3 would
have required deleting it.

## Signing and independent verification

| Claim | Where to check it |
| --- | --- |
| New verdict rows are Ed25519-signed (`FRESHCONTEXT_HA_PRI_V4`) | `worker/src/ed25519Attestation.ts`, `docs/ED25519_ATTESTATION.md` |
| A third party can verify offline with no account, API key or contact with us | `docs/VERIFYING.md`; `scripts/verify-offline.mjs` (Node stdlib only), `scripts/verify_offline.py` (no dependencies) — both ship in the npm tarball |
| The public key is published | `GET /.well-known/freshcontext-signing-keys.json`; key id also in `worker/wrangler.jsonc` |
| A live production verdict verifies with only the shipped verifiers | `attestation-proof` workflow, daily 07:00 UTC — includes negative controls and a ledger round-trip |
| Legacy records verify through the HMAC path **and report that they did** | `POST /v1/verify` → `verification_method`; `tests/verifyEndpoint.test.ts` |
| Ha-Pri v1 over ingestion rows is a provenance stamp, **not** authentication | `RISKS.md` → D-1; `worker/src/intelligence.ts:207` |
| Ha-Pri v2 stored-signal enforcement is **not live** | `docs/HA_PRI_V2_DESIGN.md`, `docs/HA_PRI_V2_PRODUCTION_ENFORCEMENT_PLAN.md`; enforced as a claim rule in `scripts/trust-scan.mjs` |
| A verdict row stores a content hash, never the content | `canonical_content_sha256` in `worker/migrations/0001_evaluation_snapshots.sql`; `src/core/provenance.ts:92` hashes before signing |

## Release and supply chain

| Claim | Where to check it |
| --- | --- |
| Claims are scanned, and exceptions are reviewed rather than silenced | `npm run trust:gate` / `npm run trust:scan`; `config/trust-scan-allowlist.json` |
| Dependency and licence posture | `docs/DEPENDENCY_DILIGENCE.md` — transfer inventory 2026-09-13 |
| No copyleft in either production tree | Same document; verified against an explicit permissive allowlist, not by reading summary counts |
| The npm tarball carries no internal material | `verify.yml` → "Check the npm tarball carries no internal material"; `npm pack --dry-run` |
| The Worker bundle carries no browser-download path | `verify.yml` → bundle check |
| Licence is MIT across root, worker and notice | `LICENSE`, `package.json`, `worker/package.json`, `NOTICE.md` |

**On the scanner, stated precisely:** 130 raw findings were reviewed; 42 rule/file-scoped
exceptions were documented with reasons; 0 unallowed findings remain. The allowlist is scoped by
rule **and file, not by line**, so it is broader than line-level suppression — a future matching
claim in one of those files would be suppressed by that rule. GitGuardian runs in CI and is the
actual secret scanner for that case. This caveat is written into the allowlist file itself.

## Deployment surface

| Claim | Where to check it |
| --- | --- |
| Production Worker deploys from `main` with a smoke test and automatic rollback | `verify.yml` → `Deploy Worker to production` |
| Published schema resolves at its own `$id` | `https://freshcontext.dev/freshcontext.schema.json`; mirror drift checked in CI |
| Specification is published and MIT-licensed | `FRESHCONTEXT_SPEC.md` |
| **The canonical hostname serves this Worker** | `canonical-endpoint-proof` workflow — passing; daily 07:30 UTC |

### Resolved 2026-09-13: Bot Fight Mode was challenging the canonical hostname

Kept in full rather than deleted. An evidence index that only records what currently passes
says nothing about whether the controls work; this row says they do.

**2026-09-13** — the canonical-host proof detected Cloudflare Bot Fight Mode challenging
programmatic traffic to the published MCP endpoint. Signing-key discovery remained publicly
accessible throughout. Edge policy was corrected and the canonical endpoint proof
subsequently passed.

**What was found.** The proof failed on its first real run. Every refusal carried
`cf-mitigated: challenge`, `server: cloudflare`, and a `Just a moment...` body — a managed
challenge, not a WAF block (Error 1020 body), not Access (redirect), not rate limiting (429).
A browser User-Agent did not help, because the challenge requires executing JavaScript, so no
API client could satisfy it however it identified itself.

| Path | Before | After |
| --- | --- | --- |
| `/health` | 403 challenge | **200**, `status: ok`, version 0.5.1 |
| `/v1/health` | 403 challenge | **200**, `ok: true` |
| `/mcp` | 403 challenge | reachable |
| `/` | 403 challenge | reachable |
| `/.well-known/freshcontext-signing-keys.json` | **200 throughout** | **200**, publishes `fc-2026-09-ceced1ab`, status `active` |

**Blast radius.** `/mcp` — the endpoint `server.json` publishes to MCP registry clients —
plus the health endpoints. Offline verification was never affected: the key document answered
default clients throughout, so `docs/VERIFYING.md` held for the whole period.

**Why the obvious fix would not have worked.** Bot Fight Mode cannot be skipped by a WAF
custom rule; it does not run on the Ruleset Engine, so `Skip`, `Bypass` and `Allow` have no
effect on it, and JavaScript Detections is force-enabled. A path-scoped skip rule would have
been time spent on something that cannot work. The resolution was to turn Bot Fight Mode off
for the zone. Super Bot Fight Mode, which does run on the Ruleset Engine and accepts a `Skip`
rule scoped to `http.host eq "api.freshcontext.dev"`, remains the option if bot protection is
wanted on the marketing surface later.

**A second defect, found by the same run.** Once the domain started answering, the
key-document check failed against a healthy document: it filtered on `public_key`, while
`PublishedSigningKey` publishes `public_key_spki_b64`. The bug was latent — earlier runs never
reached that step — and would have misreported precisely when the check began to matter. Fixed,
and the check now also asserts the published key is `active` rather than merely present.

**Sequence, verifiable in the Actions history:** canonical-host blind spot identified →
independent scheduled proof added (#80) → proof detected a real edge-layer misconfiguration
within the hour → cause established from response fingerprints → configuration corrected →
proof green. Runs `34762222085` (failed, `main`), `34763598811` (diagnosed), `34764389414`
(edge fixed, check bug surfaced), `34764444855` (**green**).

## What this index does not prove

- **That FreshContext determines truth.** It does not. A verdict describes how context was
  treated and why.
- **That the benchmark generalises.** It runs authored fixtures, not sampled traffic. Its rates
  describe those fixtures and carry no statistical significance.
- **Any capacity, throughput or latency guarantee.** The only performance figure here is a local
  Core microbenchmark, and there is no SLA anywhere in this project.
- **That every risk is known.** `RISKS.md` lists what has been found, including items marked
  verified once and not since.
- **Fitness for a particular purpose, or any compliance or certification status.** No
  certification is claimed and none has been sought.

Verify the rows rather than the summary. Anything in this file that cannot be reproduced from the
linked artifact should be treated as the error it is, and reported to `security@freshcontext.dev`
or as a public issue.

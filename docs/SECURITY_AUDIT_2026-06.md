# FreshContext Local Security Audit - June 2026

Date: 2026-06-11

Audit type: local pre-release security review

This is a source-checkout audit of FreshContext. It is not an external audit, formal assurance program, or claim that the system is impossible to alter. The review covers the public npm package boundary, local MCP host, batch validation tooling, reference adapters, Worker source, provenance helpers, Trust Scanner output, and release workflow safety.

## Scope

In scope:

- root package dependencies and package-lock state
- npm package dry-run contents
- secret-shaped pattern scan results
- package scripts and source-checkout helper scripts
- Signal Contract v1 batch validation harness
- `evaluate_context` MCP input surface
- reference adapter input and fetch boundaries
- local REST handler method/body guards
- Worker route, debug, auth, cache, D1, and method surface by source review
- Ha-Pri v1/v2 provenance wording and helper boundary
- Trust Scanner gate output
- GitHub publish workflow release safety

Out of scope:

- external penetration testing
- production Worker deployment
- npm publish
- version bump
- new adapters or new MCP tools
- Operator/retrieve orchestration
- Ha-Pri v2 Worker/D1 enforcement
- dashboard, billing, or hosted SaaS surfaces

## Commands Run

Core validation:

```powershell
git status --short --branch
git log --oneline -8
npm run build
npm test
npm run smoke:stdio
npm run trust:gate
npm audit --omit=dev
npm audit
npm pack --dry-run --json
git diff --check
```

Batch fixture validation:

```powershell
npm run batch:validate -- examples/batches/signal-contract-v1.academic.json
npm run batch:validate -- examples/batches/signal-contract-v1.official-docs.json
npm run batch:validate -- examples/batches/signal-contract-v1.rag-vendors.json
npm run batch:validate -- examples/batches/signal-contract-v1.jobs.json
npm run batch:validate -- examples/batches/signal-contract-v1.mixed-agent-handoff.json
```

Worker validation:

```powershell
cd worker
npm audit --omit=dev
npm audit
npx tsc --noEmit
npx wrangler deploy --dry-run
```

Manual/static review included targeted searches over scripts, adapters, MCP registration, REST handler, Worker routes, provenance helpers, package metadata, docs, and workflow files.

## Validation Summary

| Gate | Result |
| --- | --- |
| Root build | Passed |
| Root tests | Passed, 206/206 |
| MCP smoke | Passed, 22 tools, version 0.3.19 |
| Trust gate | Passed, effective fail 0 |
| Root production audit | 0 vulnerabilities |
| Root full audit | 0 vulnerabilities |
| Package dry-run | 58 files, expected runtime/docs surface |
| Batch fixtures | All 5 fixtures passed |
| Worker production audit | 0 vulnerabilities |
| Worker full audit | 0 vulnerabilities |
| Worker typecheck | Passed |
| Wrangler dry-run | Passed |

Package dry-run includes expected public/runtime files such as `dist/server.js`, `dist/tools/evaluateContext.js`, README, LICENSE, SECURITY, server metadata, and selected public docs. It does not include `dist/apify.js`, tests, examples, worker source, archive folders, evidence folders, videos, screenshots, or private data-room material.

## Findings

| ID | Severity | Surface | Status | Action |
| --- | --- | --- | --- | --- |
| SEC-2026-06-01 | low | `evaluate_context` MCP input | fixed | Added explicit limits: max 100 signals, max source/title/content lengths, and invalid `now` rejection. Added regression tests. |
| SEC-2026-06-02 | low | Source-checkout batch harness | fixed | Added file guard for regular files only, 1 MiB max batch file size, max 500 signals, and source/title/content length limits. Added regression tests. |
| SEC-2026-06-03 | medium | arXiv direct URL fetch path | fixed | Direct arXiv URLs now pass through the shared domain/private-address validator. Allowed direct URLs are limited to arXiv domains. Added regression test proving non-arXiv and private direct URLs reject before fetch. Mirrored the allowlist in Worker source. |
| SEC-2026-06-04 | low | GitHub publish workflow | fixed | Updated workflow from Node 18 to Node 20 to match package engines and removed `continue-on-error` from npm publish so release failures are visible. |
| SEC-2026-06-05 | info | npm package boundary | accepted_risk | `.env.example` ships intentionally as a placeholder-only template. Package gate confirms no fail-level package boundary issue. |
| SEC-2026-06-06 | info | Secret pattern scan | accepted_risk | Matches are placeholder env names, workflow secret references, Trust Scanner rules/tests, and Worker binding names. No live secret value was identified in this audit. |
| SEC-2026-06-07 | info | Trust Scanner warnings | accepted_risk | Remaining warnings are archive/history, scanner fixtures, tests, config metadata, or known review items. Effective fail remains 0. |
| SEC-2026-06-08 | low | Source-checkout package script guard | fixed_in_12_B | `package-script-guard.mjs` now resolves local package binaries and uses no-shell spawning, including on Windows. Pass-through arguments reject null bytes. Added regression tests. |
| SEC-2026-06-09 | low | Worker debug routes | fixed_in_12_B | `/health`, `/debug/db`, and `/debug/scrape` now have explicit method guards. Debug scrape failures return a generic JSON error while detailed errors remain in structured logs. Added regression tests. |
| SEC-2026-06-10 | low | Reference adapter network surface | fixed_in_12_B | arXiv, Reddit, and broad changelog direct URL paths now pass through shared URL validation where applicable. Public URL support remains, but private/internal addresses and non-http protocols are blocked. Added regression tests. |
| SEC-2026-06-11 | info | Ha-Pri v2 provenance boundary | accepted_risk | Core helpers provide deterministic SHA-256 provenance vectors only. Docs correctly avoid production-enforced, absolute integrity, origin-authenticated, or externally audited claims. HMAC/private-key signing remains future work. |

## Safe Hardening Applied

`evaluate_context` now has explicit caller-provided context limits:

- at most 100 candidate signals
- source string at most 2048 characters
- title string at most 1000 characters
- content string at most 50000 characters
- optional `now` must parse as a valid timestamp

The source-checkout batch harness now has explicit validation limits:

- input path must be a regular file
- file size at most 1 MiB
- at most 500 candidate signals
- source string at most 2048 characters
- title string at most 1000 characters
- content string at most 100000 characters

The arXiv adapter direct URL path now uses the shared URL validator. Query strings still build the official arXiv API URL as before. Direct URLs must resolve to `arxiv.org` or `export.arxiv.org` and still pass protocol/private-address checks.

The GitHub publish workflow now uses Node 20 and fails visibly if npm publish fails.

## Pass 12-B Hardening Applied

Pass 12-B closed the deferred implementation items from this audit without adding product features.

- The package script guard now uses no-shell child process execution and resolves local package binaries before falling back to platform commands.
- Pass-through script arguments reject null bytes before process spawning.
- `/health` only allows `GET` and `HEAD`; debug routes only allow `GET`.
- Debug scrape failure responses no longer return raw exception messages to callers.
- Reddit direct URLs are limited to Reddit domains and still block private/internal addresses.
- Broad changelog URL discovery still supports public URLs, but now blocks private/internal addresses before browser discovery.
- Core FreshContext envelopes clamp stamped adapter content to a maximum of 20000 characters before text is returned to the model-facing host.

## Remaining Security Notes

The public npm package is MIT-licensed and can be forked. That is not a data-access risk by itself because the package should remain stateless and should not contain secrets or private user data. Protectable surfaces are hosted data, deploy secrets, account credentials, private commercial materials, trademarks, and any future hosted/proprietary layer.

Future hosted deployments should use explicit bearer/OAuth-style authentication for any endpoint that reads or writes user-specific data. The public MCP discovery path can remain read-only and unauthenticated only if it never exposes private D1/KV data and remains rate-limited.

## Non-Goals Confirmed

This pass did not:

- deploy the Worker
- publish npm
- bump package version
- add a new MCP tool
- add a new adapter
- change ranking/scoring policy
- implement Operator/retrieve
- implement Ha-Pri v2 Worker/D1 enforcement
- claim external audit or formal security assurance

## Final Gate Summary

FreshContext is in better pre-release security shape after Pass 12-A and Pass 12-B. The local MCP package, validation tooling, Worker debug routes, and selected network adapter boundaries now have explicit guardrails where the audit found low-risk gaps. Root and Worker dependency audits are clean, package dry-run contents remain bounded, Trust Scanner effective fail remains 0, and no live secret was identified by the local scan.

Release should still use a final release-decision gate before npm publish or Worker deploy, but the deferred Pass 12-B security items are closed.

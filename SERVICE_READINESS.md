# Service Readiness

What each commercial service can actually do today, stated against the repository
rather than against the website.

Every row here was verified by running the code on the commit this file ships
with. Where something is not exposed, this document says so rather than rounding
up — a buyer's technical reviewer will check, and the answer should survive that.

**Verified at:** `package.json` 0.5.2 · `packages/core` 0.5.2 · `server.json` 0.5.2 ·
npm `latest` 0.5.2 — all four agree, so no version claim here is stale.

## Capability classification

| Capability | Status | Evidence |
|---|---|---|
| Core evaluation engine | `LIVE_PRODUCTION` | Shipped in the package; exercised by the full suite |
| `evaluate_context` | `LIVE_PRODUCTION` | Generic caller-provided evaluation |
| Source Profiles, freshness, provenance, confidence, decisions | `LIVE_PRODUCTION` | Core, covered by the suite |
| MCP interface | `LIVE_REFERENCE_INTERFACE` | `/mcp` is in the Worker allow-route list |
| Signed verdicts, verdict identity, ledger | `LIVE_PRODUCTION` | Ed25519 path in production |
| Offline verification | `LIVE_PRODUCTION` | `scripts/verify-offline.mjs`, `scripts/verify_offline.py`, both shipped |
| `GET /v1/health`, `GET /v1/verify` | `LIVE_PRODUCTION` | Present in `isAllowedRoute` |
| `POST /v1/evaluate` | `TESTED_NOT_EXPOSED` | Implemented `src/rest/handler.ts`; **absent from `isAllowedRoute`** — 404s at the gate |
| `POST /v1/evaluate-batch` | `TESTED_NOT_EXPOSED` | Same boundary |
| Enforcement wrapper | `EXECUTABLE_SOURCE_TOOL` | Repo-level; verify distribution before selling as an installed dependency |
| Batch validation harness | `EXECUTABLE_SOURCE_TOOL` | Source checkout only |
| Service kits (all four) | `EXECUTABLE_SOURCE_TOOL` | `service-kits/`, deliberately absent from `package.json` `files[]` |
| Managed tenancy / accounts | `NOT_PRESENT` | — |
| Billing or admin dashboard | `NOT_PRESENT` | — |
| SSO / SCIM | `NOT_PRESENT` | — |
| Formal SLA system | `NOT_PRESENT` | — |
| Compliance certification | `NOT_PRESENT` | — |

**The evaluate boundary matters.** `src/rest/handler.ts` routes both evaluate
paths, and `worker/src/worker.ts` deliberately omits them from `isAllowedRoute`,
so a call 404s before reaching the engine. The correct public statement is
*"implemented and tested, not publicly exposed."* Not *"we have a hosted REST
API."*

## The four services

### 1. Context Integrity Assessment — sellable now

| | |
|---|---|
| **Primitive** | Core evaluation via `evaluateWorkflow()` in `service-kits/common.ts` |
| **Command** | `npm run service:assessment -- <input.json> [output-dir]` |
| **Client provides** | Representative candidate contexts with source, type, timestamps, retrieval status |
| **Produces** | `assessment-evidence.json` (`schema`, `generated_at`, `application_ref`, `client`, `workflow`, `findings`, `limitations`) and `assessment-evidence.md` |
| **Acceptance** | Evidence generated and walked through; interpretation is founder-led |
| **Founder-led** | Fit Map, Failure-Mode Register, Recommended Integration Point, Dependency List, Implementation Estimate, Walkthrough |
| **Machine-generated** | Sample Evaluation Evidence only |

The runner produces technical evidence and flags. It does **not** generate
business conclusions, and must not be presented as if it had.

### 2. Single-Workflow Integration — sellable now, bounded scope

| | |
|---|---|
| **Primitive** | Same engine, driven by a declared scenario contract |
| **Command** | `npm run service:acceptance -- <suite.json> [output-dir]` |
| **Client provides** | Workflow id, profile, intent, fixtures, expected outcomes per scenario |
| **Produces** | `acceptance-evidence.json` (`passed`, `total`, `pass`, per-scenario `scenarios[]`) and `.md` |
| **Acceptance** | **PASS/FAIL per scenario; the runner exits non-zero if any scenario fails** |

That exit code is the contractual mechanism. It is pinned by
`tests/serviceKits.test.ts` — *"acceptance runner exits non-zero when a
contracted scenario fails"* — which inverts a scenario's expectation and asserts
the runner refuses to report success.

**Do not sell as:** universal plug-and-play middleware · a managed hosted REST
product · a guarantee that answers improve.

### 3. Private / Multi-Workflow Implementation — sellable as an implementation service

| | |
|---|---|
| **Primitive** | Independent per-workflow evaluation, aggregated |
| **Command** | `npm run service:multi -- <manifest.json> [output-dir]` |
| **Produces** | `multi-workflow-evidence.json` (`summary`, per-workflow `workflows[]`, `limitations`) and `.md` |
| **Acceptance** | Per-workflow evidence plus aggregate; optional acceptance suites per workflow |

Each workflow keeps its own profile, intent and configuration; cross-workflow
differences are reported rather than averaged.

**This is not multi-tenancy.** It is the capability to implement several client
workflows. Do not describe it as SaaS tenancy, a hosted control plane, SSO,
enterprise administration, or an SLA-backed platform.

### 4. Build-to-Spec — sellable as custom engineering

| | |
|---|---|
| **Primitive** | Governed specification intake and validation |
| **Command** | `npm run service:spec -- <spec.json> [output-dir]` |
| **Requires** | Capability, problem statement, environment, milestones, deliverables per milestone, acceptance tests with `input_or_fixture` and `expected_observable_result` |
| **Produces** | `build-spec.json` (normalized spec, `milestones`, `validation_warnings`) and `build-spec.md` |
| **Rejects** | Missing capability, problem statement, environment, milestones, deliverables, acceptance tests; duplicate milestone or test ids |
| **Warns** | Unfalsifiable acceptance wording; missing Background IP notes; missing client-specific deliverables |

The product is the governed process, not the buyer's feature. Do not claim the
requested capability exists until it does.

Unfalsifiable wording is judged on `expected_observable_result` — the
contractual field — and only when nothing observable accompanies it. A number, a
boolean, a `snake_case` field, a comparison operator or an exit code all make a
statement checkable. FreshContext's own verdict vocabulary is not treated as
vague: *"reported as not safe for agent handoff"* is a binary criterion and
passes clean.

## What is manual, for every service

Qualification · scope and quote · contract and payment · client-data handling ·
interpretation of evidence · the walkthrough · acceptance sign-off · closeout.
These live in the private commercial workspace, not in this repository.

## Limitations that apply to all four

- The runners are **source-checkout tooling**, not hosted endpoints. They are not
  in the npm tarball, and the package-script guard makes them no-op in an
  installed package.
- Client evidence is written to `service-output/`, which is gitignored and
  asserted to be so by test.
- There is no managed account, dashboard, SSO, SLA or compliance certification.
- FreshContext evaluates context integrity — freshness, provenance, confidence,
  handoff readiness. It does **not** certify that any statement is factually true.

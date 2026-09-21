# Claims Matrix

Every material public or commercial claim, classified against the repository.

A claim belongs here before it appears on the website, in a Service Order, or in
a sales conversation. If it is not in this table, it has not been checked.

| Class | Meaning |
|---|---|
| `LIVE` | Running in production and reachable |
| `TESTED_NOT_PUBLIC` | Implemented and covered by tests; deliberately not exposed |
| `SERVICE_DELIVERABLE` | Real, delivered by a person running the tooling in an engagement |
| `PLANNED` | Intended, not built |
| `UNSUPPORTED` | Must not be claimed in any form |

## Technical claims

| Claim | Class | Basis |
|---|---|---|
| FreshContext evaluates context freshness, provenance and confidence | `LIVE` | Core, in the package and the suite |
| Generic caller-provided context evaluation (`evaluate_context`) | `LIVE` | Core + MCP |
| MCP interface available | `LIVE` | `/mcp` in the Worker allow-route list |
| Verdicts are cryptographically signed | `LIVE` | Ed25519 production path |
| Anyone can verify a verdict offline, without trusting our server | `LIVE` | Shipped `verify-offline.mjs` / `verify_offline.py` |
| Server-side verification endpoint | `LIVE` | `GET /v1/verify` |
| Health endpoint | `LIVE` | `GET /v1/health` |
| REST evaluate and evaluate-batch exist | `TESTED_NOT_PUBLIC` | `src/rest/handler.ts`; absent from `isAllowedRoute` |
| **"We have a hosted REST evaluate API"** | `UNSUPPORTED` | The route 404s at the gate. Say *"implemented and tested, not publicly exposed."* |
| Enforcement wrapper | `TESTED_NOT_PUBLIC` | Repo-level; confirm distribution before calling it an installable dependency |
| Batch validation harness | `TESTED_NOT_PUBLIC` | Source checkout |

## Service claims

| Claim | Class | Basis |
|---|---|---|
| Context Integrity Assessment | `SERVICE_DELIVERABLE` | `service:assessment`, verified executable |
| Single-Workflow Integration | `SERVICE_DELIVERABLE` | `service:acceptance`, bounded scope |
| Private / Multi-Workflow Implementation | `SERVICE_DELIVERABLE` | `service:multi`; an implementation service, not tenancy |
| Build-to-Spec Implementation | `SERVICE_DELIVERABLE` | `service:spec`; governed process, not a prebuilt feature |
| Acceptance is objective and machine-checked | `SERVICE_DELIVERABLE` | Non-zero exit on failure, pinned by test |
| Evidence is reproducible from the client's own fixtures | `SERVICE_DELIVERABLE` | Same engine, same inputs, deterministic `now` |

## Claims that must not be made

| Claim | Class |
|---|---|
| Multi-tenant SaaS / managed customer accounts | `UNSUPPORTED` |
| Admin console or billing dashboard | `UNSUPPORTED` |
| SSO or SCIM | `UNSUPPORTED` |
| Formal SLA, uptime guarantee or response-time commitment | `UNSUPPORTED` |
| Compliance certification (SOC 2, ISO, HIPAA, GDPR certification) | `UNSUPPORTED` |
| FreshContext certifies that a statement is factually true | `UNSUPPORTED` |
| A named customer, case study or reference | `UNSUPPORTED` — none exist |
| `/sample-assessment` is customer proof | `UNSUPPORTED` — it is an illustrative worked sample |
| Guaranteed improvement in answer quality or accuracy | `UNSUPPORTED` |
| Plug-and-play middleware requiring no integration work | `UNSUPPORTED` |

## Website audit

`freshcontext-site` audited against this matrix at `35752ed`. Method: strip
markup from every `*.html` page, then search the prose for each term in the
"must not be made" list above, and separately for any advertised `/v1/` endpoint.

**Result: no violations.** Every occurrence of a sensitive term is a disclaimer
rather than a claim —

- `sample-assessment.html` — "Worked sample · not a client case study", and
  "not included: SLA, SSO, compliance certification, truth verification"
- `terms.html` — "without warranty of any kind, without a service level
  commitment, and without a guaranteed response time"
- `integration.html` — "does not certify truth, guarantee business outcomes, or
  replace legal/compliance/model-risk governance"

The only endpoint the site advertises is **`/v1/verify`**, which is in
`isAllowedRoute`. No page claims `/v1/evaluate` or `/v1/evaluate-batch`.

Re-run this audit whenever a page changes or a row above moves class.

## What FreshContext actually asserts

It evaluates **context integrity** — how fresh a source is, how well its
provenance is established, how confident that judgement is, and whether the
result is safe to hand to an agent.

It does **not** assert that content is true. A well-provenanced recent document
containing a false statement is a high-integrity context and a false claim, and
FreshContext will say the first thing and nothing about the second.

## One reading hazard to disclose in every deliverable

`safe_for_agent_handoff: true` can appear next to content that is years old.
That is correct behaviour: a document whose age is **known and labelled**
(`use_as_background`, high date confidence) is safe to hand on, because the agent
receives the age along with it. The state the engine blocks is *unknown*, not
*old* — an undateable source comes back handoff-unsafe while an openly 2019 one
does not.

A buyer skim-reading the evidence will not infer that. Any deliverable
containing that field must state what it means, or the client will read
"handoff-safe" as "current."

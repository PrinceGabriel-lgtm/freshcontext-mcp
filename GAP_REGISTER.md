# Gap Register

Open gaps between what FreshContext does and what the commercial layer needs.
Each entry says what would close it, so none of them becomes an implicit promise.

| Class | Meaning |
|---|---|
| `CORE_DEFECT` | The engine is wrong |
| `DELIVERY_IMPROVEMENT` | Delivery is harder or riskier than it needs to be |
| `ENTERPRISE_FEATURE` | Real work, not required for the first clients |
| `BUYER_SPECIFIC` | Only build it when a buyer pays for it |
| `FUTURE_R&D` | Unproven |
| `LEGAL_REVIEW_REQUIRED` | Stop; a person with authority decides |

## CORE_DEFECT

None open. The suite is 446/446 on this commit and the trust gate is clean.

## DELIVERY_IMPROVEMENT

Closed in this pass:

| # | Gap | How it was closed |
|---|---|---|
| ~~D-1~~ | `safe_for_agent_handoff` was misreadable by a buyer | Assessment and multi-workflow evidence now carry `field_meanings`, and the human-readable report has a **How to read these fields** section stating that the field is not a claim the content is current. Asserted by test in both formats. |
| ~~D-3~~ | Assessment evidence was not proven deterministic | A test runs one fixture twice and compares both outputs, excluding only `generated_at`. Reproducibility is sold; it is now checked. |
| ~~D-5~~ | Multi-workflow isolation was a property of how the runner happened to be written | A test evaluates one identical signal through two deliberately conflicting profiles and asserts each workflow's items and summary match the same workflow evaluated alone. |

Still open:

| # | Gap | Closure |
|---|---|---|
| D-2 | **No input schema.** The four runners validate imperatively; a malformed client fixture fails with an ad-hoc message. | Publish a JSON Schema per service and validate against it, so an intake error is a precise statement rather than a stack trace. |
| D-4 | **No acceptance-suite starter pack.** SOP-006 names five scenario families; each engagement re-derives them. | Ship a template suite covering recent / stale / weak-dating / weak-provenance / failed-source, as a starting point to adapt. |

## ENTERPRISE_FEATURE

| # | Gap |
|---|---|
| E-1 | Managed tenancy, customer accounts, per-tenant isolation |
| E-2 | Billing and admin dashboard |
| E-3 | SSO / SCIM |
| E-4 | Formal SLA with measured uptime and response commitments |
| E-5 | Public hosted REST evaluate — code exists; exposing it is a security and product decision, not a deployment step |

None of these may be sold, implied or scheduled until separately built.

## BUYER_SPECIFIC

| # | Gap |
|---|---|
| B-1 | Any capability named in a Build-to-Spec engagement. It does not exist until the milestone is accepted, and must not be described as existing. |
| B-2 | Client-specific adapters for private or authenticated sources |
| B-3 | Deployment into a client-controlled environment |

## FUTURE_R&D

| # | Gap |
|---|---|
| F-1 | Automated Fit Map generation. Currently founder-led, deliberately — the runner produces evidence and flags, and turning those into a business recommendation is judgement the tool should not fake. |
| F-2 | Cross-engagement benchmarking of context-integrity outcomes |

## LEGAL_REVIEW_REQUIRED

Stop and escalate; do not resolve these in code or in generated documents.

| # | Question |
|---|---|
| L-1 | Governing law and jurisdiction for Service Orders |
| L-2 | Tax / VAT treatment for cross-border delivery |
| L-3 | Liability caps and their interaction with the quoted fee |
| L-4 | Warranty language — what, if anything, is warranted beyond the acceptance tests |
| L-5 | Confidentiality terms for client fixtures and evidence |
| L-6 | Background IP vs client-specific deliverable boundary, per engagement |
| L-7 | Regulated or personal data in client fixtures (health, financial, biometric) |
| L-8 | Export control, where a client is in a restricted jurisdiction |
| L-9 | Whether historical MIT-released versions constrain any commercial term |

Generated commercial documents must not create ownership transfer, assignment,
exclusivity, a broad future licence, a guarantee, an SLA or a compliance
warranty. Where a document would, it stops and is marked
`LEGAL_REVIEW_REQUIRED`.

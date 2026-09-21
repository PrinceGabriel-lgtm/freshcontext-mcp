# FreshContext Service Execution Kit

This directory makes the commercial service claims mechanically reproducible from the same Core that powers FreshContext.

It is **source-checkout tooling**, not a second SaaS product, CRM, billing system, or enterprise control plane.

## What is actually live vs. what this kit adds

| Capability | Status |
|---|---|
| Core context evaluation | live in the package |
| `evaluate_context` MCP path | live in npm/local MCP and on the deployed MCP host |
| Signed verdict / verification path | live; public verification endpoint and offline verification artifacts exist |
| Reference adapters | live as MCP/reference surfaces |
| Context Integrity Assessment evidence generation | executable in source checkout via this kit |
| Single-workflow acceptance evidence | executable in source checkout via this kit |
| Multi-workflow evidence aggregation | executable in source checkout via this kit |
| Build-to-Spec acceptance/spec discipline | executable specification validator via this kit |
| Public hosted REST `/v1/evaluate` or `/v1/evaluate-batch` | **not live**; handler code exists but production intentionally does not mount those routes |
| Managed tenancy / billing / dashboard | not live |
| SSO / SCIM / formal SLA / compliance certification | not live |
| A pre-built buyer-specific Build-to-Spec capability | not applicable; that service is custom engineering against an approved specification |

## Commands

### 1. Context Integrity Assessment

```bash
npm run service:assessment -- service-kits/examples/assessment.example.json
```

Outputs:
- `assessment-evidence.json`
- `assessment-evidence.md`

This is evidence generation. A human engagement owner still produces the client-facing Fit Map, implementation estimate, and recommendation.

### 2. Single-Workflow Acceptance

```bash
npm run service:acceptance -- service-kits/examples/acceptance.example.json
```

Outputs:
- `acceptance-evidence.json`
- `acceptance-evidence.md`

Exit code is non-zero when any encoded acceptance scenario fails, so the same file can be used in CI or a client handover test.

### 3. Private / Multi-Workflow Evidence

```bash
npm run service:multi -- service-kits/examples/multi-workflow.example.json
```

Outputs:
- `multi-workflow-evidence.json`
- `multi-workflow-evidence.md`

This proves repeatable evaluation across multiple explicitly configured workflows. It does **not** claim tenancy, managed operations, SSO, SLA, or compliance.

### 4. Build-to-Spec Specification

```bash
npm run service:spec -- service-kits/examples/build-spec.example.json
```

Outputs:
- `build-spec.json`
- `build-spec.md`

The validator requires milestones and observable acceptance tests. It warns about subjective acceptance wording and missing Background-IP/client-deliverable schedules.

## Evidence boundary

Every service output is derived from the same evaluation primitives as the product. That makes the service repeatable and testable.

FreshContext still does not certify truth, compliance, model safety, or business outcomes.

## Commercial boundary

Pricing, client names, signed contracts, invoices, payment evidence, private credentials, and client production data do not belong in this public repository. Keep those in the private commercial operations system.

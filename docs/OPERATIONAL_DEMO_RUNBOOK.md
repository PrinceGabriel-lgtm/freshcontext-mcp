# FreshContext Operational Demo Runbook

This runbook is for a live call, screen share, buyer demo, agent-builder conversation, or handoff where you need to show what FreshContext can do today.

It is intentionally practical. It does not describe future Operator mode as if it already exists.

## The Short Explanation

FreshContext is a context gateway between retrieval and reasoning.

```text
Raw candidate context goes in.
FreshContext evaluates freshness, usefulness, traceability, and uncertainty.
Decision-ready context comes out.
```

Use this sentence when someone asks what it is:

```text
FreshContext tells an agent or human whether a source should be used, cited, refreshed, verified, watched, treated as background, or excluded.
```

Use this sentence when someone asks why it matters:

```text
Search and retrieval find matching information; FreshContext decides what context deserves to reach the model first.
```

## Current Operational Shape

FreshContext has four working lanes today:

| Lane | What It Does Today | Demo Status |
|---|---|---|
| Core | Normalizes signals, scores freshness, ranks, explains, prepares envelopes/provenance, and interprets decisions | Working |
| MCP package | Exposes 21 reference tools to MCP clients over stdio | Working |
| BYOC local demos | Lets a user provide JSON source lists and get decision-first output | Working |
| arXiv signal proof | Shows extracted adapter signals flowing into Core decisions | Working |

Two companion systems support operational trust:

| Companion | Role |
|---|---|
| Trust Scanner | Checks package, release, public-claim, and integrity risk |
| Ops Pulse | Checks Cloudflare/runtime/D1/cron/observability health for deployed systems |

## What FreshContext Is Not Yet

Do not overclaim these in a live talk:

- It is not full Operator mode yet.
- It does not crawl the web by itself in the BYOC demo.
- It does not silently read local folders.
- It does not replace legal, medical, tax, employment, academic, or investment review.
- It does not production-enforce Ha-Pri v2 yet.
- It does not make `utility.score` replace default ranking.
- It does not require publishing or deploying to demonstrate the current local flow.

## Screen-Share Prep

Open two terminals:

1. FreshContext MCP repo:

```powershell
cd "C:\Users\Immanuel Gabriel\Downloads\freshcontext-mcp"
```

2. Ops Pulse repo:

```powershell
cd "C:\Users\Immanuel Gabriel\Downloads\freshcontext-ops-pulse"
```

Optional files to open beside the terminal:

- `README.md`
- `docs/OPERATIONAL_DEMO_RUNBOOK.md`
- `examples/sources.academic.example.json`
- `examples/sources.jobs.example.json`
- `docs/SOURCE_PROFILES.md`
- `docs/CORE_API.md`

## Preflight Before A Call

Run this before the call, not during the first minute of the call:

```powershell
cd "C:\Users\Immanuel Gabriel\Downloads\freshcontext-mcp"

git status --short --branch
npm run build
npm test
npm run smoke:stdio
npm run trust:scan:json
```

Expected healthy signs:

```text
working tree clean
tests pass
smoke: 21 tools, v0.3.18
trust scan: 0 effective fail findings
```

For Ops Pulse:

```powershell
cd "C:\Users\Immanuel Gabriel\Downloads\freshcontext-ops-pulse"

git status --short --branch
npm run check
npm run build
```

Expected healthy signs:

```text
working tree clean
typecheck passes
build passes
```

## Best Live Demo Path

Use the local demos first. They are deterministic and do not need live network access.

### 1. Show Bring Your Own Context

Academic/citation example:

```powershell
cd "C:\Users\Immanuel Gabriel\Downloads\freshcontext-mcp"
npm run demo:evaluate:file -- examples/sources.academic.example.json
```

Say:

```text
This is the simple user path. The user gives FreshContext candidate sources. FreshContext does not fetch or crawl here. It evaluates what was provided and returns decision-first context.
```

Point out:

- `Decision`
- `Meaning`
- `Action`
- `Warnings`
- `Freshness`
- `Rank score`
- `Utility`
- `Confidence`
- `Why`

The important visible result is not the number. It is the action label:

```text
Cite as primary
Cite as supporting
Needs verification
Exclude
```

### 2. Show A Normal-User Example

Jobs/opportunities example:

```powershell
npm run demo:evaluate:file -- examples/sources.jobs.example.json
```

Say:

```text
The same Core works for a different source profile and intent. Academic sources age slowly; jobs age quickly. FreshContext changes the decision meaning without needing a new product.
```

Point out decisions like:

```text
Use first
Needs refresh
Exclude
```

### 3. Show Adapter-To-Core Proof

arXiv fixture-backed adapter proof:

```powershell
npm run demo:arxiv
```

Say:

```text
This closes the adapter loop. arXiv-style XML becomes FreshContext signals, then Core evaluates those signals, then the decision helper explains what to do with them.
```

Use this exact flow:

```text
arXiv XML
-> searchArxivSignals(...)
-> evaluateSignals(...)
-> interpretEvaluations(...)
-> decision-ready output
```

This is the bridge from reference MCP tools to source-aware adapter assets.

### 4. Show MCP Runtime Health

Only run this if network conditions are fine, because representative MCP smoke can touch live source paths:

```powershell
npm run smoke:stdio
```

Expected:

```json
{
  "ok": true,
  "package_version": "0.3.18",
  "server_version": "0.3.18",
  "tool_count": 21
}
```

Say:

```text
This proves the MCP package still exposes the reference tool surface. But the product is not the number of tools. The tools are proof surfaces and adapter candidates over the Core judgment layer.
```

### 5. Show Trust Scanner

```powershell
npm run trust:scan:json
```

Say:

```text
This protects release and public-claim integrity. The line that matters for the gate is effective fail count: zero.
```

You do not need to read every raw finding live. The scanner intentionally reports review items and downgrades known non-blockers.

### 6. Show Ops Pulse Health

In the Ops Pulse repo:

```powershell
cd "C:\Users\Immanuel Gabriel\Downloads\freshcontext-ops-pulse"
npm run check
npm run build
```

Say:

```text
Ops Pulse is separate from FreshContext Core. It is the operational health companion for Cloudflare/runtime/D1/cron/observability workflows.
```

## Bring Your Own Context File Shape

Minimal JSON shape:

```json
{
  "profile": "academic_research",
  "intent": "citation_check",
  "signals": [
    {
      "title": "Example source",
      "content": "Raw retrieved content or notes...",
      "source": "https://example.com/source",
      "source_type": "arxiv",
      "published_at": "2026-05-24T12:00:00.000Z",
      "retrieved_at": "2026-05-24T13:00:00.000Z",
      "semantic_score": 0.92
    }
  ]
}
```

Run a custom file:

```powershell
npm run demo:evaluate:file -- path\to\sources.json
```

Important boundary:

```text
The file demo evaluates candidate context you provide. It does not fetch URLs, crawl websites, read folders, or run Operator mode.
```

## How To Explain The Framework

Use this architecture:

```text
Adapters / retrievers / databases / agents
-> FreshContext Signal Contract
-> Source Profile
-> Core evaluation
-> Decision Helper
-> MCP / REST / SDK / CLI / agent output
```

The deeper system split is:

```text
Core = deterministic context intelligence
Source Profiles = how source classes age and fail
Adapters = source intake
Hosts = MCP, REST, SDK, CLI
Operator = future retrieval workflow over Core
Trust Scanner = release/package/public-claim integrity
Ops Pulse = runtime health diagnostics
```

## How Agents Would Use This

For Codex, Claude, multi-agent workflows, or database-backed assistants, FreshContext should sit between retrieval and final reasoning:

```text
Agent retrieves 30 candidate items.
FreshContext normalizes and evaluates them.
FreshContext returns ranked decisions and warnings.
Agent uses the best context first and avoids stale/failed/unknown sources.
```

That means FreshContext is not trying to be another chat agent. It is the layer an agent uses before deciding what to trust.

In a multi-agent system:

```text
Research agent finds candidates.
FreshContext scores and labels candidates.
Writing agent receives only decision-ready context.
Review agent sees warnings, provenance, and excluded sources.
```

For database workflows:

```text
Database query returns rows or documents.
FreshContext evaluates dates, confidence, failure states, and source profile.
Application stores or displays the ranked decision result.
```

## What To Say If Someone Says "Is This Just Docs?"

Say:

```text
No. The docs describe the boundaries, but the local commands run the actual Core pipeline. The BYOC demo reads user-provided source JSON, evaluates it, ranks it, and prints decisions. The arXiv demo proves an adapter signal path reaches Core decisions. The MCP smoke proves the package exposes 21 working tools.
```

Then run:

```powershell
npm run demo:evaluate:file -- examples/sources.jobs.example.json
```

The output is the answer.

## Current Demo Script

Use this order in a live talk:

1. One sentence:

```text
FreshContext decides what context deserves to reach the model.
```

2. Run academic BYOC:

```powershell
npm run demo:evaluate:file -- examples/sources.academic.example.json
```

3. Run jobs BYOC:

```powershell
npm run demo:evaluate:file -- examples/sources.jobs.example.json
```

4. Run arXiv adapter proof:

```powershell
npm run demo:arxiv
```

5. Run MCP smoke if the network is stable:

```powershell
npm run smoke:stdio
```

6. Close with:

```text
The product is the judgment layer. The tools are reference adapters. The next growth path is more adapters, CLI/SDK usability, and eventually Operator mode.
```

## Current Release Boundary

Current prepared package version:

```text
freshcontext-mcp@0.3.18
```

Current state:

```text
release prep merged
package ready for release execution gate
npm publish not done
deploy not done
git tag not created
```

Do not publish, deploy, or tag during a demo.

## Troubleshooting

If the old ChatGPT handoff chat will not open:

```text
Do not depend on it. Use this runbook plus the local docs and repo state.
```

If `npm run smoke:stdio` fails during a live call:

```text
Switch to the offline demos: demo:evaluate:file and demo:arxiv.
```

If someone asks whether FreshContext gives advice:

```text
No. It gives context judgment: citation readiness, freshness, usefulness, traceability, and uncertainty. Humans and domain systems still own final decisions.
```

If someone asks what is next:

```text
Release execution gate, then CLI/SDK usability, then more adapter extraction, then Operator mode.
```


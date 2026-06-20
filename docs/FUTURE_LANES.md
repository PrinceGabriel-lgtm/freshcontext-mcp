# FreshContext Future Lanes

This document keeps future FreshContext work organized without turning roadmap ideas into public claims.

FreshContext is live today as an integrated MCP/Core package. Future work should stay in lanes, start with audits, and avoid feature sprawl.

The current package boundary is documented in [Core / MCP Boundary](./CORE_MCP_BOUNDARY.md). Treat MCP as the first live host over FreshContext Core, not as the whole product identity.

## Current Live Boundary

Live today:

- npm package: `freshcontext-mcp@0.3.23`
- MCP stdio server
- `evaluate_context` MCP tool for caller-provided candidate context
- Signal Contract v1 as the stable candidate-context input shape
- 21 read-only reference adapters
- Core signal evaluation
- Source Profiles
- Decision Helper
- adapter registry metadata
- arXiv signal-to-decision proof
- bring-your-own-context local demos
- Trust Scanner release gate

Not live today:

- Operator / `retrieve(...)`
- browser crawling
- automatic local file, folder, or PDF scanning
- hosted dashboard or billing
- hard Ha-Pri v2 production enforcement
- standalone Core SDK package
- full adapter ingestion

## Phase 0: Stabilize The Signal Contract

Goal:

```text
Treat Signal Contract v1 as the stable input boundary for FreshContext.
```

Current contract:

```text
title + content + source + source_type + published_at + retrieved_at + semantic_score
```

This is live today. It is not the same thing as future context signals or control signals.

Tasks in this lane should document examples, invalid-input behavior, and normalization expectations. Do not expand required fields unless tests prove the new metadata improves decisions.

Future context signals, control signals, ingestion quality signals, structure preservation signals, and provenance confidence signals belong to later Decision Layer upgrades. They should remain optional metadata, not public required fields.

## Lane 1: Client Setup Reliability

Goal:

```text
Make Claude, Codex, and MCP-compatible clients connect reliably to the published package.
```

Start with setup guide audits, Claude Desktop local/global package paths, Codex local MCP config paths, stale global package fixes, and smoke command expectations.

Do not claim ChatGPT/OpenAI connector compatibility until a separate compatibility audit is done.

## Lane 2: Generic Context Evaluation

Goal:

```text
Let any caller provide candidate context and get decision-ready output.
```

Current live MCP path:

```text
evaluate_context
```

Hard boundary:

```text
No fetching, crawling, browsing, folder reading, or retrieval orchestration.
Only evaluate caller-provided candidate context.
```

Next work in this lane should focus on CLI, SDK, and REST ergonomics over the same caller-provided signal shape.

## Lane 3: Multi-Agent Context Handoff Proof

Goal:

```text
Show FreshContext as an independent context judgment layer between agents.
```

Proof shape:

```text
agent A produces candidate context
-> FreshContext evaluates it
-> agent B receives decision-ready context
```

Do not build a full multi-agent framework. Prove the handoff boundary.

## Lane 4: Core SDK Extraction Audit

Goal:

```text
Decide whether Core should become a standalone package.
```

Audit current Core exports, dependency boundaries, package shape, browser/node compatibility, public API stability, and what remains MCP-only.

No extraction without a compatibility plan. Keep `freshcontext-mcp` stable until a standalone Core package has compatibility tests and a migration path.

## Lane 5: Local/User Data Intake Audit

Goal:

```text
Explore student, research, and local-PC workflows safely.
```

Candidate sources include notes, PDFs, local JSON/CSV, citation exports, and database rows.

Hard boundary:

```text
Consent-first design. No automatic folder scanning or background file reading.
```

## Lane 6: Decision Layer Upgrade

Goal:

```text
Make decisions more useful without silently changing ranking.
```

Possible inputs include context utility, control signal, future context signal, ingestion quality, structure preservation, provenance confidence, confidence tiers, and source-profile-specific thresholds.

These are optional future metadata upgrades on top of Signal Contract v1. They should only be exposed when they make decisions clearer without making the caller-facing contract harder to use.

Do not make `utility.score` affect ranking or decision labels by default without a dedicated policy pass.

## Lane 7: Ha-Pri v2 Production Path

Goal:

```text
Turn Ha-Pri v2 from pure Core helper/design into production enforcement where appropriate.
```

Audit canonical content material, storage path, verification timing, failure mode, D1/Worker compatibility, and migration plan.

Do not claim hard tamper enforcement until the read/write path exists.

## Lane 8: GDELT GKG / Richer Source Intelligence

Goal:

```text
Upgrade GDELT intelligence with richer global knowledge graph signals.
```

Possible fields include tone, Goldstein scale, event codes, actor geography, theme density, and source timeline.

Do not mix this with generic context evaluation or local intake.

## Lane 9: Operator / Retrieve Orchestration

Goal:

```text
Coordinate retrieval only after the decision layer and adapter boundaries are mature.
```

Operator may later select adapters, call retrievers, refresh stale sources, and package best context.

Not now. Operator is a later workflow layer over Core and adapters.

## Operating Rule

Every lane starts with:

```text
audit -> small patch -> validation -> stop
```

Do not combine lanes because the architecture is tempting.


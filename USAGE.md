# FreshContext Usage

FreshContext is context integrity infrastructure for AI agents and retrieval systems.

The current primary interface is the `freshcontext-mcp` package. It exposes one generic front door plus reference adapters:

```txt
evaluate_context
21 read-only reference adapters
```

## Recommended Path

Use `evaluate_context` when you already have candidate context from another retriever, database, agent, or script:

```txt
candidate context
-> Signal Contract v1
-> FreshContext judgment
-> decision-ready context
```

FreshContext evaluates the caller-provided signals and returns decision-first output:

- Decision
- Meaning
- Action
- Warnings
- Source
- Freshness
- Rank score
- Utility
- Confidence
- Why

`evaluate_context` does not fetch URLs, crawl, browse, read folders, or call adapters.

## Setup

For current Claude Desktop, Codex, `npx`, global npm, source checkout, and remote MCP setup paths, use:

```txt
docs/CLIENT_SETUP.md
```

For the Core/MCP boundary, use:

```txt
docs/CORE_MCP_BOUNDARY.md
```

## Reference Adapters

The named adapter tools remain useful proof surfaces, but they are not the product identity. They demonstrate how different source classes can be converted into timestamped, failure-honest context.

Current public package smoke expects:

```txt
22 tools = evaluate_context + 21 read-only reference adapters
```

## What FreshContext Is Not

FreshContext is not a truth certification engine. It does not provide legal, medical, tax, employment, academic, or investment advice.

It is also not currently:

- Operator mode
- automatic browser crawling
- local folder scanning
- a hosted public REST API
- a dashboard or billing system
- Ha-Pri v2 Worker/D1 production enforcement

Future work is tracked in `docs/FUTURE_LANES.md`.

# Context Integrity as a Control Plane for Agentic RAG

Retrieval quality is necessary for reliable AI, but it is not sufficient.

A retrieval system can select semantically relevant material from governed data and still hand an agent context that is stale, weakly attributable, internally inconsistent, or inappropriate for the decision being made. The failure happens after retrieval succeeds and before reasoning begins.

FreshContext treats that boundary as a separate infrastructure problem: **context integrity**.

## The control boundary

```text
enterprise data / content
        |
        v
retrieval / RAG / MCP
        |
        v
candidate context
        |
        v
+-----------------------------+
| FreshContext Core           |
| freshness                   |
| provenance material         |
| source profile              |
| confidence                  |
| context-conditioned utility |
| decision + explanation      |
+-----------------------------+
        |
        v
decision-ready context
        |
        v
agent / model / application
```

The purpose of this layer is not to replace data governance, retrieval, vector search, RAG, or model reasoning. It creates a decision boundary between them.

## Why governed data is not the end of the problem

Governance can establish who may access data and which data is authoritative. Retrieval can establish semantic relevance. Neither property alone answers:

- Is this evidence still fresh enough for this use case?
- Is its date confidence strong enough to support the decision?
- Is the source appropriate for the current intent?
- Does the context carry enough provenance material to explain why it was used?
- Should this item be primary evidence, supporting evidence, watched for refresh, or excluded?
- Can the resulting decision be reproduced and verified later?

Those are context-integrity questions.

## FreshContext's current implementation

The integrated Core/MCP package provides a live `evaluate_context` path for caller-provided context. The current implementation evaluates source profile, freshness, semantic score, confidence, provenance material, utility and decision output before the context reaches the consuming model or agent.

The production system also supports signed verdict identity and a verifiable ledger. That makes the evaluation boundary useful not only for ranking but for auditability: a system can retain evidence of what context was judged, what decision was emitted, and which engine version produced it.

FreshContext does **not** certify truth. It records and evaluates the conditions under which context is being relied on.

## MCP is an interface, not the product boundary

MCP is one live interface over FreshContext Core.

A useful composition is:

```text
data platform / retriever
        -> MCP or application boundary
        -> FreshContext evaluate_context
        -> decision + evidence
        -> agent action
```

The same pattern can sit behind REST, a local package import, an agent runtime, or another orchestration layer. No model swap, re-embedding, or re-indexing is required for the core evaluation path.

## Failure example

Assume a retriever returns two documents with similar semantic scores:

| Signal | Semantic score | Published | Source profile |
|---|---:|---:|---|
| A | 0.94 | 2022 | fast-changing technical guidance |
| B | 0.91 | 2026 | fast-changing technical guidance |

A semantic-only pipeline can prefer A.

A context-integrity layer can preserve the retriever's semantic evidence while adding temporal and source-conditioned evidence before the context becomes model input. FreshContext's decay-adjusted relevancy primitive expresses the temporal correction as:

```text
R_t = R_0 * exp(-lambda * t)
```

where the decay constant is source-profile specific.

The important architectural point is not the equation by itself. It is that **retrieval and context acceptance are different decisions**.

## What this enables

A context-integrity control plane can provide:

1. **Pre-action context gates** — evaluate candidate context before an agent acts.
2. **Evidence-preserving handoff** — keep source, timestamps, confidence and explanation attached to the decision.
3. **Refresh/watch decisions** — distinguish context that is usable now from context that should be refreshed.
4. **Auditable agent workflows** — bind decision output to a signed verdict and ledger record where required.
5. **Retriever independence** — apply the same integrity policy across different retrieval and data systems.
6. **Intent-conditioned evaluation** — judge the same source differently when the use case changes.

## What this does not claim

Context integrity is not a substitute for:

- source-of-truth data governance;
- authorization or access control;
- factual verification;
- model safety;
- semantic retrieval quality;
- human review in high-stakes workflows.

It is the infrastructure boundary concerned with whether **the context entering reasoning is fit to be relied on, and whether that judgment can be explained later**.

## Try the boundary

The primary MCP path is `evaluate_context`. It accepts caller-provided candidate context; it does not fetch, crawl, scrape or browse as part of evaluation.

See:

- [README](../README.md)
- [Architecture](./ARCHITECTURE.md)
- [Technical evidence](./TECHNICAL_EVIDENCE.md)
- [Methodology](../METHODOLOGY.md)
- [FreshContext Specification](../FRESHCONTEXT_SPEC.md)

The practical integration target is intentionally small: put FreshContext between one existing retrieval boundary and one downstream agent action, define acceptance criteria, and measure whether the additional integrity evidence changes bad context decisions.

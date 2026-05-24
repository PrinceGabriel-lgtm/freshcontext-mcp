# FreshContext Strategic Brief

## One-line thesis

FreshContext is a context-integrity and temporal intelligence system for AI retrieval: an integrated MCP/Core IP package with Core-led architecture and MCP-backed proof.

## Problem

Modern AI systems retrieve content primarily by semantic match. Semantic match can identify documents that look relevant, but it does not reliably answer whether the information is current, stale, undated, failed, or safe to act on.

The result is a common failure mode: an agent can summarize obsolete context accurately and still produce a bad answer. This is not always hallucination. Often it is correct reasoning over temporally corrupted retrieval.

For buyer evaluation, the problem is simple:

- AI agents need context with timestamps, source identity, and confidence.
- RAG systems need ranking that accounts for both relevance and time.
- Enterprises need provenance and auditability before automated systems act.
- Retrieval tools need a way to penalize stale, unknown-date, and failed context instead of presenting it with equal confidence.

## Why now

AI systems are moving from chat into workflows, research, sales, procurement, hiring, finance, compliance, and operations. In those settings, acting on stale context creates real cost.

The market has already accepted that retrieval is necessary. The next gap is retrieval quality: not just "what is similar?" but "what is current, traceable, useful, and honest enough to pass into an agent?"

FreshContext addresses that layer. It is designed to sit between retrieval and model execution, where it can improve the integrity of context without requiring a new foundation model.

## What FreshContext is

FreshContext is currently offered as an integrated MCP/Core IP package for temporal context integrity.

Core is the emerging reusable center of the system. MCP is the primary reference/interface implementation that proves the system in a working agent-facing package.

It provides:

- timestamped context envelopes
- source and adapter tracking
- published and retrieved time separation
- freshness scoring
- source-specific temporal decay
- timestamp confidence
- context-conditioned utility scoring
- failure honesty for empty, blocked, malformed, or error responses
- ranking and explanation primitives
- provenance references through Ha-Pri v1

The public MCP server is the main current interface over this Core-led architecture. The current 21 tools are reference adapters and proof modules showing how different source classes can be made FreshContext-compatible.

## What FreshContext is not

FreshContext is not just an MCP server.

FreshContext is also not:

- a general web scraping company
- a chatbot wrapper
- a replacement for vector databases
- a hosted agent framework
- a claim that freshness equals truth
- a hard tamper-enforcement system today
- Ha-Pri v2 in production
- a fully extracted standalone Core SDK today
- Ops Pulse

FreshContext measures and exposes temporal utility, source identity, confidence, status, and provenance. It does not claim that a fresh source is automatically correct.

## Architecture

### FreshContext Core

FreshContext Core is the emerging reusable center inside the current integrated MCP/Core package. It owns the scoring and envelope layer:

- freshness scoring
- timestamp confidence handling
- temporal decay
- context-conditioned utility
- envelope generation
- failure guards
- ranking and explanation primitives
- shared types and math primitives

Core is being architected so it can be useful beyond MCP. Today, it remains packaged with the MCP server, reference adapters, Worker code, docs, and tests in the primary repository. A future phase may extract Core into a separate SDK, package, repository, or licence boundary if there is a clear buyer or use-case reason.

### MCP/API layer

The MCP layer exposes FreshContext behavior to MCP-compatible clients such as Claude Desktop and other agent runtimes. It is the primary reference/interface implementation and a material part of the current sale package.

The API/Worker layer exposes compatible behavior through Cloudflare Worker endpoints, including service health, MCP transport, demo routes, and intelligence feed routes.

### Reference adapters

The 21 tools are reference adapters and proof modules. They demonstrate how source-specific data can be retrieved, timestamped, scored, and wrapped.

The adapter set covers source classes such as GitHub, Hacker News, arXiv, Google Scholar, Reddit, YC, Product Hunt, package metadata, finance data, jobs, government contracts, SEC filings, GDELT, GeBIZ, changelogs, and composite landscapes.

These adapters are useful, but they are not the whole product. The reusable value is the methodology and Core logic that turns retrieved content into temporally ranked, provenance-aware context, demonstrated through MCP-backed proof.

### Feeds

FreshContext also has feed-oriented assets, including Fresh HN Feed and Fresh Jobs Feed. These demonstrate recurring signal collection and timestamped feed surfaces.

The feed pattern is related to FreshContext Store/Ledger methodology: recurring queries, stored observations, temporal scoring, deduplication, and signal delivery.

### Ops Pulse

Ops Pulse is a diagnostics companion product. It helps diagnose Cloudflare Workers, D1, cron, and observability issues.

It should not be positioned as FreshContext Core. In a transaction, Ops Pulse may be included, licensed separately, bundled as support tooling, or carved out depending on buyer interest.

## Core primitives

### Source tracking

Each result identifies its source and adapter path so an evaluator can trace where a signal came from.

### Published/retrieved timestamps

FreshContext separates when content was published from when it was retrieved. This prevents "fetched today" from being mistaken for "created today."

### Freshness scoring

Freshness scoring normalizes temporal usefulness into a practical score that agents and humans can interpret.

### Temporal decay

FreshContext uses exponential decay:

```text
R_t = R_0 * e^(-lambda * t)
```

Source-specific decay constants reflect that Hacker News threads, job posts, government contracts, package releases, and academic papers age at different rates.

### Confidence

FreshContext tracks confidence in timestamp extraction. Structured API timestamps can be high confidence. Inferred dates are lower confidence. Unknown dates must not be treated as fresh.

### Context utility

FreshContext supports context-conditioned utility:

```text
U(q, s, t) = R(q, s) * e^(-lambda * t) * C_date * C_status
```

This lets a system account for query relevance, signal age, date confidence, and result status before context reaches an LLM.

### Provenance / Ha-Pri boundary

Ha-Pri v1 exists as a provenance and audit stamp for stored signals. It binds a result ID, content hash input, and engine version salt into a SHA-256 reference.

Ha-Pri v1 is not hard tamper enforcement. Ha-Pri v2 is documented as a future design path, not implemented production behavior.

## Market fit

### AI agents

Agents need to decide whether to act. FreshContext gives them timestamped, scored, source-aware context before action.

### RAG/retrieval systems

RAG stacks need temporal ranking in addition to semantic similarity. FreshContext can sit after retrieval and before generation.

### Data provenance

FreshContext provides source tracking, timestamps, confidence, and audit stamps that make retrieved context easier to inspect and govern.

### Enterprise AI governance

Enterprises need evidence that automated answers were based on current, traceable, and appropriately qualified inputs. FreshContext provides a compact primitive for that control layer.

### Observability / AI ops

FreshContext can support AI operations workflows where teams need to inspect why a signal ranked, why context was penalized, and whether failures were honestly surfaced.

Ops Pulse is adjacent diagnostics tooling, not the Core product.

## Differentiation

FreshContext is differentiated by the layer it targets.

Many systems focus on retrieving more documents, embedding better, scraping more sources, or calling newer models. FreshContext focuses on the integrity of the context package before it reaches the model.

Key differentiators:

- Explicit published-vs-retrieved timestamp separation
- Source-specific decay instead of one generic freshness rule
- Confidence-aware scoring so unknown dates are not promoted as fresh
- Failure honesty for blocked, empty, malformed, and partial results
- Context-conditioned utility rather than freshness as a standalone metric
- Structured envelope contract that can travel across MCP, API, CLI, feed, or internal service surfaces
- Ha-Pri v1 provenance stamps and a documented v2 hardening path
- Existing reference implementation, live public surfaces, tests, npm/registry history, and methodology/spec docs

## Current proof

FreshContext currently has:

- `freshcontext-mcp@0.3.17`
- 21 read-only MCP tools/reference adapters
- FreshContext Specification v1.2
- Methodology documentation for DAR, Store/Ledger, context utility, and provenance
- Core-backed envelope generation shared by the MCP package and Worker paths
- TypeScript source, tests, smoke script, and Worker typecheck path
- Cloudflare Worker implementation and public health/demo/feed surfaces
- Public site at `https://freshcontext-site.pages.dev/`
- npm package and MCP Registry presence
- Apify/feed-related assets
- Fresh HN Feed and Fresh Jobs Feed companion feed assets
- Ops Pulse as a separate diagnostics companion

This is more than a GitHub repo because it includes a named methodology, a compatibility contract, a reference implementation, public proof surfaces, distribution history, adjacent feed products, and a clear future path for Core extraction or separate licensing if a buyer wants that boundary.

## Deal paths

### Non-exclusive licence

A buyer licenses the integrated FreshContext MCP/Core package, including Core methodology, current implementation, docs, and transition support for use inside its own agent, RAG, data, or governance product.

Best fit: platforms that want temporal context integrity without acquiring every adjacent asset.

### Exclusive vertical licence

A buyer receives exclusive rights for a defined market such as recruiting, procurement, financial intelligence, developer tooling, or enterprise AI governance.

Best fit: companies that need defensible differentiation in one vertical but do not require full ownership.

### Full IP assignment

The buyer receives assigned ownership of the agreed FreshContext assets, subject to open-source dependency review, contributor checks, and any carve-outs.

Best fit: strategic buyers that want to own the integrated MCP/Core package and direct future productization.

### Acquisition + transition support

The buyer acquires the asset and retains the creator for a defined transition period to transfer context, stabilize packaging, support integration, and help product leadership understand the technical boundary.

Best fit: teams that want speed and founder knowledge transfer.

## Honest limitations

FreshContext is still early.

Known limitations:

- It is not a fully packaged enterprise SaaS.
- FreshContext Core is not yet a standalone SDK, package, or repository separate from MCP.
- Ha-Pri v1 is a provenance stamp, not hard tamper enforcement.
- Ha-Pri v2 is design-only at this stage.
- Some adapters depend on external public sources that may rate-limit, change shape, or fail.
- Feed and Worker paths are live proof assets, not a complete enterprise admin product.
- Public repository licensing and third-party dependency diligence must be reviewed before any assignment.
- Contributor chain-of-title, secrets hygiene, and account transfer boundaries must be verified.
- Ops Pulse should be evaluated separately from FreshContext Core.

## Next maturity steps

The next maturity work should package and harden, not expand features.

Recommended steps:

1. Complete legal/IP inventory and contributor chain-of-title review.
2. Prepare a clean buyer data room with source, docs, tests, proof links, and transfer notes.
3. Record a focused buyer demo using the stale/fresh/unknown/error context scenario.
4. Create a short technical evaluator guide for Core, MCP, Worker, feeds, and Ops Pulse.
5. Document account ownership and transfer process for GitHub, npm, registry, Cloudflare, Apify, and domains/sites.
6. Decide whether Core remains bundled with MCP for a transaction or whether future extraction is priced separately.
7. Run dependency and license diligence.
8. Decide deal carve-outs before sending materials outside an NDA.
9. Keep Ha-Pri v2 as a documented future hardening path unless a buyer explicitly funds or requests implementation.

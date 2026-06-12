# FreshContext Core / MCP Boundary

FreshContext is the context judgment layer between retrieval and reasoning.

The current npm package is intentionally named `freshcontext-mcp` because MCP is the first live interface. That does not make MCP the whole product. MCP is a host layer over the FreshContext Core engine.

## Product Shape

```text
Candidate context
  -> FreshContext Core
  -> decision-ready context
  -> MCP / Worker / future REST / future SDK / future CLI
```

FreshContext Core owns the judgment contract:

- signal normalization
- freshness scoring
- source profiles
- context utility sidecar scoring
- rank and explanation primitives
- decision helper output
- envelope and provenance helpers

MCP owns the live reference interface:

- tool registration
- MCP input schemas
- stdio transport
- client-facing tool descriptions
- formatting Core/adapter output for MCP clients

Adapters own source intake:

- source-specific fetching
- source-specific parsing
- timestamp extraction
- source-specific normalization
- failure normalization before Core evaluation

Worker/site surfaces own deployment concerns:

- Cloudflare runtime behavior
- KV/D1/cache/feed concerns
- hosted demo/site presentation
- runtime guards and deployment configuration

## Current Live Boundary

Live today:

- npm package: `freshcontext-mcp@0.3.20`
- MCP stdio server and published binary: `freshcontext-mcp`
- Core subpath export: `freshcontext-mcp/core`
- `evaluate_context` MCP tool for caller-provided candidate context
- 21 named read-only reference adapters
- Core signal evaluation
- Source Profiles
- Decision Helper
- adapter registry metadata
- arXiv signal-to-decision proof
- bring-your-own-context local demos
- Trust Scanner release gate

Network boundary:

- `evaluate_context` does not fetch, crawl, scrape, browse, read folders, or call adapters.
- The 21 named reference adapters are optional read-only network tools and use network access only when invoked.
- FreshContext Core remains the no-network judgment layer.

Not live today:

- standalone Core npm package
- package rename to `freshcontext`
- Operator / `retrieve(...)`
- automatic browser crawling
- automatic local folder/PDF scanning
- hosted enterprise dashboard or billing
- hard Ha-Pri v2 production enforcement
- full adapter ingestion into pure signal paths

## Future Package Split

The safe split path is staged:

1. Keep `freshcontext-mcp` stable for current users.
2. Maintain Core as a pure package subpath export surface.
3. Audit Core dependencies, Node/browser compatibility, and API stability.
4. Publish a standalone Core package only after compatibility tests exist.
5. Make `freshcontext-mcp` depend on the standalone Core package.
6. Consider a repo rename to `freshcontext` only after package/client links are stable.

The expected future shape is:

```text
freshcontext
  packages/core      reusable judgment engine
  packages/adapters  reference source intake assets
  packages/mcp       MCP host layer
  packages/cli       future local evaluator
  docs
```

## Compatibility Rule

Do not remove the current compatibility lanes until a dedicated migration pass exists:

- `src/types.ts` re-exports legacy adapter types from Core.
- `src/tools/freshnessStamp.ts` re-exports envelope helpers for older MCP/npm import paths.
- `dist/server.js` remains the package `main` and MCP binary target.

The architecture direction is clear, but the public runtime should stay boring and stable.

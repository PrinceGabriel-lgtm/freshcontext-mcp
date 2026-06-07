# FreshContext Release Notes

## 0.3.19

FreshContext 0.3.19 syncs the public MCP package with the new generic `evaluate_context` interface.

### Context Evaluation Front Door

- Adds `evaluate_context` as the primary MCP tool for caller-provided candidate context.
- Returns decision-first output for agents and users: decision, meaning, action, warnings, source, freshness, rank score, utility, confidence, and explanation.
- Keeps the boundary explicit: `evaluate_context` does not fetch, crawl, scrape, browse, read folders, or call adapters.
- Updates stdio smoke and Trust Scanner claim checks to expect 22 MCP tools: `evaluate_context` plus 21 read-only reference adapters.

### Public Framing

- Reframes the MCP package around FreshContext as context integrity infrastructure, not a 21-tool toolbox.
- Keeps the 21 adapter tools as read-only reference adapters and proof surfaces.
- Updates package-facing docs/spec language to point first at `candidate context -> FreshContext Core -> decision-ready context`.

## 0.3.18

FreshContext 0.3.18 made the MCP/Core package easier to install, validate, and explain without changing the deployed Worker runtime.

### Core and Context Evaluation

- Added the Core signal evaluation pipeline for normalized, freshness-ranked context results.
- Added Source Profiles as Core metadata for source-aware policy vocabulary.
- Added the Context Decision Helper so evaluated context can be interpreted as use, cite, verify, refresh, watch, background, or exclude.
- Preserved the ranking boundary: `ranked.final_score` controls default ordering, while `utility.score` remains sidecar intelligence.

### Bring Your Own Context

- Added decision-first local demos for user-provided JSON source lists.
- Added academic citation and jobs/opportunity sample inputs.
- Added `npm run demo:evaluate:file` for local source-list evaluation from a cloned source checkout.

### Adapter Path

- Added adapter registry metadata for the 21 existing MCP tools.
- Added additive arXiv signal extraction without changing the existing MCP `extract_arxiv` behavior.
- Added an arXiv signal-to-decision proof using a static fixture, Core evaluation, and decision output.

### Package and Release Hygiene

- Hardened the npm package file allowlist.
- Added script guards so repo-only scripts show a source-checkout notice in packed installs.
- Isolated Apify/Crawlee from the normal MCP npm runtime package while preserving source-checkout Apify Actor support.
- Confirmed fresh consumer installs no longer install Apify/Crawlee/file-type through the default MCP package path.

### Boundaries

- No Worker deploy is part of the npm package release.
- No hosted dashboard, billing system, Operator mode, browser crawling, or local file scanning is included.
- No Worker, REST handler, MCP tool schema, or existing adapter behavior changes are included in the package release itself.
- Future work is tracked in [`FUTURE_LANES.md`](./FUTURE_LANES.md).

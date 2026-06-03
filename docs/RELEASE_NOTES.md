# FreshContext Release Notes

## 0.3.18

FreshContext 0.3.18 prepares the next npm package release without changing the deployed Worker or publishing automatically.

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

- No npm publish in this preparation pass.
- No git tag in this preparation pass.
- No deployment in this preparation pass.
- No Worker, REST handler, Core runtime, MCP tool schema, or adapter behavior changes are included in the version bump itself.

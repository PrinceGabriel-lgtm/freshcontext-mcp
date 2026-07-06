# FreshContext Release Notes

## 0.4.0

FreshContext 0.4.0 ships the signed-verdict integrity loop and the staleness envelope live in
production, closing the near-term arc toward context-integrity infrastructure: a judgment that
is not just scored, but signed, stored, verifiable, and legible as a staleness signal.

### Ha-Pri v2 / v3 Signed-Verdict Loop (live in production)

- Adds HMAC-SHA256 signing of the `evaluate_context` verdict path (v2): canonical content
  hash, semantic fingerprint, adapter, timestamps, and version-scoped engine version, signed
  under a server-held secret never present in Core, never logged.
- Adds Ha-Pri v3: extends the signed payload with `verdict_id` and the `decision` itself, so
  the signature is tamper-evident at the verdict level. v3 runs additively alongside v2.
- Adds an append-only `evaluation_snapshots` ledger. Every signed verdict is stored; rows are
  never updated or deleted. Ledger writes are non-fatal and non-blocking — a storage failure
  can never break the caller's evaluation response.
- Adds a `/v1/verify` endpoint, mounted on the Worker, in two modes: stateless
  (recompute-and-compare HMAC over a caller-presented payload + signature — no state read) and
  ledger-backed (caller presents a `verdict_id` or row `id`; the endpoint reads the STORED
  signing payload + signature from the append-only ledger and verifies those). Either mode is
  callable by any third party without holding the signing secret. The ledger-backed mode is what
  makes verification read the stored, version-scoped engine version rather than a live constant.
  `/v1/evaluate` (public evaluate) stays unmounted pending a separate security decision.
- Live-verified in production 2026-06-30: first signed row confirmed byte-correct end to end
  (content hash, signature, verdict_id, decision, all fields consistent across independent
  computation paths). The mounted `/v1/verify` route is covered by an integration test that
  drives the real Worker fetch handler over a real local D1 ledger. **The mount itself was
  deployed 2026-07-06 (Worker Version `c1128e3c-1e10-4ba5-b9d7-ef117d97f06a`) and confirmed
  live the same day**: a real `curl` against the live URL's `/v1/health` returned
  `{"ok":true,...,"version":"0.4.0"}`, and both verify modes returned `valid` for a real
  ledger row signed 2026-06-30 — the ledger-backed mode correctly returned that row's stored
  `engine_version: "0.3.23"` rather than the current constant, confirming the
  version-scoping guarantee live, not only in tests.

### The Staleness Envelope ("the eyes")

- Adds an explicit `staleness` verdict (`fresh` / `aging` / `stale` / `unknown`) and a
  `revalidate_after` timestamp to the FreshContext envelope (`stampFreshness` /
  `toStructuredJSON` / `formatForLLM`), derived from the existing per-source freshness score —
  no second decay computation, no new tunable.
- `revalidate_after` solves the existing exponential decay function at its "verify before
  acting" threshold (one half-life from the content date); null when the content date is
  unknown, in lockstep with `freshness_score`.
- Surfaces both the human-readable line (`Staleness: fresh (revalidate by ...)`) and the
  structured JSON fields, so a consuming model sees staleness directly rather than having to
  interpret a bare score.
- Available via the adapter/extract tools' FreshContext envelope path. Not present in
  `evaluate_context` output, which uses a separate evaluation-result format by design.
- Live-verified in production 2026-07-01 via a real adapter call against the deployed Worker.

### Decay Model Validation

- Validated the per-source exponential decay model against 1,219 rows of real production data
  across 6 active source types. Confirmed the pure freshness function is clean and correctly
  calibrated (measured half-lives match design intent). Documented the honest scope boundary:
  age predicts source-level decay rate, not per-item validity; per-item variance is driven by
  content, not age alone. Full audit: `docs/FRESHCONTEXT_FLAG_A_THESIS_2026-06-30.md`.

### Methodology and Defensibility

- `METHODOLOGY.md` updated to v1.3, documenting the live signed-verdict integrity layer and
  the decay validation, so the authored specification matches the shipped engine.

### Release Gate

- Full test suite: 344 pass / 0 fail.
- MCP smoke confirmed at 22 tools / 0.4.0.
- Trust Scanner gate: effective fail 0.
- Package and server metadata aligned at 0.4.0.

## 0.3.23

FreshContext 0.3.23 adds deterministic verdict identity for evaluated context results.

### Deterministic Verdict ID

- Adds `verdict_id` to structured `evaluate_context` output.
- `verdict_id` is deterministic: the same input signal and evaluation context always
  produce the same identifier, enabling audit trails, caching, and downstream
  deduplication.
- Keeps `verdict_id` additive: it does not change ranking, decision labels, utility
  scoring, or existing structured output fields.
- Preserves full backward compatibility with 0.3.22 evaluate_context output shapes.

### Release Gate

- MCP smoke confirmed at 22 tools / 0.3.23.
- Trust Scanner gate: effective fail 0.
- Package and server metadata aligned at 0.3.23.

## 0.3.22

FreshContext 0.3.22 expands Source Profiles as judgment policies without adding adapters or retrieval behavior.

### Source Profile Expansion

- Adds `product_research` for product pages, pricing pages, launch pages, vendor docs, changelogs, and adoption evidence.
- Adds `multi_agent_handoff` for caller-provided context passed between agents or workflow steps.
- Preserves `official_docs` as an existing built-in profile with replay coverage.

### Validation Coverage

- Adds saved Signal Contract v1 replay fixtures for product research and multi-agent handoff.
- Extends batch validation and `evaluate_context` tests so the new profiles return decision-ready, readable output.
- Keeps the boundary explicit: profiles are judgment policies, not fetching, crawling, adapter selection, Operator mode, or agent orchestration.

## 0.3.21

FreshContext 0.3.21 adds provenance readiness and readable handoff safety for judged context.

### Provenance Readiness

- Adds a Core `provenance_readiness` sidecar that classifies caller-provided context as `complete`, `partial`, `incomplete`, `unknown`, or `derived`.
- Keeps provenance readiness additive: it does not fetch sources, verify truth, change ranking, change utility scoring, or change decision-label policy.
- Preserves stable structured `evaluate_context` output while adding provenance readiness to each result.

### Public Contract and Boundary Gates

- Adds compatibility coverage for pre-provenance `evaluate_context` payloads.
- Locks Core public imports, package fixture behavior, and the `freshcontext-mcp/core` subpath surface.
- Audits the adapter boundary so Core remains the judgment layer, while the 21 reference tools remain optional source-intake adapters.

### Readable Handoff Safety

- Adds `readable.handoff.safe_for_agent_handoff` and `readable.handoff.reason` to structured readable output.
- Derives handoff safety only from the existing decision and `provenance_readiness`.
- Does not add multi-agent orchestration, batch handoff counts, new MCP tools, or adapter orchestration.

### Release Gate

- Adds stress coverage for ugly provenance, scoring, decision, readable output, and handoff edge cases.
- Pins the policy that minimal title-only legacy input is valid but needs verification.
- Confirms MCP smoke remains at 22 tools and package/server metadata align at 0.3.21 for this release prep.

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

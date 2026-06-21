// edge.ts — Edge-safe Core math boundary (Pass 20-A).
//
// Re-exports ONLY Core modules whose entire transitive import graph is free
// of node:crypto, so the Worker — or any runtime without nodejs_compat — can
// pull the math without dragging in Node-only APIs.
//
// Guard: tests/coreEdgeBoundary.test.ts walks this barrel's transitive value-
// import graph and fails if anything reachable from here imports node:crypto.
// Adding a new export here MUST keep that test green.
//
// Cleared-but-deliberately-deferred (verified crypto-free in Phase 0, kept
// out for now because no consumer needs them at the edge yet):
//   guards.ts, rank.ts, utility.ts, signal.ts
// Widening the boundary before there is a real consumer just creates more
// contract to maintain. Add here only when a Worker or external consumer
// actually needs them at the edge — and re-run the guard test at that moment.

export { LAMBDA, calculateFreshnessScore, scoreLabel } from "./decay.js";

export {
  BUILT_IN_SOURCE_PROFILES,
  getSourceProfile,
  listSourceProfiles,
} from "./sourceProfiles.js";

export type { SourceProfile, SourceProfileId } from "./types.js";

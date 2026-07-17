// FreshContext enforcement wrapper (Pass 24).
//
// Core makes the verdict PROVABLE; this wrapper does the ENFORCING. FreshContext's
// engine returns an advisory verdict per context item — a decision label and a
// `safe_for_agent_handoff` boolean. That boolean advises; it does not block. This wrapper
// is the LangChain-style postprocessor that ACTS on it: it drops the items that are not
// safe for handoff, orders the rest strongest-first, and returns a full audit trail of
// what it removed and why — BEFORE the context ever reaches the model.
//
// Deliberate boundary (mirrors the engine-is-the-product / no-enforce-in-Core decision):
// enforcement lives HERE, never in the hosted Core API. Core stays a pure judgment layer.
// This wrapper is a separate, optional artifact a caller opts into when they want the
// verdict to be in-path instead of advisory.

// The eight decision labels Core can return. Kept as a local union so this wrapper is a
// standalone artifact with zero runtime dependency on the engine. A source-level parity
// test (tests/decisionParity.test.ts) fails if this drifts from Core's own definition.
export type ContextDecision =
  | "use_first"
  | "cite_as_primary"
  | "cite_as_supporting"
  | "use_as_background"
  | "needs_verification"
  | "needs_refresh"
  | "watch_only"
  | "exclude";

// The decisions Core treats as safe for agent handoff (see src/core/readable.ts
// HANDOFF_SAFE_DECISIONS). An item is only handoff-safe if its decision is in this set
// AND its provenance is complete — this wrapper reproduces that same rule when the caller
// does not supply the flag directly.
export const HANDOFF_SAFE_DECISIONS: ReadonlySet<ContextDecision> = new Set([
  "use_first",
  "cite_as_primary",
  "cite_as_supporting",
  "use_as_background",
]);

// All eight decisions in strength order (strongest first). Single source for both the
// runtime list and the ordering rank below. The parity test checks this against Core.
export const CONTEXT_DECISIONS = [
  "use_first",
  "cite_as_primary",
  "cite_as_supporting",
  "use_as_background",
  "needs_verification",
  "needs_refresh",
  "watch_only",
  "exclude",
] as const satisfies readonly ContextDecision[];

// Strength order for the admitted bundle (lower = stronger, placed earlier). Derived from
// CONTEXT_DECISIONS so the order is defined in exactly one place. Every decision has a rank
// so ordering is total and deterministic even under a permissive custom policy.
const DECISION_RANK = Object.fromEntries(
  CONTEXT_DECISIONS.map((d, i) => [d, i])
) as Record<ContextDecision, number>;

// The minimum an item must carry for the wrapper to enforce on it. Everything else on the
// caller's object is preserved untouched (the wrapper never mutates or strips caller data).
export interface EnforceableItem {
  decision: ContextDecision;
  // If Core already computed the handoff flag (evaluate_context returns it under
  // readable.handoff), pass it through — it is authoritative and the wrapper uses it
  // directly. Omit it and the wrapper derives safety from decision + provenance_complete.
  safe_for_agent_handoff?: boolean;
  // Whether Core's provenance_readiness.state === "complete". Only consulted when
  // safe_for_agent_handoff is not supplied and policy.requireProvenanceComplete is true.
  provenance_complete?: boolean;
}

export interface EnforcePolicy {
  // Handoff-safe decisions that reach the model at full priority.
  admit: ReadonlySet<ContextDecision>;
  // Handoff-safe decisions kept, but pushed to the back of the bundle (weak-but-usable).
  demote: ReadonlySet<ContextDecision>;
  // When deriving safety (no flag supplied), require complete provenance — matches Core's
  // handoff rule exactly. Set false to admit on decision alone.
  requireProvenanceComplete: boolean;
}

// Default policy: faithful to Core's own `safe_for_agent_handoff` line. The three strong
// handoff-safe decisions are admitted; use_as_background is kept but demoted; the four
// not-handoff-safe decisions (needs_verification, needs_refresh, watch_only, exclude) are
// dropped. Provenance must be complete. Callers override any field.
export const DEFAULT_POLICY: EnforcePolicy = {
  admit: new Set(["use_first", "cite_as_primary", "cite_as_supporting"]),
  demote: new Set(["use_as_background"]),
  requireProvenanceComplete: true,
};

export type Disposition = "admit" | "demote" | "drop";

export interface DroppedItem<T> {
  item: T;
  reason: string;
}

export interface EnforceResult<T> {
  // Ordered strongest-first — the ONLY context that should reach the model.
  admitted: T[];
  // Handoff-safe but low-priority — kept for the caller to append after `admitted`, or
  // ignore. Never silently merged into `admitted`.
  demoted: T[];
  // Removed before the model saw them, each with a human-readable reason. The audit trail
  // is the whole point: enforcement is honest, never a silent drop.
  dropped: DroppedItem<T>[];
  summary: { total: number; admitted: number; demoted: number; dropped: number };
}

function resolvePolicy(policy?: Partial<EnforcePolicy>): EnforcePolicy {
  if (!policy) return DEFAULT_POLICY;
  return {
    admit: policy.admit ?? DEFAULT_POLICY.admit,
    demote: policy.demote ?? DEFAULT_POLICY.demote,
    requireProvenanceComplete:
      policy.requireProvenanceComplete ?? DEFAULT_POLICY.requireProvenanceComplete,
  };
}

// Decide admit / demote / drop for one item, with the reason used when it is dropped.
//
// The gate and the tiering are kept separate and consistent:
//  1. A `safe_for_agent_handoff === false` from Core is an authoritative veto → drop. Core
//     already folded decision + provenance into that boolean; we do not second-guess a no.
//  2. When no positive flag is present, apply Core's provenance rule ourselves (skip it
//     when the flag is already true, since Core accounted for provenance in the flag).
//  3. Tier the survivor by policy: admit-set → admit, demote-set → demote, anything else →
//     drop (so a stricter custom policy is genuinely stricter, and the default policy —
//     which classifies all four handoff-safe decisions — mirrors the flag for the common
//     case).
function classify<T extends EnforceableItem>(
  item: T,
  policy: EnforcePolicy
): { disposition: Disposition; reason: string } {
  if (item.safe_for_agent_handoff === false) {
    return {
      disposition: "drop",
      reason: `not safe for agent handoff (decision '${item.decision}')`,
    };
  }

  if (item.safe_for_agent_handoff !== true) {
    if (policy.requireProvenanceComplete && item.provenance_complete === false) {
      return { disposition: "drop", reason: "provenance not complete enough for agent handoff" };
    }
  }

  if (policy.admit.has(item.decision)) return { disposition: "admit", reason: "" };
  if (policy.demote.has(item.decision)) return { disposition: "demote", reason: "" };

  return {
    disposition: "drop",
    reason: HANDOFF_SAFE_DECISIONS.has(item.decision)
      ? `decision '${item.decision}' excluded by policy`
      : `not safe for agent handoff (decision '${item.decision}')`,
  };
}

function byStrength<T extends EnforceableItem>(a: T, b: T): number {
  return DECISION_RANK[a.decision] - DECISION_RANK[b.decision];
}

/**
 * Enforce a FreshContext verdict on a list of evaluated context items.
 *
 * Input: items that each carry at least a `decision` (and, ideally, the
 * `safe_for_agent_handoff` flag from Core's readable output). All other fields on each
 * item are preserved untouched.
 *
 * Output: `admitted` (ordered strongest-first — what reaches the model), `demoted`
 * (handoff-safe but weak), and `dropped` (removed, each with a reason). Nothing is ever
 * discarded silently.
 */
export function enforce<T extends EnforceableItem>(
  items: readonly T[],
  policy?: Partial<EnforcePolicy>
): EnforceResult<T> {
  const resolved = resolvePolicy(policy);
  const admitted: T[] = [];
  const demoted: T[] = [];
  const dropped: DroppedItem<T>[] = [];

  for (const item of items) {
    const { disposition, reason } = classify(item, resolved);
    if (disposition === "admit") admitted.push(item);
    else if (disposition === "demote") demoted.push(item);
    else dropped.push({ item, reason });
  }

  admitted.sort(byStrength);
  demoted.sort(byStrength);

  return {
    admitted,
    demoted,
    dropped,
    summary: {
      total: items.length,
      admitted: admitted.length,
      demoted: demoted.length,
      dropped: dropped.length,
    },
  };
}

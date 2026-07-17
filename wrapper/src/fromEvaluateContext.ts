// Adapter: enforce directly on the output of FreshContext's `evaluate_context` tool.
//
// evaluate_context emits a [FRESHCONTEXT_EVALUATION_JSON] block whose `results` array
// carries, per item, a `decision`, a `readable.handoff.safe_for_agent_handoff` flag, and a
// `provenance_readiness.state`. This maps those onto the shape `enforce()` expects, so a
// caller who already ran evaluate_context (over MCP or the Core lib) can enforce its verdict
// with one call, getting their original result objects back — untouched — in the buckets.

import { enforce } from "./enforce.js";
import type { ContextDecision, EnforceableItem, EnforcePolicy, EnforceResult } from "./enforce.js";

// The fields this adapter reads. Everything else on the caller's object is preserved.
export interface EvaluateContextResultItem {
  decision: ContextDecision;
  readable?: { handoff?: { safe_for_agent_handoff?: boolean } };
  provenance_readiness?: { state?: string };
  [key: string]: unknown;
}

type Enforceable<T> = T & EnforceableItem;

// Surface the two fields enforce() needs (the handoff flag as authoritative when present,
// and derived provenance completeness) without disturbing the original object's data.
export function toEnforceable<T extends EvaluateContextResultItem>(item: T): Enforceable<T> {
  const flag = item.readable?.handoff?.safe_for_agent_handoff;
  return {
    ...item,
    decision: item.decision,
    ...(typeof flag === "boolean" ? { safe_for_agent_handoff: flag } : {}),
    provenance_complete: item.provenance_readiness?.state === "complete",
  };
}

// Enforce on the `results` array from evaluate_context's structured JSON. Returns the
// original result objects (augmented, not replaced) sorted into admitted / demoted /
// dropped.
export function enforceEvaluateContext<T extends EvaluateContextResultItem>(
  results: readonly T[],
  policy?: Partial<EnforcePolicy>
): EnforceResult<Enforceable<T>> {
  return enforce(results.map(toEnforceable), policy);
}

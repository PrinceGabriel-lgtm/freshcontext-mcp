# freshcontext-enforce

The enforcement wrapper for [FreshContext](https://www.npmjs.com/package/freshcontext-mcp).

FreshContext's engine returns an advisory verdict for each candidate context item — a
decision label and a `safe_for_agent_handoff` flag. That flag *advises*; it does not
*block*. This package is the piece that acts on it: a postprocessor that **drops** the
items that aren't safe for agent handoff, **orders** the rest strongest-first, and returns
a full **audit trail** of what it removed and why — before the context reaches the model.

> Core makes the verdict provable. This makes it in-path.

Enforcement lives here, deliberately, and never in the hosted engine. Core stays a pure
judgment layer; this is a separate, optional artifact you opt into when you want the verdict
enforced instead of merely returned.

## What it does

Given a list of evaluated context items, `enforce()` sorts each into one of three buckets:

- **admitted** — handoff-safe, ordered strongest-first. The only context that should reach
  the model.
- **demoted** — handoff-safe but weak (by default, `use_as_background`). Kept for you to
  append after `admitted`, or ignore. Never silently merged in.
- **dropped** — removed before the model saw it, each with a human-readable reason. Nothing
  is ever discarded silently.

## Usage

Enforce directly on the `results` array from `evaluate_context`'s structured JSON output:

```ts
import { enforceEvaluateContext } from "freshcontext-enforce";

// `results` = the array from evaluate_context's [FRESHCONTEXT_EVALUATION_JSON] block.
const { admitted, demoted, dropped, summary } = enforceEvaluateContext(results);

// Build the context bundle that reaches the model, strongest-first:
const contextForModel = [...admitted, ...demoted];

for (const d of dropped) {
  console.log(`dropped ${d.item.source}: ${d.reason}`);
}
```

Or enforce on any items that carry a `decision` (and, ideally, the handoff flag):

```ts
import { enforce } from "freshcontext-enforce";

const result = enforce([
  { decision: "use_first", safe_for_agent_handoff: true, id: "a" },
  { decision: "exclude", safe_for_agent_handoff: false, id: "b" }, // dropped
]);
```

## The default policy

The default mirrors Core's own `safe_for_agent_handoff` line exactly:

| Decision | Disposition |
|---|---|
| `use_first`, `cite_as_primary`, `cite_as_supporting` | admitted |
| `use_as_background` | demoted |
| `needs_verification`, `needs_refresh`, `watch_only`, `exclude` | dropped |

Provenance must be complete (matching Core). A `safe_for_agent_handoff: false` from Core is
an authoritative veto — dropped regardless of policy. Override any field:

```ts
enforce(items, {
  admit: new Set(["use_first"]),        // stricter: only the strongest
  demote: new Set(["cite_as_primary", "cite_as_supporting"]),
  requireProvenanceComplete: false,     // admit on decision alone
});
```

## Boundaries

- This does not fetch, evaluate, or sign anything. It enforces a verdict FreshContext already
  produced. Run `evaluate_context` first.
- It never mutates or strips your item objects; buckets contain your originals.
- The eight decision labels are defined locally so this package is standalone, and guarded by
  a parity test against the engine's own union so they can't silently drift.

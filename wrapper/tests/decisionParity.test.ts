import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { CONTEXT_DECISIONS } from "../src/enforce.ts";

// The wrapper defines the ContextDecision union locally so it is a standalone artifact with
// no runtime dependency on the engine. That is a deliberate duplication — and the standards
// require a duplicated constant to be guarded by an equality test against its source. This
// reads Core's own ContextDecision union from src/core/types.ts and fails if the wrapper's
// list drifts (a label added, removed, or renamed in Core that the wrapper hasn't tracked).

const here = dirname(fileURLToPath(import.meta.url));
const coreTypesPath = resolve(here, "../../src/core/types.ts");

function coreContextDecisions(): string[] {
  const src = readFileSync(coreTypesPath, "utf8");
  const m = src.match(/export type ContextDecision\s*=\s*([\s\S]*?);/);
  assert.ok(m, "could not locate `export type ContextDecision = ...;` in src/core/types.ts");
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}

test("wrapper CONTEXT_DECISIONS matches Core's ContextDecision union exactly", () => {
  const core = coreContextDecisions();
  assert.ok(core.length > 0, "parsed zero decisions from Core — the parse pattern is broken");
  assert.deepEqual(
    [...CONTEXT_DECISIONS].sort(),
    [...core].sort(),
    "wrapper decision labels have drifted from Core's ContextDecision union"
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { LAMBDA as CORE_LAMBDA } from "../src/core/decay.js";
// worker/package.json has no "type": "module", so tsx loads worker .ts files
// with CJS interop. Named imports fail; default-import + destructure works,
// mirroring tests/workerCoreEnvelopeParity.test.ts.
import workerIntelligence from "../worker/src/intelligence.ts";

const { LAMBDA: WORKER_LAMBDA } = workerIntelligence as { LAMBDA: Record<string, number> };

// Pass 20-B tripwire: until Pass 20-C migrates the Worker to import from
// src/core/edge, the two LAMBDA tables MUST stay key-for-key identical.
// Any divergence here is decay/adapter identity drift — exactly the failure
// mode Pass 5 flagged and Pass 7 deferred.

test("Worker and Core LAMBDA tables are key-for-key identical (Pass 20-B tripwire)", () => {
  assert.deepEqual(
    WORKER_LAMBDA,
    CORE_LAMBDA,
    "LAMBDA drift between worker/src/intelligence.ts and src/core/decay.ts. " +
      "Until Pass 20-C migrates the Worker to core/edge, both tables MUST match."
  );
});

test("LAMBDA tables hold the canonical 22-key set on both sides", () => {
  assert.equal(Object.keys(CORE_LAMBDA).length, 22, "Core LAMBDA key count");
  assert.equal(Object.keys(WORKER_LAMBDA).length, 22, "Worker LAMBDA key count");
});

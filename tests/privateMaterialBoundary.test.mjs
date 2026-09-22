import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// Everything this public repository should ignore by default, in one list.
//
// These are guardrails for normal Git add flows. They reduce accidental staging;
// they are not a security boundary and an explicit force-add can override them.
const MUST_STAY_OUT_BY_DEFAULT = [
  {
    path: "service-output/probe/client-evidence.json",
    why: "service-kit engagement material",
  },
  {
    path: "CLAIMS_MATRIX.md",
    why: "private commercial claims register",
  },
  {
    path: "GAP_REGISTER.md",
    why: "private gap and legal-review register",
  },
];

for (const { path, why } of MUST_STAY_OUT_BY_DEFAULT) {
  test(`${path} is ignored by default in this public repository`, () => {
    const checked = spawnSync("git", ["check-ignore", "-q", path], { encoding: "utf8" });
    assert.equal(checked.status, 0, `${path} must be gitignored under normal add flows: ${why}`);
  });
}

test("SERVICE_READINESS.md is deliberately NOT ignored", () => {
  // The negative control. Without it, someone broadening a pattern above could
  // silently stop publishing the one readiness document that is meant to be
  // public, and every other assertion in this file would still pass.
  const checked = spawnSync("git", ["check-ignore", "-q", "SERVICE_READINESS.md"], { encoding: "utf8" });
  assert.notEqual(checked.status, 0, "SERVICE_READINESS.md must remain trackable in the public repository");
});

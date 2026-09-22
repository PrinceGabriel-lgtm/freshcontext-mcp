import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// Everything this public repository must never carry, in one list.
//
// Each entry is here because a decision was taken to keep it out — and a
// decision that only exists as an absence is one `git add -A` from being
// reversed, by a person in a hurry or by an agent following a habit. Git makes
// that permanent. These are the mechanical half of those decisions.
const MUST_STAY_OUT = [
  {
    path: "service-output/probe/client-evidence.json",
    why: "service-kit runners write client fixtures, source URLs and document content here",
  },
  {
    path: "CLAIMS_MATRIX.md",
    why: "commercial claims register — states in permanent history that there is no customer proof, SLA or certification",
  },
  {
    path: "GAP_REGISTER.md",
    why: "gap and legal register — enumerates commercial weaknesses and open legal questions",
  },
];

for (const { path, why } of MUST_STAY_OUT) {
  test(`${path} cannot be committed to this repository`, () => {
    const checked = spawnSync("git", ["check-ignore", "-q", path], { encoding: "utf8" });
    assert.equal(checked.status, 0, `${path} must be gitignored: ${why}`);
  });
}

test("SERVICE_READINESS.md is deliberately NOT ignored", () => {
  // The negative control. Without it, someone broadening a pattern above could
  // silently stop publishing the one claims document that is meant to be
  // public, and every test here would still pass.
  const checked = spawnSync("git", ["check-ignore", "-q", "SERVICE_READINESS.md"], { encoding: "utf8" });
  assert.notEqual(checked.status, 0, "SERVICE_READINESS.md is technical truth and must stay public");
});

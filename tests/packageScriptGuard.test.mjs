import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const source = readFileSync("package-script-guard.mjs", "utf8");

test("package script guard uses no-shell spawning", () => {
  assert.match(source, /function resolveCommand/);
  assert.match(source, /shell:\s*false/);
  assert.doesNotMatch(source, /shell:\s*process\.platform/);
});

test("package script guard validates pass-through arguments", () => {
  assert.match(source, /function validatePassThroughArgs/);
  assert.match(source, /cannot contain null bytes/);
});

test("package script guard keeps publish and deploy out of guarded source-checkout scripts", () => {
  assert.doesNotMatch(source, /^\s*publish\s*:/m);
  assert.doesNotMatch(source, /^\s*deploy\s*:/m);
  assert.doesNotMatch(source, /npm\s+publish/);
  assert.doesNotMatch(source, /wrangler\s+deploy/);
});

test("package script guard rejects unknown scripts", () => {
  const result = spawnSync(process.execPath, ["package-script-guard.mjs", "__unknown__"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown FreshContext package script/);
});

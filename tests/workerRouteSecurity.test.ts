import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("worker/src/worker.ts", "utf8");

test("Worker health and debug routes have explicit method guards", () => {
  assert.match(source, /function requireMethod/);
  assert.match(source, /if \(url\.pathname === "\/health"\)[\s\S]*requireMethod\(request, \["GET", "HEAD"\]\)/);
  assert.match(source, /if \(url\.pathname === "\/debug\/scrape"\)[\s\S]*requireMethod\(request, \["GET"\]\)/);
  assert.match(source, /if \(url\.pathname === "\/debug\/db"\)[\s\S]*requireMethod\(request, \["GET"\]\)/);
});

test("Worker debug scrape failures return a generic response", () => {
  assert.match(source, /Debug scrape failed\./);
  assert.doesNotMatch(
    source,
    /JSON\.stringify\(\{\s*adapter,\s*query,\s*error:\s*err instanceof Error \? err\.message : String\(err\)\s*\}\)/
  );
});

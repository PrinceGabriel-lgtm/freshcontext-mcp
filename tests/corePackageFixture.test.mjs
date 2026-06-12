import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const fixtureRoot = join(process.cwd(), "tmp", "freshcontext-core-fixture");

function runFixtureScript() {
  const result = spawnSync(process.execPath, ["scripts/pack-core-fixture.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
}

async function listFixtureEntries() {
  const entries = await readdir(fixtureRoot, { recursive: true });
  return entries.map((entry) => String(entry).replace(/\\/g, "/"));
}

test("Core package fixture harness generates dependency-light package metadata", () => {
  assert.equal(existsSync("dist/core/index.js"), true, "run npm run build before fixture tests");
  runFixtureScript();

  const manifest = JSON.parse(readFileSync(join(fixtureRoot, "package.json"), "utf8"));
  assert.equal(manifest.name, "freshcontext-core");
  assert.equal(manifest.version, "0.3.21-fixture.0");
  assert.deepEqual(manifest.dependencies, {});
  assert.equal(manifest.exports["."].import, "./dist/index.js");
  assert.equal(manifest.exports["./compat"].import, "./dist/compat/index.js");
  assert.equal(manifest.exports["./package.json"], "./package.json");
});

test("Core package fixture excludes host, adapter, and runtime surfaces", async () => {
  runFixtureScript();

  const entries = await listFixtureEntries();
  const forbidden = [
    "dist/server.js",
    "dist/server.d.ts",
    "dist/adapters",
    "dist/rest",
    "dist/tools",
    "dist/apify.js",
    "dist/apify.d.ts",
    "src",
    "worker",
    "examples",
    "tests",
    "scripts",
    "node_modules",
  ];

  for (const path of forbidden) {
    assert.equal(
      entries.some((entry) => entry === path || entry.startsWith(`${path}/`)),
      false,
      `fixture should not contain ${path}`
    );
  }
});

test("Core package fixture exposes root and compat import lanes", () => {
  runFixtureScript();

  assert.equal(existsSync(join(fixtureRoot, "dist", "index.js")), true);
  assert.equal(existsSync(join(fixtureRoot, "dist", "index.d.ts")), true);
  assert.equal(existsSync(join(fixtureRoot, "dist", "compat", "index.js")), true);
  assert.equal(existsSync(join(fixtureRoot, "dist", "compat", "index.d.ts")), true);

  const compatJs = readFileSync(join(fixtureRoot, "dist", "compat", "index.js"), "utf8");
  const compatTypes = readFileSync(join(fixtureRoot, "dist", "compat", "index.d.ts"), "utf8");
  assert.match(compatJs, /stampFreshness/);
  assert.match(compatJs, /formatForLLM/);
  assert.match(compatJs, /toStructuredJSON/);
  assert.match(compatTypes, /FreshContext/);
  assert.match(compatTypes, /ExtractOptions/);
  assert.match(compatTypes, /AdapterResult/);
});

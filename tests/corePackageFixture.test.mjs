import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

async function readFixtureRuntimeOutput() {
  const entries = await listFixtureEntries();
  return entries
    .filter((entry) => entry.startsWith("dist/") && entry.endsWith(".js"))
    .map((entry) => readFileSync(join(fixtureRoot, entry), "utf8"))
    .join("\n");
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

test("Core package fixture exports readable helper from the root lane", async () => {
  runFixtureScript();

  assert.equal(existsSync(join(fixtureRoot, "dist", "readable.js")), true);
  assert.equal(existsSync(join(fixtureRoot, "dist", "readable.d.ts")), true);
  assert.equal(existsSync(join(fixtureRoot, "dist", "provenanceReadiness.js")), true);
  assert.equal(existsSync(join(fixtureRoot, "dist", "provenanceReadiness.d.ts")), true);

  const core = await import(pathToFileURL(join(fixtureRoot, "dist", "index.js")).href);
  const signal = {
    source: "https://example.com/core-fixture-contract",
    source_type: "official_docs",
    content: "Core fixture contract content.",
    published_at: "2026-05-24T12:00:00.000Z",
    retrieved_at: "2026-05-24T13:00:00.000Z",
    semantic_score: 0.9,
    date_confidence: "high",
  };
  const evaluation = core.evaluateSignal(signal, { now: "2026-05-24T13:00:00.000Z" });
  const readable = core.toReadableContextResult(evaluation, {
    decision: "use_first",
    label: "Use first",
    meaning: "Fixture helper composition remains available.",
    action: "Use the generated Core fixture helper.",
    reasons: [evaluation.explanation],
    warnings: [],
  });
  const readiness = core.prepareProvenanceReadiness(signal, {
    resultId: "core-fixture-contract",
    semanticFingerprint: "core-fixture-contract-fingerprint",
    engineVersion: "freshcontext-0.3.20",
  });

  assert.equal(typeof core.evaluateSignal, "function");
  assert.equal(typeof core.toReadableContextResult, "function");
  assert.equal(typeof core.prepareProvenanceReadiness, "function");
  assert.equal(evaluation.provenance_readiness.state, "complete");
  assert.equal(readable.label, "Use first");
  assert.equal(readiness.state, "complete");
});

test("Core package fixture keeps provenance readiness free of host runtime surfaces", () => {
  runFixtureScript();

  const coreIndex = readFileSync(join(fixtureRoot, "dist", "index.js"), "utf8");
  const readinessJs = readFileSync(join(fixtureRoot, "dist", "provenanceReadiness.js"), "utf8");
  const combined = `${coreIndex}\n${readinessJs}`;

  assert.match(coreIndex, /prepareProvenanceReadiness/);
  assert.doesNotMatch(combined, /\.\.\/adapters|\.\.\/tools|\.\.\/rest|\.\.\/server|worker\/src/);
  assert.doesNotMatch(combined, /\bKV\b|McpServer|fetch\(|createServer|listen\(/);
});

test("Core package fixture runtime output stays free of host and source-intake imports", async () => {
  runFixtureScript();

  const entries = await listFixtureEntries();
  const runtimeOutput = await readFixtureRuntimeOutput();

  assert.equal(entries.some((entry) => entry.startsWith("dist/adapters/")), false);
  assert.equal(entries.some((entry) => entry.startsWith("dist/tools/")), false);
  assert.equal(entries.some((entry) => entry.startsWith("dist/rest/")), false);
  assert.equal(entries.some((entry) => entry === "dist/server.js"), false);
  assert.doesNotMatch(runtimeOutput, /from\s+["']\.\.\/adapters|from\s+["']\.\.\/tools/);
  assert.doesNotMatch(runtimeOutput, /@modelcontextprotocol|McpServer|fetch\(|createServer|listen\(/);
  assert.doesNotMatch(runtimeOutput, /worker\/src|\.\.\/worker|\bKV\b|\bCACHE\b/);
});

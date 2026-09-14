import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Core is its own package now. This guards the property that makes that boundary
// mean something: nothing inside packages/core may reach upward into a host layer,
// pull a third-party dependency, or add a Node builtin beyond the one it declares.
//
// It replaces the old synthetic fixture harness, which asserted these properties
// against a generated *copy* of Core that listed 15 of the 16 modules by hand,
// omitted edge.ts, and invented a ./compat subpath the real package never had.
// Testing the real source is both simpler and harder to fool.

const CORE_SRC = fileURLToPath(new URL("../packages/core/src", import.meta.url));

const HOST_LAYERS = ["tools/", "adapters/", "rest/", "server", "worker/", "apify"];
const ALLOWED_BUILTINS = new Set(["node:crypto"]);

function coreFiles() {
  return readdirSync(CORE_SRC)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .map((f) => ({ name: f, path: join(CORE_SRC, f) }));
}

function importSpecifiers(source) {
  const out = [];
  const re = /(?:^|\n)\s*(?:import|export)[^;'"]*?from\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(source)) !== null) out.push(m[1]);
  const bare = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;
  while ((m = bare.exec(source)) !== null) out.push(m[1]);
  return out;
}

test("Core ships every module the package boundary claims", () => {
  const names = coreFiles().map((f) => f.name).sort();
  assert.ok(names.includes("index.ts"), "full barrel present");
  assert.ok(names.includes("edge.ts"), "edge barrel present — the old fixture omitted this");
  assert.ok(names.length >= 16, `expected at least 16 Core modules, found ${names.length}`);
});

test("no Core module reaches outside its own package", () => {
  const escapes = [];
  for (const { name, path } of coreFiles()) {
    for (const spec of importSpecifiers(readFileSync(path, "utf8"))) {
      if (!spec.startsWith(".")) continue;
      // Inside packages/core/src every relative import is a sibling: "./x.js".
      if (spec.startsWith("../")) escapes.push(`${name} -> ${spec}`);
    }
  }
  assert.deepEqual(escapes, [], `Core must not import outside packages/core/src: ${escapes.join(", ")}`);
});

test("no Core module imports a host layer", () => {
  const violations = [];
  for (const { name, path } of coreFiles()) {
    for (const spec of importSpecifiers(readFileSync(path, "utf8"))) {
      if (HOST_LAYERS.some((h) => spec.includes(h))) violations.push(`${name} -> ${spec}`);
    }
  }
  assert.deepEqual(violations, [], `Core must not depend on hosts, adapters or transports: ${violations.join(", ")}`);
});

test("Core has no third-party dependencies", () => {
  const thirdParty = [];
  for (const { name, path } of coreFiles()) {
    for (const spec of importSpecifiers(readFileSync(path, "utf8"))) {
      if (spec.startsWith(".") || spec.startsWith("#")) continue;
      if (spec.startsWith("node:")) continue;
      thirdParty.push(`${name} -> ${spec}`);
    }
  }
  assert.deepEqual(thirdParty, [], `Core must stay dependency-free: ${thirdParty.join(", ")}`);
});

test("Core uses only the Node builtins it declares", () => {
  const builtins = new Set();
  for (const { path } of coreFiles()) {
    for (const spec of importSpecifiers(readFileSync(path, "utf8"))) {
      if (spec.startsWith("node:")) builtins.add(spec);
    }
  }
  for (const b of builtins) {
    assert.ok(ALLOWED_BUILTINS.has(b), `unexpected Node builtin in Core: ${b}`);
  }
  assert.ok(builtins.has("node:crypto"), "node:crypto is the one declared builtin");
});

test("the Core workspace package is private and unpublished", () => {
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL("../packages/core/package.json", import.meta.url)), "utf8")
  );
  assert.equal(pkg.private, true, "@freshcontext/core must not be publishable from this repo state");
  assert.equal(pkg.name, "@freshcontext/core");
});

test("the published package declares no dependency on the Core workspace", () => {
  const root = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")
  );
  const all = { ...(root.dependencies ?? {}), ...(root.optionalDependencies ?? {}), ...(root.peerDependencies ?? {}) };
  assert.equal(
    Object.keys(all).some((d) => d.startsWith("@freshcontext/")),
    false,
    "the tarball must stay self-contained — no dependency on an unpublished workspace package"
  );
  // Core reaches the published runtime through Node subpath imports, resolved from
  // freshcontext-mcp's own package.json, so an installed copy needs nothing external.
  assert.equal(root.imports?.["#core"]?.default, "./dist/core/index.js");
  assert.equal(root.imports?.["#core/edge"]?.default, "./dist/core/edge.js");
});

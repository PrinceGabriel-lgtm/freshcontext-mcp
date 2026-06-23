import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LAMBDA as CORE_LAMBDA } from "../src/core/decay.js";

// Pass 20-D single-source guard (repoint of the old 20-B parity test).
//
// After 20-C the Worker imports LAMBDA from core/edge instead of keeping its own
// copy, so a Worker-vs-Core "tables match" check is tautological. The real risk
// now is REGRESSION: someone reintroducing a second `const LAMBDA = {...}` table
// and quietly re-creating the drift 20-A..20-C eliminated. This test enforces
// that exactly ONE definition of LAMBDA exists in runtime source, in decay.ts.
//
// "Definition" = a direct const binding named LAMBDA assigned a value:
//   (export )?const LAMBDA : ... =   /   (export )?const LAMBDA = ...
// It deliberately does NOT count imports, re-exports (`export { LAMBDA }`),
// destructures (`const { LAMBDA } = ...`), or consumers (`LAMBDA[x]`, `LAMBDA.y`).

const ROOTS = [
  fileURLToPath(new URL("../src", import.meta.url)),
  fileURLToPath(new URL("../worker/src", import.meta.url)),
];

const DEFINITION = /(?:^|\s)(?:export\s+)?const\s+LAMBDA\b\s*[:=]/g;

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      out.push(...walkTsFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(src: string): string {
  // Remove block comments, then line comments, so a comment mentioning
  // "const LAMBDA" can never false-positive.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\n)\s*\/\/[^\n]*/g, "$1");
}

function findDefinitions(): string[] {
  const hits: string[] = [];
  for (const root of ROOTS) {
    for (const file of walkTsFiles(root)) {
      const code = stripComments(readFileSync(file, "utf8"));
      const count = [...code.matchAll(DEFINITION)].length;
      for (let i = 0; i < count; i++) hits.push(file.replace(/\\/g, "/"));
    }
  }
  return hits;
}

test("exactly one LAMBDA definition exists in runtime source (Pass 20-D)", () => {
  const hits = findDefinitions();
  assert.equal(
    hits.length,
    1,
    `expected exactly one \`const LAMBDA\` definition in runtime source, found ${hits.length}: ` +
      `${hits.join(", ")}. If you added a second table, import it from src/core/decay.ts instead.`
  );
  assert.ok(
    hits[0].endsWith("src/core/decay.ts"),
    `the single LAMBDA definition must live in src/core/decay.ts, found it in ${hits[0]}`
  );
});

test("the canonical LAMBDA table holds the 22-key adapter set", () => {
  // Guards the one table against accidental key add/removal (no longer a
  // worker-vs-core comparison — there is only one table now).
  assert.equal(Object.keys(CORE_LAMBDA).length, 22, "canonical LAMBDA key count");
});

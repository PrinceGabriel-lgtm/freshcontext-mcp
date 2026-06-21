import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Walks the value-import graph reachable from src/core/edge.ts and asserts
// node:crypto is never reachable. `import type` and `export type` directives
// are erased at runtime and so are excluded from the walk.

const ENTRY = fileURLToPath(new URL("../src/core/edge.ts", import.meta.url));

function readRuntimeImports(filePath: string): string[] {
  const raw = readFileSync(filePath, "utf8");
  // Strip comments so import-like strings inside them don't leak through.
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\n)\s*\/\/[^\n]*/g, "$1");

  const imports: string[] = [];
  const fromRe = /(?:^|\n|;)\s*(import|export)(\s+type\b)?[^;"'`]*?\bfrom\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(src)) !== null) {
    if (m[2]) continue; // `import type` / `export type` — erased at runtime
    imports.push(m[3]);
  }
  const sideEffectRe = /(?:^|\n|;)\s*import\s+["']([^"']+)["']\s*;/g;
  while ((m = sideEffectRe.exec(src)) !== null) {
    imports.push(m[1]);
  }
  return imports;
}

function resolveLocal(specifier: string, fromFile: string): string | null {
  if (!specifier.startsWith(".")) return null; // external (node:* or npm pkg)
  const abs = resolve(dirname(fromFile), specifier);
  if (abs.endsWith(".ts") && existsSync(abs)) return abs;
  if (abs.endsWith(".js")) {
    const tsCandidate = abs.slice(0, -3) + ".ts";
    if (existsSync(tsCandidate)) return tsCandidate;
    if (existsSync(abs)) return abs;
  }
  for (const ext of [".ts", ".tsx", ".mjs", ".js"]) {
    if (existsSync(abs + ext)) return abs + ext;
  }
  return null;
}

function walkTransitive(entry: string): { files: Set<string>; externals: Set<string> } {
  const files = new Set<string>();
  const externals = new Set<string>();
  const queue: string[] = [entry];
  while (queue.length) {
    const current = queue.shift()!;
    if (files.has(current)) continue;
    files.add(current);
    for (const spec of readRuntimeImports(current)) {
      const resolved = resolveLocal(spec, current);
      if (resolved) {
        if (!files.has(resolved)) queue.push(resolved);
      } else {
        externals.add(spec);
      }
    }
  }
  return { files, externals };
}

test("core/edge transitive import graph contains no node:crypto", () => {
  const { externals, files } = walkTransitive(ENTRY);
  const cryptoSpecs = [...externals].filter(
    (spec) => spec === "node:crypto" || spec === "crypto"
  );
  assert.deepEqual(
    cryptoSpecs,
    [],
    `core/edge transitively imports node:crypto. ` +
      `Reachable files: ${[...files].sort().join(", ")}. ` +
      `Externals: ${[...externals].sort().join(", ")}`
  );
});

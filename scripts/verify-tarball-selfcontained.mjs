#!/usr/bin/env node
/**
 * Stage gate: prove the published tarball is SELF-CONTAINED.
 *
 * Run this before and after every migration stage. It builds, packs, installs
 * the tarball into a throwaway directory OUTSIDE the repository tree, and
 * imports every declared public subpath. If any subpath resolves through a
 * workspace symlink or an unpublished package, the install or the import fails
 * here rather than in a user's clean install.
 *
 * Why outside the tree: npm resolves node_modules upward. A probe run inside
 * the monorepo can silently satisfy @freshcontext/core from the workspace and
 * report success for a tarball that is broken in the wild.
 *
 * Usage:  node verify-tarball-selfcontained.mjs [--keep]
 * Exit:   0 all checks pass · 1 a check failed · 2 harness error
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = process.cwd();
const KEEP = process.argv.includes("--keep");

// Every subpath the package promises. Root is a side-effect entry: importing it
// starts the MCP server on stdio, so it is probed in a subprocess with a timeout
// rather than awaited — a hang there is a pass, not a failure.
const SIDE_EFFECT_ENTRY = "freshcontext-mcp";
const LIBRARY_SUBPATHS = ["freshcontext-mcp/core", "freshcontext-mcp/core/edge"];

const log = (s, n, v = "") => console.log(`${s.padEnd(4)} | ${n}${v ? " :: " + v : ""}`);
let failed = 0;
const check = (ok, name, detail = "") => { log(ok ? "PASS" : "FAIL", name, detail); if (!ok) failed++; };

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
console.log(`\n== tarball self-containment gate == ${pkg.name}@${pkg.version}\n`);

// 1 · Build and pack.
sh("npm", ["run", "build"], { cwd: REPO });
const packJson = JSON.parse(sh("npm", ["pack", "--dry-run", "--json"], { cwd: REPO }))[0];
const files = packJson.files.map((f) => f.path).sort();
check(files.length > 0, "pack produces a file list", `${files.length} files`);

// 2 · No unpublished workspace dependency may survive into the manifest.
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.optionalDependencies ?? {}) };
const workspaceDeps = Object.entries(deps).filter(([, spec]) => String(spec).startsWith("workspace:") || String(spec).startsWith("file:"));
check(workspaceDeps.length === 0, "no workspace:/file: dependency specifiers",
  workspaceDeps.length ? workspaceDeps.map(([k, v]) => `${k}@${v}`).join(", ") : "none");

// 3 · Every subpath target listed in exports must be inside the tarball.
const missing = [];
const walk = (node) => {
  if (typeof node === "string") { if (node.startsWith("./") && !files.includes(node.slice(2))) missing.push(node); return; }
  if (node && typeof node === "object") Object.values(node).forEach(walk);
};
walk(pkg.exports ?? {});
check(missing.length === 0, "every exports target ships in the tarball", missing.length ? missing.join(", ") : "all present");

// 4 · Install the real tarball outside the repository tree.
const tgz = resolve(REPO, sh("npm", ["pack", "--json"], { cwd: REPO }).match(/"filename":\s*"([^"]+)"/)?.[1] ?? `${pkg.name}-${pkg.version}.tgz`);
const sandbox = mkdtempSync(join(tmpdir(), "fc-tarball-gate-"));
check(!sandbox.startsWith(REPO), "sandbox is outside the repository tree", sandbox);

try {
  writeFileSync(join(sandbox, "package.json"), JSON.stringify({ name: "tarball-gate", private: true, type: "module", version: "0.0.0" }, null, 2));
  sh("npm", ["install", tgz, "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: sandbox, env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
  });
  check(true, "tarball installs from a clean directory");

  // 5 · Library subpaths must import with no workspace present.
  const probe = join(sandbox, "probe.mjs");
  writeFileSync(probe, `
    const out = [];
    for (const s of ${JSON.stringify(LIBRARY_SUBPATHS)}) {
      try { const m = await import(s); out.push([s, Object.keys(m).length]); }
      catch (e) { out.push([s, "ERROR: " + e.message.split("\\n")[0]]); }
    }
    console.log(JSON.stringify(out));
  `);
  const probed = JSON.parse(sh("node", [probe], { cwd: sandbox }));
  for (const [subpath, result] of probed) {
    check(typeof result === "number" && result > 0, `import ${subpath}`,
      typeof result === "number" ? `${result} exports` : String(result));
  }

  // 6 · The binary entry must resolve. server.js calls main() without awaiting it,
  // so module evaluation completes and the import settles; with stdin at /dev/null
  // the stdio transport then closes and the process exits 0. Either a clean exit or
  // our own watchdog firing counts as resolved — only ERR_MODULE_NOT_FOUND is a
  // real failure, and that is what a workspace-only dependency would produce.
  let started = false;
  let detail = "";
  try {
    const out = sh("node", ["--input-type=module", "-e",
      `await import(${JSON.stringify(SIDE_EFFECT_ENTRY)}); console.log("IMPORT_RESOLVED");`],
      { cwd: sandbox, timeout: 20000, stdio: ["ignore", "pipe", "pipe"] });
    started = out.includes("IMPORT_RESOLVED");
    detail = started ? "import resolved, server started" : "no resolution marker";
  } catch (e) {
    const stderr = String(e.stderr ?? "");
    if (/ERR_MODULE_NOT_FOUND|Cannot find package|Cannot find module/.test(stderr)) {
      started = false;
      detail = "module resolution failed — " + (stderr.match(/Cannot find \S+ '[^']+'/)?.[0] ?? "see stderr");
    } else if (e.killed || e.signal === "SIGTERM") {
      started = true; // held stdio open past the watchdog: healthy for a stdio server
      detail = "server held stdio past watchdog (expected)";
    } else {
      started = false;
      detail = `exit ${e.status}: ${stderr.split("\n")[0]}`;
    }
  }
  check(started, `binary entry ${SIDE_EFFECT_ENTRY} resolves and starts`, detail);
} finally {
  if (!KEEP) {
    rmSync(sandbox, { recursive: true, force: true });
    // npm pack writes the tarball into the repository root. Leaving it behind
    // trips the trust scanner's package-tgz-artifact rule on the next run, so
    // this gate cleans up the artifact it created.
    rmSync(tgz, { force: true });
  } else {
    console.log(`\nsandbox kept at ${sandbox}`);
    console.log(`tarball kept at ${tgz}`);
  }
}

console.log(`\n${failed === 0 ? "RESULT: SELF-CONTAINED" : `RESULT: ${failed} CHECK(S) FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);

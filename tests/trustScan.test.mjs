import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scannerPath = path.join(repoRoot, "scripts", "trust-scan.mjs");
const staleToolCountClaim = ["20", "tools"].join(" ");
const dotEnvName = [".", "env"].join("");
const dotEnvPattern = "(^|[^A-Za-z0-9_-])\\." + "env(?![A-Za-z0-9_-])";

const baseRules = {
  rules: [
    {
      id: "stale-20-tools",
      category: "stale_claim",
      severity: "fail",
      pattern: "\\b20\\s+tools\\b",
      flags: "i",
      message: "Stale tool-count claim found.",
      recommendation: "Update the tool count."
    },
    {
      id: "secret-openai-key-shape",
      category: "secret_shape",
      severity: "fail",
      pattern: "\\bsk-[A-Za-z0-9_-]{8,}\\b",
      flags: "",
      redact: true,
      message: "OpenAI key-shaped string found.",
      recommendation: "Remove the secret."
    },
    {
      id: "secret-dotenv-reference",
      category: "secret_shape",
      severity: "warn",
      pattern: dotEnvPattern,
      flags: "i",
      scopes: ["content", "path"],
      redact: true,
      message: "Environment-file reference found.",
      recommendation: "Confirm this is expected."
    },
    {
      id: "package-dotenv-boundary",
      category: "package_boundary",
      severity: "fail",
      pattern: dotEnvPattern,
      flags: "i",
      scopes: ["content", "path"],
      message: "Environment-file package boundary risk found.",
      recommendation: "Exclude environment files from package output."
    }
  ]
};

test("redacts secret-shaped values from JSON output", async () => {
  const fixture = await createFixture();
  try {
    const rawSecret = ["sk", "thisShouldNotPrint12345"].join("-");
    await writeFile(path.join(fixture, "README.md"), `Token ${rawSecret}\n`, "utf8");

    const result = runScanner(fixture, ["--path", ".", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes(rawSecret), false);

    const report = JSON.parse(result.stdout);
    const finding = report.findings.find((item) => item.ruleId === "secret-openai-key-shape");
    assert.equal(finding.match, "sk-[REDACTED]");
    assert.equal(finding.effectiveSeverity, "fail");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("reports detailed allowlist validation errors", async () => {
  const fixture = await createFixture({
    allowlist: {
      allow: [
        { ruleId: "stale-20-tools", path: "README.md" },
        { ruleId: "missing-rule", path: "README.md", reason: "Wrong rule id." },
        { ruleId: "stale-20-tools", path: "*.md", reason: "Too broad." }
      ]
    }
  });
  try {
    await writeFile(path.join(fixture, "README.md"), `${staleToolCountClaim}\n`, "utf8");

    const result = runScanner(fixture, ["--path", ".", "--json"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Allowlist entry at index 0: missing required reason\./u);
    assert.match(result.stderr, /Allowlist entry at index 2: wildcard paths are not allowed\./u);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("rejects allowlist entries with unknown rule ids", async () => {
  const fixture = await createFixture({
    allowlist: {
      allow: [{ ruleId: "missing-rule", path: "README.md", reason: "Wrong rule id." }]
    }
  });
  try {
    await writeFile(path.join(fixture, "README.md"), `${staleToolCountClaim}\n`, "utf8");

    const result = runScanner(fixture, ["--path", ".", "--json"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Allowlist entry at index 0: unknown ruleId "missing-rule"\./u);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("downgrades stale claims in archived docs", async () => {
  const fixture = await createFixture();
  try {
    const archiveDir = path.join(fixture, "_archive");
    await mkdir(archiveDir, { recursive: true });
    await writeFile(path.join(archiveDir, "notes.md"), `FreshContext had ${staleToolCountClaim}.\n`, "utf8");

    const result = runScanner(fixture, ["--path", ".", "--json"]);
    assert.equal(result.status, 0, result.stderr);

    const report = JSON.parse(result.stdout);
    const finding = report.findings.find((item) => item.ruleId === "stale-20-tools");
    assert.equal(finding.severity, "fail");
    assert.equal(finding.effectiveSeverity, "warn");
    assert.equal(finding.fileCategory, "private_or_archive_doc");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("env entries in .gitignore are not treated as fail-level secret leaks", async () => {
  const fixture = await createFixture();
  try {
    await writeFile(path.join(fixture, ".gitignore"), `${dotEnvName}\n${dotEnvName}.*\n`, "utf8");

    const result = runScanner(fixture, ["--path", ".", "--json"]);
    assert.equal(result.status, 0, result.stderr);

    const report = JSON.parse(result.stdout);
    assert.equal(report.findings.length > 0, true);
    assert.equal(report.findings.some((finding) => finding.effectiveSeverity === "fail"), false);
    assert.equal(report.findings.some((finding) => finding.ruleId === "secret-dotenv-reference" && finding.fileCategory === "config"), true);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("--show-allowed controls text details while JSON keeps allowed findings", async () => {
  const fixture = await createFixture({
    allowlist: {
      allow: [{ ruleId: "stale-20-tools", path: "README.md", reason: "Fixture assertion." }]
    }
  });
  try {
    await writeFile(path.join(fixture, "README.md"), `${staleToolCountClaim}\n`, "utf8");

    const hidden = runScanner(fixture, ["--path", "."]);
    assert.equal(hidden.status, 0, hidden.stderr);
    assert.match(hidden.stdout, /Allowed findings: 1/u);
    assert.equal(hidden.stdout.includes("Allowlist reason: Fixture assertion."), false);

    const shown = runScanner(fixture, ["--path", ".", "--show-allowed"]);
    assert.equal(shown.status, 0, shown.stderr);
    assert.match(shown.stdout, /Allowlist reason: Fixture assertion\./u);

    const json = runScanner(fixture, ["--path", ".", "--json"]);
    assert.equal(json.status, 0, json.stderr);
    const report = JSON.parse(json.stdout);
    const finding = report.findings.find((item) => item.ruleId === "stale-20-tools");
    assert.equal(finding.allowed, true);
    assert.equal(finding.allowReason, "Fixture assertion.");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("--repo-map --json includes repo map and file classification", async () => {
  const fixture = await createFixture({ withPackageJson: true });
  try {
    await writeFile(path.join(fixture, "README.md"), "# Fixture\n", "utf8");
    await writeFile(path.join(fixture, "LICENSE"), "MIT\n", "utf8");
    await writeFile(path.join(fixture, "SECURITY.md"), "Report security issues privately.\n", "utf8");
    await mkdir(path.join(fixture, "docs"), { recursive: true });
    await writeFile(path.join(fixture, "docs", "GUIDE.md"), "Guide\n", "utf8");
    await mkdir(path.join(fixture, "_archive"), { recursive: true });
    await writeFile(path.join(fixture, "_archive", "SESSION_NOTE.md"), "Old note\n", "utf8");
    await mkdir(path.join(fixture, "src"), { recursive: true });
    await writeFile(path.join(fixture, "src", "index.ts"), "export {};\n", "utf8");
    await mkdir(path.join(fixture, "tests"), { recursive: true });
    await writeFile(path.join(fixture, "tests", "unit.test.mjs"), "import 'node:test';\n", "utf8");
    await writeFile(path.join(fixture, "backup.sql"), "-- backup\n", "utf8");

    const result = runScanner(fixture, ["--path", ".", "--repo-map", "--json"]);
    assert.equal(result.status, 0, result.stderr);

    const report = JSON.parse(result.stdout);
    assert.equal(report.repoMap.packageManager, "npm");
    assert.equal(report.repoMap.hasPackageJson, true);
    assert.equal(report.repoMap.hasReadme, true);
    assert.equal(report.repoMap.hasLicense, true);
    assert.equal(report.repoMap.hasSecurityPolicy, true);
    assert.equal(report.repoMap.publicDocs.includes("README.md"), true);
    assert.equal(report.repoMap.publicDocs.includes("docs/GUIDE.md"), true);
    assert.equal(report.repoMap.privateOrArchiveDocs.includes("_archive/SESSION_NOTE.md"), true);
    assert.equal(report.repoMap.sourceFiles.includes("src/index.ts"), true);
    assert.equal(report.repoMap.testFiles.includes("tests/unit.test.mjs"), true);
    assert.equal(report.repoMap.packageBoundaryFiles.includes("backup.sql"), true);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("repo-map project warnings are warn-level and fail gate still uses effective severity", async () => {
  const fixture = await createFixture({ withPackageJson: true });
  try {
    await writeFile(path.join(fixture, "README.md"), "# Fixture\n", "utf8");
    await writeFile(path.join(fixture, "backup.sql"), "-- backup\n", "utf8");

    const result = runScanner(fixture, ["--path", ".", "--fail-on", "fail", "--json"]);
    assert.equal(result.status, 0, result.stderr);

    const report = JSON.parse(result.stdout);
    const repoFinding = report.findings.find((item) => item.ruleId === "repo-map-package-boundary-files-present");
    assert.equal(repoFinding.category, "repo_map");
    assert.equal(repoFinding.effectiveSeverity, "warn");
    assert.equal(report.summary.highestSeverity, "warn");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

async function createFixture({ rules = baseRules, allowlist = { allow: [] }, withPackageJson = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "trust-scan-"));
  await mkdir(path.join(root, "config"), { recursive: true });
  await writeFile(path.join(root, "config", "trust-scan-rules.json"), JSON.stringify(rules, null, 2), "utf8");
  await writeFile(path.join(root, "config", "trust-scan-allowlist.json"), JSON.stringify(allowlist, null, 2), "utf8");
  if (withPackageJson) {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "trust-scan-fixture",
        scripts: {
          "trust:scan": "node scripts/trust-scan.mjs",
          "trust:scan:json": "node scripts/trust-scan.mjs --json",
          "trust:scan:markdown": "node scripts/trust-scan.mjs --markdown"
        }
      }, null, 2),
      "utf8"
    );
  }
  return root;
}

function runScanner(cwd, args) {
  return spawnSync(process.execPath, [scannerPath, ...args], {
    cwd,
    encoding: "utf8"
  });
}

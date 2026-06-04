import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scannerPath = path.join(repoRoot, "scripts", "trust-scan.mjs");
const staleToolCountClaim = ["20", "tools"].join(" ");
const dotEnvName = [".", "env"].join("");
const dotEnvPattern = "(^|[^A-Za-z0-9_-])\\." + "env(?![A-Za-z0-9_-])";
const cloudflareTokenEnvName = ["CLOUDFLARE", "API", "TOKEN"].join("_");
const openAiKeyEnvName = ["OPENAI", "API", "KEY"].join("_");
const githubTokenEnvName = ["GITHUB", "TOKEN"].join("_");
const npmTokenEnvName = ["NPM", "TOKEN"].join("_");

const emptyRules = {
  rules: []
};

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

test("multiple path scans include project grouping in JSON", async () => {
  const fixture = await createFixture();
  try {
    const alpha = path.join(fixture, "alpha");
    const beta = path.join(fixture, "beta");
    await mkdir(alpha, { recursive: true });
    await mkdir(path.join(beta, "_archive"), { recursive: true });

    const rawSecret = ["sk", "multiRepoSecret12345"].join("-");
    await writeFile(path.join(alpha, "README.md"), `Current docs mention ${staleToolCountClaim} and ${rawSecret}.\n`, "utf8");
    await writeFile(path.join(beta, "_archive", "notes.md"), `Historical ${staleToolCountClaim} note.\n`, "utf8");

    const result = runScanner(fixture, ["--path", "alpha", "--path", "beta", "--repo-map", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes(rawSecret), false);

    const report = JSON.parse(result.stdout);
    assert.equal(report.summary.projectsScanned, 2);
    assert.equal(report.projects.length, 2);
    assert.deepEqual(report.projects.map((project) => project.name), ["alpha", "beta"]);
    assert.equal(report.findings.length > 0, true);

    const alphaProject = report.projects.find((project) => project.name === "alpha");
    const betaProject = report.projects.find((project) => project.name === "beta");
    assert.equal(alphaProject.repoMap.hasReadme, true);
    assert.equal(betaProject.repoMap.privateOrArchiveDocs.includes("_archive/notes.md"), true);

    const secretFinding = report.findings.find((finding) => finding.ruleId === "secret-openai-key-shape");
    assert.equal(secretFinding.project, "alpha");
    assert.equal(secretFinding.match, "sk-[REDACTED]");
    assert.equal(report.findings.some((finding) => finding.project === "beta" && finding.ruleId === "stale-20-tools"), true);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("multi-project Markdown and fail gate remain grouped and redacted", async () => {
  const fixture = await createFixture();
  try {
    const alpha = path.join(fixture, "alpha");
    const beta = path.join(fixture, "beta");
    await mkdir(alpha, { recursive: true });
    await mkdir(beta, { recursive: true });

    const rawSecret = ["sk", "failGateSecret12345"].join("-");
    await writeFile(path.join(alpha, "README.md"), "Clean docs.\n", "utf8");
    await writeFile(path.join(beta, "README.md"), `Token ${rawSecret}\n`, "utf8");

    const markdown = runScanner(fixture, ["--path", "alpha", "--path", "beta", "--repo-map", "--markdown"]);
    assert.equal(markdown.status, 0, markdown.stderr);
    assert.match(markdown.stdout, /## Projects/u);
    assert.match(markdown.stdout, /### alpha/u);
    assert.match(markdown.stdout, /### beta/u);
    assert.equal(markdown.stdout.includes(rawSecret), false);

    const gated = runScanner(fixture, ["--path", "alpha", "--path", "beta", "--fail-on", "fail", "--json"]);
    assert.equal(gated.status, 1);
    assert.equal(gated.stdout.includes(rawSecret), false);

    const report = JSON.parse(gated.stdout);
    assert.equal(report.summary.highestSeverity, "fail");
    assert.equal(report.projects.find((project) => project.name === "beta").summary.highestSeverity, "fail");
    assert.equal(report.projects.find((project) => project.name === "alpha").summary.highestSeverity, "warn");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("package gate reports normalized package-boundary failures", async () => {
  const fixture = await createFixture();
  try {
    const rawSecret = ["sk", "packageGateSecret12345"].join("-");
    await writePackageJson(fixture, {
      name: "package-gate-fixture",
      version: "1.2.3",
      files: ["README.md", "LICENSE", "backup.sql", "_archive/HANDOFF.md"]
    });
    await writeFile(path.join(fixture, "README.md"), `Fixture ${rawSecret}\n`, "utf8");
    await writeFile(path.join(fixture, "LICENSE"), "MIT\n", "utf8");
    await writeFile(path.join(fixture, "backup.sql"), "-- backup\n", "utf8");
    await mkdir(path.join(fixture, "_archive"), { recursive: true });
    await writeFile(path.join(fixture, "_archive", "HANDOFF.md"), "Historical handoff\n", "utf8");

    const result = runScanner(fixture, ["--package-gate", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes("Package gate is planned for Phase 3"), false);
    assert.equal(result.stdout.includes(rawSecret), false);

    const report = JSON.parse(result.stdout);
    assert.equal(report.packageGates.length, 1);
    assert.equal(report.packageGates[0].packageName, "package-gate-fixture");
    assert.equal(report.packageGates[0].packageVersion, "1.2.3");
    assert.equal(report.packageGates[0].packageFiles.includes("backup.sql"), true);
    assert.equal(report.packageGates[0].packageFiles.some((filePath) => filePath.startsWith("package/")), false);
    assert.equal(report.packageGates[0].findings.some((finding) => finding.ruleId === "package-gate-dangerous-file" && finding.path === "backup.sql" && finding.effectiveSeverity === "fail"), true);
    assert.equal(report.packageGates[0].findings.some((finding) => finding.ruleId === "package-gate-review-file" && finding.path === "_archive/HANDOFF.md" && finding.effectiveSeverity === "warn"), true);

    const gated = runScanner(fixture, ["--package-gate", "--fail-on", "fail", "--json"]);
    assert.equal(gated.status, 1);
    assert.equal(gated.stdout.includes(rawSecret), false);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("package gate keeps real env files fail-level", async () => {
  const fixture = await createFixture();
  try {
    await writePackageJson(fixture, {
      name: "package-gate-env-fixture",
      version: "1.0.0",
      files: ["README.md", "LICENSE", ".env", ".env.local"]
    });
    await writeFile(path.join(fixture, "README.md"), "Fixture\n", "utf8");
    await writeFile(path.join(fixture, "LICENSE"), "MIT\n", "utf8");
    await writeFile(path.join(fixture, ".env"), `${openAiKeyEnvName}=\n`, "utf8");
    await writeFile(path.join(fixture, ".env.local"), `${githubTokenEnvName}=\n`, "utf8");

    const result = runScanner(fixture, ["--package-gate", "--json"]);
    assert.equal(result.status, 0, result.stderr);

    const report = JSON.parse(result.stdout);
    assert.equal(report.packageGates[0].findings.some((finding) => finding.ruleId === "package-gate-dangerous-file" && finding.path === ".env" && finding.effectiveSeverity === "fail"), true);
    assert.equal(report.packageGates[0].findings.some((finding) => finding.ruleId === "package-gate-dangerous-file" && finding.path === ".env.local" && finding.effectiveSeverity === "fail"), true);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("package gate treats placeholder env templates as non-fail", async () => {
  const fixture = await createFixture();
  try {
    await writePackageJson(fixture, {
      name: "package-gate-template-fixture",
      version: "1.0.0",
      files: ["README.md", "LICENSE", ".env.example"]
    });
    await writeFile(path.join(fixture, "README.md"), "Fixture\n", "utf8");
    await writeFile(path.join(fixture, "LICENSE"), "MIT\n", "utf8");
    await writeFile(
      path.join(fixture, ".env.example"),
      `${cloudflareTokenEnvName}=\n${openAiKeyEnvName}=replace-me\n${githubTokenEnvName}=<your-token>\n${npmTokenEnvName}=your-token-here\n`,
      "utf8"
    );

    const result = runScanner(fixture, ["--package-gate", "--fail-on", "fail", "--json"]);
    assert.equal(result.status, 0, result.stderr);

    const report = JSON.parse(result.stdout);
    assert.equal(report.packageGates[0].findings.some((finding) => finding.ruleId === "package-gate-env-template" && finding.path === ".env.example" && finding.effectiveSeverity === "info"), true);
    assert.equal(report.packageGates[0].findings.some((finding) => finding.ruleId === "package-gate-env-template-secret"), false);
    assert.equal(report.summary.findingsByEffectiveSeverity.find((entry) => entry.name === "fail").count, 0);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("package gate fails env templates that contain secret-shaped values", async () => {
  const fixture = await createFixture();
  try {
    const rawSecret = ["sk", "envTemplateSecret12345"].join("-");
    await writePackageJson(fixture, {
      name: "package-gate-template-secret-fixture",
      version: "1.0.0",
      files: ["README.md", "LICENSE", ".env.example"]
    });
    await writeFile(path.join(fixture, "README.md"), "Fixture\n", "utf8");
    await writeFile(path.join(fixture, "LICENSE"), "MIT\n", "utf8");
    await writeFile(path.join(fixture, ".env.example"), `${openAiKeyEnvName}=${rawSecret}\n`, "utf8");

    const result = runScanner(fixture, ["--package-gate", "--fail-on", "fail", "--json"]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout.includes(rawSecret), false);

    const report = JSON.parse(result.stdout);
    assert.equal(report.packageGates[0].findings.some((finding) => finding.ruleId === "package-gate-env-template-secret" && finding.path === ".env.example" && finding.effectiveSeverity === "fail"), true);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("package gate reports no-package paths without placeholder text", async () => {
  const fixture = await createFixture();
  try {
    const result = runScanner(fixture, ["--package-gate", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes("Package gate is planned for Phase 3"), false);

    const report = JSON.parse(result.stdout);
    assert.equal(report.packageGates.length, 1);
    assert.equal(report.packageGates[0].packageName, null);
    assert.equal(report.packageGates[0].findings.some((finding) => finding.ruleId === "package-gate-no-package-json" && finding.effectiveSeverity === "info"), true);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("claim check reports matching package and server versions", async () => {
  const fixture = await createFixture({ rules: emptyRules });
  try {
    await writeFreshContextPackageJson(fixture, "1.2.3");
    await writeServerJson(fixture, "1.2.3");
    await writeFile(path.join(fixture, "README.md"), "FreshContext ships 21 tools.\n", "utf8");

    const result = runScanner(fixture, ["--claim-check", "--json"]);
    assert.equal(result.status, 0, result.stderr);

    const report = JSON.parse(result.stdout);
    assert.equal(report.claimChecks.length, 1);
    assert.equal(report.projects[0].claimCheck.packageName, "freshcontext-mcp");
    assert.equal(report.projects[0].claimCheck.expectedToolCount, 21);
    assert.equal(report.findings.some((finding) => finding.ruleId === "claim-check-version-match" && finding.effectiveSeverity === "info"), true);
    assert.equal(report.findings.some((finding) => finding.category === "claim_check"), true);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("claim check fails mismatched package and server versions", async () => {
  const fixture = await createFixture({ rules: emptyRules });
  try {
    await writeFreshContextPackageJson(fixture, "1.2.3");
    await writeServerJson(fixture, "1.2.4");
    await writeFile(path.join(fixture, "README.md"), "FreshContext ships 21 tools.\n", "utf8");

    const result = runScanner(fixture, ["--claim-check", "--fail-on", "fail", "--json"]);
    assert.equal(result.status, 1);

    const report = JSON.parse(result.stdout);
    const finding = report.findings.find((item) => item.ruleId === "claim-check-version-mismatch");
    assert.equal(finding.effectiveSeverity, "fail");
    assert.equal(finding.match, "1.2.3 != 1.2.4");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("claim check fails stale current tool-count claims in public docs", async () => {
  const fixture = await createFixture({ rules: emptyRules });
  try {
    await writeFreshContextPackageJson(fixture, "1.0.0");
    await writeFile(path.join(fixture, "README.md"), "FreshContext currently ships 20 tools for live retrieval.\n", "utf8");

    const result = runScanner(fixture, ["--claim-check", "--fail-on", "fail", "--json"]);
    assert.equal(result.status, 1);

    const report = JSON.parse(result.stdout);
    const finding = report.findings.find((item) => item.ruleId === "claim-check-tool-count-stale-current");
    assert.equal(finding.effectiveSeverity, "fail");
    assert.equal(finding.path, "README.md");
    assert.equal(finding.match, "20 tools");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("claim check does not fail historical stale tool-count context", async () => {
  const fixture = await createFixture({ rules: emptyRules });
  try {
    await writeFreshContextPackageJson(fixture, "1.0.0");
    await writeFile(path.join(fixture, "README.md"), "Historical regression note: FreshContext previously had 20 tools.\n", "utf8");

    const result = runScanner(fixture, ["--claim-check", "--fail-on", "fail", "--json"]);
    assert.equal(result.status, 0, result.stderr);

    const report = JSON.parse(result.stdout);
    assert.equal(report.findings.some((finding) => finding.ruleId === "claim-check-tool-count-stale-current"), false);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("claim check fails current Yahoo finance adapter wording", async () => {
  const fixture = await createFixture({ rules: emptyRules });
  try {
    await writeFreshContextPackageJson(fixture, "1.0.0");
    await writeFile(path.join(fixture, "README.md"), "The current finance adapter uses Yahoo for market data.\n", "utf8");

    const result = runScanner(fixture, ["--claim-check", "--fail-on", "fail", "--json"]);
    assert.equal(result.status, 1);

    const report = JSON.parse(result.stdout);
    const finding = report.findings.find((item) => item.ruleId === "claim-check-finance-yahoo-current");
    assert.equal(finding.effectiveSeverity, "fail");
    assert.equal(finding.match, "Yahoo");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("claim check allows historical Yahoo regression wording", async () => {
  const fixture = await createFixture({ rules: emptyRules });
  try {
    await writeFreshContextPackageJson(fixture, "1.0.0");
    await writeFile(path.join(fixture, "README.md"), "Historical Yahoo regression reference only; current finance behavior uses Stooq.\n", "utf8");

    const result = runScanner(fixture, ["--claim-check", "--fail-on", "fail", "--json"]);
    assert.equal(result.status, 0, result.stderr);

    const report = JSON.parse(result.stdout);
    assert.equal(report.findings.some((finding) => finding.ruleId === "claim-check-finance-yahoo-current"), false);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("claim check fails current Ha-Pri v2 deployed or Worker verification claims", async () => {
  const fixture = await createFixture({ rules: emptyRules });
  try {
    await writeFreshContextPackageJson(fixture, "1.0.0");
    await writeFile(path.join(fixture, "README.md"), "Ha-Pri v2 deployed in Worker. Worker verifies Ha-Pri v2 on reads.\n", "utf8");

    const result = runScanner(fixture, ["--claim-check", "--fail-on", "fail", "--json"]);
    assert.equal(result.status, 1);

    const report = JSON.parse(result.stdout);
    const findings = report.findings.filter((item) => item.ruleId === "claim-check-ha-pri-v2-overclaim");
    assert.equal(findings.length, 2);
    assert.equal(findings.every((finding) => finding.effectiveSeverity === "fail"), true);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("claim check allows future or not-yet Ha-Pri v2 wording", async () => {
  const fixture = await createFixture({ rules: emptyRules });
  try {
    await writeFreshContextPackageJson(fixture, "1.0.0");
    await writeFile(
      path.join(fixture, "README.md"),
      "Roadmap: Ha-Pri v2 deployed is not yet implemented. Worker verifies Ha-Pri v2 is planned future wording.\n",
      "utf8"
    );

    const result = runScanner(fixture, ["--claim-check", "--fail-on", "fail", "--json"]);
    assert.equal(result.status, 0, result.stderr);

    const report = JSON.parse(result.stdout);
    assert.equal(report.findings.some((finding) => finding.ruleId === "claim-check-ha-pri-v2-overclaim"), false);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("package scripts expose release gate and report commands", async () => {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));

  assert.equal(packageJson.scripts["trust:gate"], "node package-script-guard.mjs trust:gate");
  assert.equal(packageJson.scripts["trust:report"], "node package-script-guard.mjs trust:report");
  assert.equal(packageJson.scripts["trust:report:json"], "node package-script-guard.mjs trust:report:json");
});

test("package script guard routes release gate and reports to expected scanner flags", async () => {
  const guard = await readFile(path.join(repoRoot, "package-script-guard.mjs"), "utf8");

  assert.match(guard, /"trust:gate"[\s\S]*"--repo-map"[\s\S]*"--package-gate"[\s\S]*"--claim-check"[\s\S]*"--fail-on",\s*"fail"/u);
  assert.match(guard, /"trust:report"[\s\S]*"--markdown"[\s\S]*passThroughArgs:\s*true/u);
  assert.match(guard, /"trust:report:json"[\s\S]*"--json"[\s\S]*passThroughArgs:\s*true/u);
});

test("--output writes selected report mode and keeps redaction", async () => {
  const fixture = await createFixture();
  try {
    const rawSecret = ["sk", "outputFileSecret12345"].join("-");
    await writeFile(path.join(fixture, "README.md"), `Token ${rawSecret}\n`, "utf8");

    const outputPath = path.join("reports", "trust-report.json");
    const result = runScanner(fixture, ["--path", ".", "--json", "--output", outputPath]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.includes(rawSecret), false);
    assert.match(result.stderr, /Wrote json trust scan report/u);

    const written = await readFile(path.join(fixture, outputPath), "utf8");
    assert.equal(written.includes(rawSecret), false);

    const report = JSON.parse(written);
    const finding = report.findings.find((item) => item.ruleId === "secret-openai-key-shape");
    assert.equal(finding.match, "sk-[REDACTED]");
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

async function writePackageJson(root, packageJson) {
  await writeFile(path.join(root, "package.json"), JSON.stringify(packageJson, null, 2), "utf8");
}

async function writeFreshContextPackageJson(root, version) {
  await writePackageJson(root, {
    name: "freshcontext-mcp",
    version,
    scripts: {
      "trust:scan": "node scripts/trust-scan.mjs",
      "trust:scan:json": "node scripts/trust-scan.mjs --json",
      "trust:scan:markdown": "node scripts/trust-scan.mjs --markdown"
    }
  });
}

async function writeServerJson(root, version) {
  await writeFile(path.join(root, "server.json"), JSON.stringify({ version }, null, 2), "utf8");
}

function runScanner(cwd, args) {
  return spawnSync(process.execPath, [scannerPath, ...args], {
    cwd,
    encoding: "utf8"
  });
}

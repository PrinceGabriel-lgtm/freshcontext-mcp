#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const TOOL_NAME = "FreshContext Trust Scanner";
const DEFAULT_PATHS = ["."];
const DEFAULT_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".wrangler",
  ".next",
  "coverage",
  ".cache"
]);

const SCANNER_INTERNAL_FILES = new Set([
  "config/trust-scan-rules.json",
  "config/trust-scan-allowlist.json"
]);

const PUBLIC_DOC_FILES = new Set([
  "readme.md",
  "methodology.md",
  "freshcontext_spec.md",
  "security.md"
]);

const CONFIG_FILES = new Set([
  ".env.example",
  ".gitignore",
  ".npmignore",
  "package.json",
  "package-lock.json",
  "server.json",
  "tsconfig.json"
]);

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".csv",
  ".env",
  ".example",
  ".gitignore",
  ".html",
  ".ini",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".lock",
  ".md",
  ".mjs",
  ".npmignore",
  ".ps1",
  ".sh",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml"
]);

const TEXT_FILENAMES = new Set([
  "license",
  "notice",
  "readme",
  "security"
]);

const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".avif",
  ".bin",
  ".bmp",
  ".db",
  ".dll",
  ".doc",
  ".docx",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp3",
  ".mp4",
  ".pdf",
  ".png",
  ".sqlite",
  ".tar",
  ".tgz",
  ".webm",
  ".webp",
  ".wasm",
  ".zip"
]);

const SEVERITY_RANK = {
  info: 0,
  warn: 1,
  fail: 2
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (args.packageGate) {
    await runPackageGate();
    return;
  }

  const cwd = process.cwd();
  const rulesPath = path.join(cwd, "config", "trust-scan-rules.json");
  const allowlistPath = path.join(cwd, "config", "trust-scan-allowlist.json");
  const [rules, allowlist, packageMetadata] = await Promise.all([
    loadRules(rulesPath),
    loadAllowlist(allowlistPath),
    loadPackageMetadata(cwd)
  ]);
  const compiledRules = compileRules(rules);
  validateAllowlistRuleIds(allowlist, compiledRules);
  const scanState = createScanState({
    cwd,
    rules: compiledRules,
    allowlist,
    packageMetadata
  });

  for (const selectedPath of args.paths) {
    const absolutePath = path.resolve(cwd, selectedPath);
    await scanSelectedPath(absolutePath, scanState);
  }

  const report = generateReport(scanState);
  writeReport(report, args.output, { showAllowed: args.showAllowed });

  if (shouldFail(report.summary, args.failOn)) {
    process.exitCode = 1;
  }
}

function parseArgs(argv) {
  const result = {
    paths: [],
    output: "human",
    failOn: null,
    help: false,
    packageGate: false,
    showAllowed: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }

    if (arg === "--json") {
      setOutputMode(result, "json");
      continue;
    }

    if (arg === "--markdown") {
      setOutputMode(result, "markdown");
      continue;
    }

    if (arg === "--package-gate") {
      result.packageGate = true;
      continue;
    }

    if (arg === "--show-allowed") {
      result.showAllowed = true;
      continue;
    }

    if (arg === "--path") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--path requires a value.");
      }
      result.paths.push(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--path=")) {
      const value = arg.slice("--path=".length);
      if (!value) {
        throw new Error("--path requires a value.");
      }
      result.paths.push(value);
      continue;
    }

    if (arg === "--fail-on") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--fail-on requires warn or fail.");
      }
      result.failOn = parseFailOn(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--fail-on=")) {
      result.failOn = parseFailOn(arg.slice("--fail-on=".length));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (result.paths.length === 0) {
    result.paths = DEFAULT_PATHS;
  }

  return result;
}

function setOutputMode(result, output) {
  if (result.output !== "human" && result.output !== output) {
    throw new Error("Choose only one output mode: default text, --json, or --markdown.");
  }
  result.output = output;
}

function parseFailOn(value) {
  if (value !== "warn" && value !== "fail") {
    throw new Error("--fail-on requires warn or fail.");
  }
  return value;
}

function printHelp() {
  console.log(`${TOOL_NAME}

Usage:
  node scripts/trust-scan.mjs [options]

Options:
  --path <path>        Path to scan. Can be provided multiple times. Defaults to .
  --json              Print JSON output.
  --markdown          Print Markdown output.
  --fail-on <level>   Exit nonzero for unallowlisted findings at warn or fail severity.
  --show-allowed      Show full allowlisted finding details in text and Markdown output.
  --package-gate      Phase 3 placeholder. Prints a message and exits 0.
  -h, --help          Show this help.

Defaults:
  Local-only scan, no network, no telemetry, no file modification.
  Skips .git, node_modules, dist, build, .wrangler, .next, coverage, and .cache.
`);
}

async function loadRules(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed || !Array.isArray(parsed.rules)) {
    throw new Error("config/trust-scan-rules.json must contain a rules array.");
  }

  return parsed.rules.map((rule, index) => {
    const location = `Rule at index ${index}`;
    requireString(rule.id, `${location} is missing id.`);
    requireString(rule.category, `${location} is missing category.`);
    requireString(rule.severity, `${location} is missing severity.`);
    requireString(rule.pattern, `${location} is missing pattern.`);
    requireString(rule.message, `${location} is missing message.`);
    requireString(rule.recommendation, `${location} is missing recommendation.`);

    if (!Object.hasOwn(SEVERITY_RANK, rule.severity)) {
      throw new Error(`${location} has invalid severity: ${rule.severity}`);
    }

    if (rule.scopes !== undefined && (!Array.isArray(rule.scopes) || rule.scopes.length === 0)) {
      throw new Error(`${location} scopes must be a non-empty array when provided.`);
    }

    return {
      id: rule.id,
      category: rule.category,
      severity: rule.severity,
      pattern: rule.pattern,
      flags: typeof rule.flags === "string" ? rule.flags : "i",
      scopes: rule.scopes ?? ["content"],
      redact: rule.redact === true,
      message: rule.message,
      recommendation: rule.recommendation
    };
  });
}

async function loadAllowlist(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed || !Array.isArray(parsed.allow)) {
    throw new Error("config/trust-scan-allowlist.json must contain an allow array.");
  }

  const errors = [];
  const allowlist = [];

  for (const [index, entry] of parsed.allow.entries()) {
    const location = `Allowlist entry at index ${index}`;

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${location}: entry must be an object.`);
      continue;
    }

    if (!isNonEmptyString(entry.ruleId)) {
      errors.push(`${location}: missing required ruleId.`);
    }

    if (!isNonEmptyString(entry.path)) {
      errors.push(`${location}: missing required path.`);
    }

    if (!isNonEmptyString(entry.reason)) {
      errors.push(`${location}: missing required reason.`);
    }

    if (typeof entry.path === "string" && entry.path.includes("*")) {
      errors.push(`${location}: wildcard paths are not allowed.`);
    }

    if (isNonEmptyString(entry.ruleId) && isNonEmptyString(entry.path) && isNonEmptyString(entry.reason) && !entry.path.includes("*")) {
      allowlist.push({
        ruleId: entry.ruleId,
        path: normalizePath(entry.path),
        reason: entry.reason
      });
    }
  }

  if (errors.length > 0) {
    throw new Error(formatValidationErrors("Invalid allowlist", errors));
  }

  return allowlist;
}

async function loadPackageMetadata(rootDir) {
  const packageJsonPath = path.join(rootDir, "package.json");

  try {
    const parsed = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
    return {
      name: typeof parsed.name === "string" ? parsed.name : null,
      version: typeof parsed.version === "string" ? parsed.version : null,
      private: parsed.private === true
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function requireString(value, message) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(message);
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function formatValidationErrors(title, errors) {
  return `${title}:\n${errors.map((error) => `- ${error}`).join("\n")}`;
}

function validateAllowlistRuleIds(allowlist, rules) {
  const ruleIds = new Set(rules.map((rule) => rule.id));
  const errors = [];

  for (const [index, entry] of allowlist.entries()) {
    if (!ruleIds.has(entry.ruleId)) {
      errors.push(`Allowlist entry at index ${index}: unknown ruleId "${entry.ruleId}".`);
    }
  }

  if (errors.length > 0) {
    throw new Error(formatValidationErrors("Invalid allowlist", errors));
  }
}

function compileRules(rules) {
  const seen = new Set();

  return rules.map((rule) => {
    if (seen.has(rule.id)) {
      throw new Error(`Duplicate rule id: ${rule.id}`);
    }
    seen.add(rule.id);

    const flags = rule.flags.includes("g") ? rule.flags : `${rule.flags}g`;
    const invalidScopes = rule.scopes.filter((scope) => scope !== "content" && scope !== "path");
    if (invalidScopes.length > 0) {
      throw new Error(`Rule ${rule.id} has invalid scopes: ${invalidScopes.join(", ")}`);
    }

    return {
      ...rule,
      expression: new RegExp(rule.pattern, flags)
    };
  });
}

function createScanState({ cwd, rules, allowlist, packageMetadata }) {
  return {
    cwd,
    rules,
    allowlist,
    packageMetadata,
    seenFiles: new Set(),
    findings: [],
    stats: {
      scannedFiles: 0,
      skippedFiles: 0,
      skippedDirectories: 0,
      visitedDirectories: 0,
      scanErrors: 0
    }
  };
}

async function scanSelectedPath(absolutePath, state) {
  let stat;

  try {
    stat = await fs.lstat(absolutePath);
  } catch (error) {
    state.stats.scanErrors += 1;
    state.findings.push(createSyntheticFinding({
      ruleId: "scan-path-unreadable",
      severity: "warn",
      path: displayPath(absolutePath, state.cwd),
      message: `Unable to read selected path: ${error.message}`,
      recommendation: "Check the path and file permissions."
    }));
    return;
  }

  if (stat.isDirectory()) {
    await walkFiles(absolutePath, state);
    return;
  }

  if (stat.isFile()) {
    await scanFile(absolutePath, state);
  }
}

async function walkFiles(directoryPath, state) {
  state.stats.visitedDirectories += 1;

  let entries;
  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    state.stats.scanErrors += 1;
    state.findings.push(createSyntheticFinding({
      ruleId: "scan-directory-unreadable",
      severity: "warn",
      path: displayPath(directoryPath, state.cwd),
      message: `Unable to read directory: ${error.message}`,
      recommendation: "Check directory permissions or skip this path explicitly."
    }));
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (DEFAULT_SKIP_DIRS.has(entry.name)) {
        state.stats.skippedDirectories += 1;
        continue;
      }
      await walkFiles(entryPath, state);
      continue;
    }

    if (entry.isFile()) {
      await scanFile(entryPath, state);
    }
  }
}

async function scanFile(filePath, state) {
  const realFilePath = await fs.realpath(filePath).catch(() => filePath);
  if (state.seenFiles.has(realFilePath)) {
    return;
  }
  state.seenFiles.add(realFilePath);

  const relativePath = displayPath(filePath, state.cwd);
  const fileCategory = classifyFileCategory(relativePath);
  scanPathName(relativePath, fileCategory, state);

  if (SCANNER_INTERNAL_FILES.has(relativePath)) {
    state.stats.skippedFiles += 1;
    return;
  }

  const classification = await classifyFile(filePath);
  if (!classification.textLike) {
    state.stats.skippedFiles += 1;
    return;
  }

  let content;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (error) {
    state.stats.scanErrors += 1;
    state.findings.push(createSyntheticFinding({
      ruleId: "scan-file-unreadable",
      severity: "warn",
      path: relativePath,
      fileCategory,
      message: `Unable to read file: ${error.message}`,
      recommendation: "Check file permissions or skip this path explicitly."
    }));
    return;
  }

  state.stats.scannedFiles += 1;
  scanFileContent(relativePath, fileCategory, content, state);
}

async function classifyFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();

  if (BINARY_EXTENSIONS.has(ext)) {
    return { textLike: false, reason: `binary extension ${ext}` };
  }

  if (TEXT_EXTENSIONS.has(ext) || TEXT_FILENAMES.has(basename)) {
    return { textLike: true, reason: ext ? `text extension ${ext}` : "known text filename" };
  }

  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead === 0) {
      return { textLike: true, reason: "empty file" };
    }

    const sample = buffer.subarray(0, bytesRead);
    if (sample.includes(0)) {
      return { textLike: false, reason: "null byte detected" };
    }

    let suspiciousBytes = 0;
    for (const byte of sample) {
      const isCommonWhitespace = byte === 9 || byte === 10 || byte === 13;
      const isPrintableAscii = byte >= 32 && byte <= 126;
      const isUtf8LeadOrContinuation = byte >= 128;
      if (!isCommonWhitespace && !isPrintableAscii && !isUtf8LeadOrContinuation) {
        suspiciousBytes += 1;
      }
    }

    return {
      textLike: suspiciousBytes / bytesRead < 0.05,
      reason: "content sniff"
    };
  } finally {
    await handle.close();
  }
}

function classifyFileCategory(relativePath) {
  const normalized = normalizePath(relativePath);
  const lowerPath = normalized.toLowerCase();
  const basename = path.posix.basename(lowerPath);
  const ext = path.posix.extname(lowerPath);

  if (isGeneratedOrIgnoredPath(lowerPath, basename)) {
    return "generated_or_ignored";
  }

  if (isPrivateOrArchivePath(lowerPath, basename)) {
    return "private_or_archive_doc";
  }

  if (isTestPath(lowerPath, basename)) {
    return "test";
  }

  if (isSourcePath(lowerPath)) {
    return "source";
  }

  if (isConfigPath(lowerPath, basename, ext)) {
    return "config";
  }

  if (PUBLIC_DOC_FILES.has(lowerPath) || (lowerPath.startsWith("docs/") && ext === ".md")) {
    return "public_doc";
  }

  return "unknown";
}

function isGeneratedOrIgnoredPath(lowerPath, basename) {
  if (lowerPath.startsWith("dist/") || lowerPath.startsWith("build/") || lowerPath.startsWith("coverage/") || lowerPath.startsWith(".wrangler/")) {
    return true;
  }

  if (basename === ".api-key.local.txt" || basename === "backup.sql" || basename.endsWith(".local.txt") || basename.endsWith(".tgz")) {
    return true;
  }

  if (basename.startsWith(".mcpregistry_") || (basename.startsWith("backup-") && basename.endsWith(".sql"))) {
    return true;
  }

  return false;
}

function isPrivateOrArchivePath(lowerPath, basename) {
  if (lowerPath.startsWith("_archive/") || lowerPath.includes("/launch-drafts/")) {
    return true;
  }

  if (basename.includes("session") || basename.includes("handoff")) {
    return true;
  }

  return /(^|\/)(private|archive|sale|buyer|data-room|acquisition|outreach)(\/|[-_.]|$)/u.test(lowerPath);
}

function isTestPath(lowerPath, basename) {
  return lowerPath.startsWith("tests/") || /\.test\.(js|mjs|ts|tsx)$/u.test(basename);
}

function isSourcePath(lowerPath) {
  return lowerPath.startsWith("src/") || lowerPath.startsWith("worker/src/") || lowerPath.startsWith("scripts/");
}

function isConfigPath(lowerPath, basename, ext) {
  if (CONFIG_FILES.has(lowerPath) || CONFIG_FILES.has(basename)) {
    return true;
  }

  return basename === "wrangler.toml" || basename === "wrangler.jsonc" || ext === ".lock";
}

function scanPathName(relativePath, fileCategory, state) {
  for (const rule of state.rules) {
    if (!rule.scopes.includes("path")) {
      continue;
    }

    for (const match of findMatches(rule, relativePath)) {
      addFinding({
        state,
        rule,
        relativePath,
        fileCategory,
        line: 1,
        matchText: match
      });
    }
  }
}

function scanFileContent(relativePath, fileCategory, content, state) {
  const lines = content.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineText = lines[lineIndex];

    for (const rule of state.rules) {
      if (!rule.scopes.includes("content")) {
        continue;
      }

      for (const match of findMatches(rule, lineText)) {
        addFinding({
          state,
          rule,
          relativePath,
          fileCategory,
          line: lineIndex + 1,
          matchText: match
        });
      }
    }
  }
}

function findMatches(rule, text) {
  const matches = [];
  rule.expression.lastIndex = 0;

  let match;
  while ((match = rule.expression.exec(text)) !== null) {
    matches.push(match[0]);

    if (match[0] === "") {
      rule.expression.lastIndex += 1;
    }
  }

  return matches;
}

function addFinding({ state, rule, relativePath, fileCategory, line, matchText }) {
  const allow = findAllowlistEntry(state.allowlist, rule.id, relativePath);
  const severityAdjustment = resolveEffectiveSeverity(rule, fileCategory);

  state.findings.push({
    ruleId: rule.id,
    category: rule.category,
    severity: rule.severity,
    effectiveSeverity: severityAdjustment.effectiveSeverity,
    severityReason: severityAdjustment.severityReason,
    fileCategory,
    path: relativePath,
    line,
    match: rule.redact ? redactMatch(matchText, rule) : matchText,
    message: rule.message,
    recommendation: rule.recommendation,
    allowed: Boolean(allow),
    allowReason: allow?.reason
  });
}

function resolveEffectiveSeverity(rule, fileCategory) {
  if (rule.category === "secret_shape") {
    if (rule.id === "secret-dotenv-reference") {
      return severityForSecretReference(rule, fileCategory);
    }

    return {
      effectiveSeverity: "fail",
      severityReason: "Actual secret-shaped values and sensitive key references remain fail-level regardless of file category."
    };
  }

  if (rule.category === "package_boundary") {
    if (fileCategory === "config") {
      return {
        effectiveSeverity: "info",
        severityReason: "Downgraded because the package-boundary match is in configuration or ignore metadata."
      };
    }

    if (fileCategory === "package_boundary") {
      return {
        effectiveSeverity: "fail",
        severityReason: "Package-boundary output is fail-level when Phase 3 package gate supplies this category."
      };
    }

    return {
      effectiveSeverity: "warn",
      severityReason: "Downgraded because package-boundary rules are review items until Phase 3 package output is evaluated."
    };
  }

  if (rule.category === "stale_claim") {
    return severityForClaimLikeRule(rule, fileCategory, "stale claim");
  }

  if (rule.category === "implementation_overclaim") {
    return severityForClaimLikeRule(rule, fileCategory, "implementation overclaim");
  }

  if (rule.category === "security_legal_overclaim") {
    return severityForClaimLikeRule(rule, fileCategory, "security/legal overclaim");
  }

  if (rule.category === "private_doc_leakage") {
    if (fileCategory === "private_or_archive_doc" || fileCategory === "config" || fileCategory === "generated_or_ignored") {
      return {
        effectiveSeverity: "info",
        severityReason: "Downgraded because private/sale wording is in private, archive, config, or ignored material."
      };
    }

    return {
      effectiveSeverity: "warn",
      severityReason: "Private/sale wording should be reviewed outside private or archive material."
    };
  }

  return {
    effectiveSeverity: rule.severity,
    severityReason: "Original rule severity retained."
  };
}

function severityForSecretReference(rule, fileCategory) {
  if (fileCategory === "config") {
    return {
      effectiveSeverity: "info",
      severityReason: "Downgraded because .env appears in configuration or ignore metadata, not as a secret value."
    };
  }

  if (fileCategory === "generated_or_ignored") {
    return {
      effectiveSeverity: "warn",
      severityReason: "Kept as a review item because .env appears in ignored or generated material."
    };
  }

  return {
    effectiveSeverity: rule.severity,
    severityReason: "Environment-file references remain review items outside config metadata."
  };
}

function severityForClaimLikeRule(rule, fileCategory, label) {
  if (fileCategory === "public_doc") {
    return {
      effectiveSeverity: "fail",
      severityReason: `Public documentation ${label} is release-blocking.`
    };
  }

  if (fileCategory === "config") {
    return {
      effectiveSeverity: "info",
      severityReason: `Downgraded because the ${label} appears in configuration metadata.`
    };
  }

  if (fileCategory === "source" || fileCategory === "test" || fileCategory === "private_or_archive_doc" || fileCategory === "generated_or_ignored" || fileCategory === "unknown") {
    return {
      effectiveSeverity: "warn",
      severityReason: `Downgraded because the ${label} appears outside current public documentation.`
    };
  }

  return {
    effectiveSeverity: rule.severity,
    severityReason: "Original rule severity retained."
  };
}

function findAllowlistEntry(allowlist, ruleId, relativePath) {
  const normalizedPath = normalizePath(relativePath);
  return allowlist.find((entry) => entry.ruleId === ruleId && normalizedPath.endsWith(entry.path));
}

function redactMatch(matchText, rule) {
  if (rule.id.includes("bearer")) {
    return "Bearer [REDACTED]";
  }

  if (rule.id.includes("openai-key-shape")) {
    return "sk-[REDACTED]";
  }

  if (rule.id.includes("github-pat-shape")) {
    return "ghp_[REDACTED]";
  }

  if (rule.id.includes("npm-token-shape")) {
    return "npm_[REDACTED]";
  }

  if (rule.id.includes("-env")) {
    return matchText.replace(/^(.*?=\s*).+$/u, "$1[REDACTED]");
  }

  if (rule.id.includes("private-key")) {
    return "[REDACTED:PRIVATE_KEY_REFERENCE]";
  }

  if (rule.id.includes("dotenv")) {
    return "[REDACTED:DOTENV_REFERENCE]";
  }

  return "[REDACTED]";
}

function createSyntheticFinding({ ruleId, severity, path: findingPath, fileCategory = "unknown", message, recommendation }) {
  return {
    ruleId,
    category: "scanner",
    severity,
    effectiveSeverity: severity,
    severityReason: "Scanner operational finding severity retained.",
    fileCategory,
    path: findingPath,
    line: 0,
    match: "",
    message,
    recommendation,
    allowed: false,
    allowReason: undefined
  };
}

function generateReport(state) {
  const sortedFindings = sortFindings(state.findings);
  const summary = generateSummaryStats(sortedFindings, state.stats);

  return {
    tool: TOOL_NAME,
    package: state.packageMetadata,
    summary,
    findings: sortedFindings
  };
}

function generateSummaryStats(findings, stats) {
  const allowedFindings = findings.filter((finding) => finding.allowed).length;
  const unallowedFindings = findings.length - allowedFindings;
  const highestSeverity = findings
    .filter((finding) => !finding.allowed)
    .reduce((highest, finding) => {
      if (SEVERITY_RANK[finding.effectiveSeverity] > SEVERITY_RANK[highest]) {
        return finding.effectiveSeverity;
      }
      return highest;
    }, "info");
  const downgradedFindings = findings.filter((finding) => SEVERITY_RANK[finding.effectiveSeverity] < SEVERITY_RANK[finding.severity]);

  return {
    scannedFiles: stats.scannedFiles,
    skippedFiles: stats.skippedFiles,
    skippedDirectories: stats.skippedDirectories,
    findings: findings.length,
    allowedFindings,
    unallowedFindings,
    highestSeverity,
    scanErrors: stats.scanErrors,
    findingsBySeverity: countBy(findings, "severity", ["fail", "warn", "info"]),
    findingsByEffectiveSeverity: countBy(findings, "effectiveSeverity", ["fail", "warn", "info"]),
    findingsByCategory: countBy(findings, "category"),
    findingsByRule: countBy(findings, "ruleId"),
    findingsByFileCategory: countBy(findings, "fileCategory"),
    topPaths: topCounts(findings, "path", 10),
    downgradedFindings: downgradedFindings.length,
    topDowngradedRules: topCounts(downgradedFindings, "ruleId", 10)
  };
}

function sortFindings(findings) {
  return [...findings].sort((a, b) => {
    const severityDiff = SEVERITY_RANK[b.effectiveSeverity] - SEVERITY_RANK[a.effectiveSeverity];
    if (severityDiff !== 0) {
      return severityDiff;
    }

    const rawSeverityDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (rawSeverityDiff !== 0) {
      return rawSeverityDiff;
    }

    const pathDiff = a.path.localeCompare(b.path);
    if (pathDiff !== 0) {
      return pathDiff;
    }

    if (a.line !== b.line) {
      return a.line - b.line;
    }

    return a.ruleId.localeCompare(b.ruleId);
  });
}

function countBy(items, key, preferredOrder = []) {
  const counts = new Map(preferredOrder.map((value) => [value, 0]));

  for (const item of items) {
    counts.set(item[key], (counts.get(item[key]) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => {
      const preferredA = preferredOrder.indexOf(a[0]);
      const preferredB = preferredOrder.indexOf(b[0]);

      if (preferredA !== -1 || preferredB !== -1) {
        if (preferredA === -1) {
          return 1;
        }
        if (preferredB === -1) {
          return -1;
        }
        return preferredA - preferredB;
      }

      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }

      return String(a[0]).localeCompare(String(b[0]));
    })
    .map(([name, count]) => ({ name, count }));
}

function topCounts(items, key, limit) {
  return countBy(items, key).slice(0, limit);
}

function writeReport(report, outputMode, options = {}) {
  if (outputMode === "json") {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (outputMode === "markdown") {
    console.log(formatMarkdown(report, options));
    return;
  }

  console.log(formatHuman(report, options));
}

function formatHuman(report, options = {}) {
  const visibleFindings = filterVisibleFindings(report.findings, options);
  const lines = [
    TOOL_NAME,
    "",
    ...formatSummaryLines(report.summary),
    ""
  ];

  lines.push(...formatHumanGroup("Findings by effective severity", report.summary.findingsByEffectiveSeverity));
  lines.push("");
  lines.push(...formatHumanGroup("Findings by category", report.summary.findingsByCategory));
  lines.push("");
  lines.push(...formatHumanGroup("Findings by rule", report.summary.findingsByRule));
  lines.push("");
  lines.push(...formatHumanGroup("Findings by file category", report.summary.findingsByFileCategory));
  lines.push("");
  lines.push(...formatHumanGroup("Top paths", report.summary.topPaths));
  lines.push("");
  lines.push(...formatHumanGroup("Top downgraded rules", report.summary.topDowngradedRules));
  lines.push("");

  if (visibleFindings.length === 0) {
    lines.push(report.findings.length === 0 ? "No findings." : "No unallowlisted findings. Use --show-allowed to display allowlisted details.");
    return lines.join("\n").trimEnd();
  }

  for (const finding of visibleFindings) {
    const allowedLabel = finding.allowed ? " ALLOWED" : "";
    const rawLabel = finding.severity === finding.effectiveSeverity ? "" : ` (raw ${finding.severity.toUpperCase()})`;
    lines.push(`${finding.effectiveSeverity.toUpperCase()}${rawLabel}${allowedLabel} ${finding.ruleId} ${finding.path}:${finding.line}`);
    lines.push(finding.message);
    lines.push(`File category: ${finding.fileCategory}`);
    lines.push(`Severity reason: ${finding.severityReason}`);
    if (finding.match) {
      lines.push(`Match: ${finding.match}`);
    }
    lines.push(`Recommendation: ${finding.recommendation}`);
    if (finding.allowed) {
      lines.push(`Allowlist reason: ${finding.allowReason}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function formatMarkdown(report, options = {}) {
  const visibleFindings = filterVisibleFindings(report.findings, options);
  const lines = [
    `# ${TOOL_NAME}`,
    "",
    "## Summary",
    "",
    ...formatSummaryLines(report.summary).map((line) => `- ${line}`),
    "",
    "## Findings by Effective Severity",
    "",
    ...formatMarkdownGroup(report.summary.findingsByEffectiveSeverity),
    "",
    "## Findings by Category",
    "",
    ...formatMarkdownGroup(report.summary.findingsByCategory),
    "",
    "## Findings by Rule",
    "",
    ...formatMarkdownGroup(report.summary.findingsByRule),
    "",
    "## Findings by File Category",
    "",
    ...formatMarkdownGroup(report.summary.findingsByFileCategory),
    "",
    "## Top Paths",
    "",
    ...formatMarkdownGroup(report.summary.topPaths),
    "",
    "## Top Downgraded Rules",
    "",
    ...formatMarkdownGroup(report.summary.topDowngradedRules),
    "",
    "## Findings",
    ""
  ];

  if (visibleFindings.length === 0) {
    lines.push(report.findings.length === 0 ? "No findings." : "No unallowlisted findings. Use `--show-allowed` to display allowlisted details.");
    return lines.join("\n");
  }

  for (const finding of visibleFindings) {
    const allowedLabel = finding.allowed ? " allowed" : "";
    const rawLabel = finding.severity === finding.effectiveSeverity ? "" : ` (raw ${finding.severity.toUpperCase()})`;
    lines.push(`### ${finding.effectiveSeverity.toUpperCase()}${rawLabel}${allowedLabel}: ${finding.ruleId}`);
    lines.push("");
    lines.push(`- Path: \`${finding.path}:${finding.line}\``);
    lines.push(`- File category: \`${finding.fileCategory}\``);
    lines.push(`- Severity reason: ${finding.severityReason}`);
    lines.push(`- Match: \`${escapeBackticks(finding.match)}\``);
    lines.push(`- Message: ${finding.message}`);
    lines.push(`- Recommendation: ${finding.recommendation}`);
    if (finding.allowed) {
      lines.push(`- Allowlist reason: ${finding.allowReason}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function formatSummaryLines(summary) {
  return [
    `Scanned files: ${summary.scannedFiles}`,
    `Skipped files: ${summary.skippedFiles}`,
    `Findings: ${summary.findings}`,
    `Allowed findings: ${summary.allowedFindings}`,
    `Unallowed findings: ${summary.unallowedFindings}`,
    `Highest severity: ${summary.highestSeverity}`,
    `Downgraded findings: ${summary.downgradedFindings}`
  ];
}

function filterVisibleFindings(findings, options) {
  return options.showAllowed ? findings : findings.filter((finding) => !finding.allowed);
}

function formatHumanGroup(title, entries) {
  const lines = [`${title}:`];
  if (entries.length === 0) {
    lines.push("  none");
    return lines;
  }

  for (const entry of entries) {
    lines.push(`  ${entry.name}: ${entry.count}`);
  }

  return lines;
}

function formatMarkdownGroup(entries) {
  if (entries.length === 0) {
    return ["- none"];
  }

  return entries.map((entry) => `- ${entry.name}: ${entry.count}`);
}

function escapeBackticks(value) {
  return value.replaceAll("`", "\\`");
}

function shouldFail(summary, failOn) {
  if (!failOn) {
    return false;
  }

  return SEVERITY_RANK[summary.highestSeverity] >= SEVERITY_RANK[failOn] && summary.unallowedFindings > 0;
}

function normalizePath(value) {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function displayPath(filePath, cwd) {
  const relative = path.relative(cwd, filePath);
  if (!relative || relative === "") {
    return ".";
  }

  if (relative.startsWith("..")) {
    return normalizePath(path.resolve(filePath));
  }

  return normalizePath(relative);
}

async function runPackageGate() {
  // TODO Phase 3: implement npm pack --dry-run package boundary analysis here.
  console.log("Package gate is planned for Phase 3 and is not implemented yet.");
}

main().catch((error) => {
  console.error(`${TOOL_NAME} error: ${error.message}`);
  process.exitCode = 2;
});

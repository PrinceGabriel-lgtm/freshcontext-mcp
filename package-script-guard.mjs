#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const SOURCE_CHECKOUT_MESSAGE = [
  "This npm script is for the FreshContext source checkout.",
  "The installed npm package supports `npm start` and the `freshcontext-mcp` binary.",
  "Clone the repository to run tests, demos, trust scans, smoke checks, or development scripts.",
].join(" ");

const commands = {
  build: {
    required: ["src", "tsconfig.json"],
    command: "tsc",
    args: [],
  },
  dev: {
    required: ["src/server.ts"],
    command: "tsx",
    args: ["watch", "src/server.ts"],
  },
  inspect: {
    required: ["src/server.ts"],
    command: "npx",
    args: ["@modelcontextprotocol/inspector", "tsx", "src/server.ts"],
  },
  "example:ha-pri-v2": {
    required: ["examples/ha-pri-v2-example.ts"],
    command: "tsx",
    args: ["examples/ha-pri-v2-example.ts"],
  },
  "demo:arxiv": {
    required: ["examples/evaluate-arxiv-signals.ts"],
    command: "tsx",
    args: ["examples/evaluate-arxiv-signals.ts"],
  },
  "demo:evaluate": {
    required: ["examples/evaluate-with-source-profile.ts"],
    command: "tsx",
    args: ["examples/evaluate-with-source-profile.ts"],
  },
  "demo:evaluate:file": {
    required: ["examples/evaluate-file.ts", "examples/sources.academic.example.json"],
    command: "tsx",
    args: ["examples/evaluate-file.ts", "examples/sources.academic.example.json"],
    passThroughArgs: true,
  },
  "batch:validate": {
    required: ["examples/validate-signal-batch.ts"],
    command: "tsx",
    args: ["examples/validate-signal-batch.ts"],
    passThroughArgs: true,
  },
  "smoke:stdio": {
    required: ["scripts/smoke-stdio.mjs"],
    command: "node",
    args: ["scripts/smoke-stdio.mjs"],
  },
  "trust:gate": {
    required: ["scripts/trust-scan.mjs"],
    command: "node",
    args: ["scripts/trust-scan.mjs", "--path", ".", "--repo-map", "--package-gate", "--claim-check", "--fail-on", "fail"],
  },
  "trust:report": {
    required: ["scripts/trust-scan.mjs"],
    command: "node",
    args: ["scripts/trust-scan.mjs", "--path", ".", "--repo-map", "--package-gate", "--claim-check", "--markdown"],
    passThroughArgs: true,
  },
  "trust:report:json": {
    required: ["scripts/trust-scan.mjs"],
    command: "node",
    args: ["scripts/trust-scan.mjs", "--path", ".", "--repo-map", "--package-gate", "--claim-check", "--json"],
    passThroughArgs: true,
  },
  "trust:scan": {
    required: ["scripts/trust-scan.mjs"],
    command: "node",
    args: ["scripts/trust-scan.mjs"],
    passThroughArgs: true,
  },
  "trust:scan:json": {
    required: ["scripts/trust-scan.mjs"],
    command: "node",
    args: ["scripts/trust-scan.mjs", "--json"],
  },
  "trust:scan:markdown": {
    required: ["scripts/trust-scan.mjs"],
    command: "node",
    args: ["scripts/trust-scan.mjs", "--markdown"],
  },
  test: {
    required: ["tests", "tests/trustScan.test.mjs"],
    command: "tsx",
    args: [
      "--test",
      "tests/freshnessStamp.test.ts",
      "tests/hackernews.test.ts",
      "tests/arxivSignals.test.ts",
      "tests/arxivDecisionIntegration.test.ts",
      "tests/core.test.ts",
      "tests/haPriV2GoldenVectors.test.ts",
      "tests/signalContractExamples.test.ts",
      "tests/batchValidationHarness.test.ts",
      "tests/rank.test.ts",
      "tests/workerEnvelope.test.ts",
      "tests/packageScriptGuard.test.mjs",
      "tests/adapterNetworkBoundary.test.ts",
      "tests/workerRouteSecurity.test.ts",
      "tests/workerCoreEnvelopeParity.test.ts",
      "tests/coreEnvelopeOptions.test.ts",
      "tests/mathSpine.test.ts",
      "tests/coreApiContract.test.ts",
      "tests/corePipeline.test.ts",
      "tests/decision.test.ts",
      "tests/evaluateContextTool.test.ts",
      "tests/restHandler.test.ts",
      "tests/sourceProfiles.test.ts",
      "tests/adapterRegistry.test.ts",
      "tests/trustScan.test.mjs",
    ],
  },
};

const scriptName = process.argv[2];
const config = commands[scriptName];

if (!config) {
  console.error(`Unknown FreshContext package script: ${scriptName ?? "(missing)"}`);
  process.exit(1);
}

const hasSourceCheckoutFiles = config.required.every((path) => existsSync(path));
if (!hasSourceCheckoutFiles) {
  console.log(SOURCE_CHECKOUT_MESSAGE);
  process.exit(0);
}

function resolveCommand(command, args) {
  if (command === "node") return { command: process.execPath, args };

  const localNodeEntrypoints = {
    tsx: join("node_modules", "tsx", "dist", "cli.mjs"),
    tsc: join("node_modules", "typescript", "bin", "tsc"),
  };
  const nodeEntrypoint = localNodeEntrypoints[command];
  if (nodeEntrypoint && existsSync(nodeEntrypoint)) {
    return { command: process.execPath, args: [nodeEntrypoint, ...args] };
  }

  const localBin = process.platform === "win32"
    ? join("node_modules", ".bin", `${command}.cmd`)
    : join("node_modules", ".bin", command);

  if (existsSync(localBin)) return { command: localBin, args };
  if (process.platform === "win32" && !command.endsWith(".cmd")) {
    return { command: `${command}.cmd`, args };
  }
  return { command, args };
}

function validatePassThroughArgs(args) {
  for (const arg of args) {
    if (arg.includes("\0")) {
      console.error("FreshContext package script arguments cannot contain null bytes.");
      process.exit(1);
    }
  }
  return args;
}

const args = [
  ...config.args,
  ...(config.passThroughArgs ? validatePassThroughArgs(process.argv.slice(3)) : []),
];
const invocation = resolveCommand(config.command, args);
const child = spawnSync(invocation.command, invocation.args, {
  stdio: "inherit",
  shell: false,
});

if (child.error) {
  console.error(child.error.message);
  process.exit(1);
}

process.exit(child.status ?? 0);

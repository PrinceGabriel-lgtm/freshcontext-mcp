#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

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
  "smoke:stdio": {
    required: ["scripts/smoke-stdio.mjs"],
    command: "node",
    args: ["scripts/smoke-stdio.mjs"],
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
      "tests/rank.test.ts",
      "tests/workerEnvelope.test.ts",
      "tests/workerCoreEnvelopeParity.test.ts",
      "tests/coreEnvelopeOptions.test.ts",
      "tests/mathSpine.test.ts",
      "tests/coreApiContract.test.ts",
      "tests/corePipeline.test.ts",
      "tests/decision.test.ts",
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

const args = [
  ...config.args,
  ...(config.passThroughArgs ? process.argv.slice(3) : []),
];
const child = spawnSync(config.command, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (child.error) {
  console.error(child.error.message);
  process.exit(1);
}

process.exit(child.status ?? 0);

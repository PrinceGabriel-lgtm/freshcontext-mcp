import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BUILT_IN_ADAPTER_REGISTRY,
  getAdapterDescriptor,
  listAdapterDescriptors,
  listAdaptersByRisk,
  listAdaptersBySourceProfile,
} from "../src/adapters/registry.js";
import type {
  AdapterOutputMode,
  AdapterRisk,
  AdapterRuntimeKind,
  FreshContextAdapterDescriptor,
} from "../src/adapters/registry.js";
import {
  evaluateSignal,
  getSourceProfile,
} from "../src/core/index.js";

function registeredToolNames(): string[] {
  const serverSource = readFileSync("src/server.ts", "utf8");
  return [...serverSource.matchAll(/server\.registerTool\(\s*"([^"]+)"/g)]
    .map((match) => match[1]);
}

test("registry has 21 descriptors", () => {
  assert.equal(BUILT_IN_ADAPTER_REGISTRY.length, 21);
  assert.equal(listAdapterDescriptors().length, 21);
});

test("adapter ids and tool names are unique", () => {
  const descriptors = listAdapterDescriptors();
  const adapterIds = descriptors.map((descriptor) => descriptor.adapter_id);
  const toolNames = descriptors.map((descriptor) => descriptor.tool_name);

  assert.equal(new Set(adapterIds).size, adapterIds.length);
  assert.equal(new Set(toolNames).size, toolNames.length);
});

test("MCP tool registrations preserve one Core judgment front door and 21 source intake tools", () => {
  const descriptors = listAdapterDescriptors();
  const descriptorToolNames = descriptors.map((descriptor) => descriptor.tool_name).sort();
  const toolNames = registeredToolNames().sort();

  assert.equal(toolNames.length, 22);
  assert.deepEqual(toolNames.filter((name) => name === "evaluate_context"), ["evaluate_context"]);
  assert.equal(descriptorToolNames.length, 21);
  assert.equal(descriptorToolNames.includes("evaluate_context"), false);
  assert.deepEqual(toolNames, ["evaluate_context", ...descriptorToolNames].sort());
});

test("every descriptor maps to an existing SourceProfileId", () => {
  for (const descriptor of listAdapterDescriptors()) {
    assert.ok(getSourceProfile(descriptor.source_profile), `${descriptor.adapter_id} should map to a source profile`);
    for (const secondaryProfile of descriptor.secondary_source_profiles ?? []) {
      assert.ok(getSourceProfile(secondaryProfile), `${descriptor.adapter_id} secondary profile should exist`);
    }
  }
});

test("every descriptor carries stable source-intake identity for Signal Contract bridging", () => {
  const outputModes: AdapterOutputMode[] = ["single", "batch", "composite"];
  const runtimeKinds: AdapterRuntimeKind[] = ["api", "browser", "composite", "mixed", "local"];
  const risks: AdapterRisk[] = ["low", "medium", "high"];

  for (const descriptor of listAdapterDescriptors()) {
    assert.match(descriptor.adapter_id, /^[a-z][a-z0-9_]*$/);
    assert.match(descriptor.tool_name, /^[a-z][a-z0-9_]*$/);
    assert.ok(outputModes.includes(descriptor.output_mode));
    assert.ok(runtimeKinds.includes(descriptor.runtime_kind));
    assert.ok(risks.includes(descriptor.risk));
    assert.ok(getSourceProfile(descriptor.source_profile));
  }
});

test("adapter descriptors can describe judgeable candidate context without invoking adapters", () => {
  for (const descriptor of listAdapterDescriptors()) {
    const evaluation = evaluateSignal({
      source: `freshcontext-adapter://${descriptor.tool_name}`,
      source_type: descriptor.adapter_id,
      title: `${descriptor.tool_name} candidate context`,
      content: `Candidate context prepared by ${descriptor.tool_name}.`,
      published_at: null,
      retrieved_at: "2026-05-24T13:00:00.000Z",
      semantic_score: 0.5,
      date_confidence: "unknown",
    }, { now: "2026-05-24T13:00:00.000Z" });

    assert.equal(evaluation.signal.source_type, descriptor.adapter_id);
    assert.equal(evaluation.signal.source, `freshcontext-adapter://${descriptor.tool_name}`);
    assert.equal(evaluation.provenance_readiness.source_identity.completeness, "complete");
    assert.equal(evaluation.provenance_readiness.timing_completeness, "partial");
  }
});

test("extract_arxiv maps to academic_research and low risk", () => {
  const arxiv = getAdapterDescriptor("extract_arxiv");

  assert.ok(arxiv);
  assert.equal(arxiv.adapter_id, "arxiv");
  assert.equal(arxiv.source_profile, "academic_research");
  assert.equal(arxiv.runtime_kind, "api");
  assert.equal(arxiv.risk, "low");
});

test("composite landscape tools are high risk and composite output mode", () => {
  const compositeTools = [
    "extract_landscape",
    "extract_gov_landscape",
    "extract_finance_landscape",
    "extract_company_landscape",
    "extract_idea_landscape",
  ];

  for (const toolName of compositeTools) {
    const descriptor = getAdapterDescriptor(toolName);

    assert.ok(descriptor);
    assert.equal(descriptor.source_profile, "composite_landscape");
    assert.equal(descriptor.output_mode, "composite");
    assert.equal(descriptor.runtime_kind, "composite");
    assert.equal(descriptor.risk, "high");
  }
});

test("search_repos maps to code_activity and low risk", () => {
  const repos = getAdapterDescriptor("search_repos");

  assert.ok(repos);
  assert.equal(repos.adapter_id, "reposearch");
  assert.equal(repos.source_profile, "code_activity");
  assert.equal(repos.risk, "low");
});

test("search_jobs maps to jobs_opportunities", () => {
  const jobs = getAdapterDescriptor("search_jobs");

  assert.ok(jobs);
  assert.equal(jobs.adapter_id, "jobs");
  assert.equal(jobs.source_profile, "jobs_opportunities");
});

test("getAdapterDescriptor works by adapter id and tool name", () => {
  const byId = getAdapterDescriptor("arxiv");
  const byTool = getAdapterDescriptor("extract_arxiv");

  assert.ok(byId);
  assert.ok(byTool);
  assert.deepEqual(byId, byTool);
  assert.equal(getAdapterDescriptor("unknown_adapter"), undefined);
});

test("listAdaptersBySourceProfile works", () => {
  const academic = listAdaptersBySourceProfile("academic_research");
  const official = listAdaptersBySourceProfile("official_docs");

  assert.ok(academic.some((descriptor) => descriptor.tool_name === "extract_arxiv"));
  assert.ok(academic.some((descriptor) => descriptor.tool_name === "extract_scholar"));
  assert.ok(official.some((descriptor) => descriptor.tool_name === "extract_changelog"));
  assert.ok(official.some((descriptor) => descriptor.tool_name === "package_trends"));
});

test("listAdaptersByRisk works", () => {
  const lowRisk = listAdaptersByRisk("low");
  const highRisk = listAdaptersByRisk("high");

  assert.ok(lowRisk.some((descriptor) => descriptor.adapter_id === "arxiv"));
  assert.ok(lowRisk.some((descriptor) => descriptor.adapter_id === "reposearch"));
  assert.ok(highRisk.every((descriptor) => descriptor.output_mode === "composite"));
});

test("registry accessors return copies rather than shared mutable descriptors", () => {
  const first = getAdapterDescriptor("landscape");
  const second = getAdapterDescriptor("landscape");

  assert.ok(first);
  assert.ok(second);
  first.secondary_source_profiles?.push("local_custom");
  first.notes = "mutated";

  assert.equal(second.secondary_source_profiles?.includes("local_custom"), false);
  assert.notEqual(getAdapterDescriptor("landscape")?.notes, "mutated");
});

test("registry metadata does not import MCP, Worker, or runtime modules", () => {
  const registrySource = readFileSync("src/adapters/registry.ts", "utf8");

  assert.doesNotMatch(registrySource, /@modelcontextprotocol|worker\/src|\.\.\/worker|McpServer/);
  assert.doesNotMatch(registrySource, /fetch\(|createServer|listen\(|D1|KV|CACHE/);
});

test("adapter registry public types are consumable", () => {
  const risk: AdapterRisk = "low";
  const outputMode: AdapterOutputMode = "batch";
  const runtimeKind: AdapterRuntimeKind = "api";
  const descriptor: FreshContextAdapterDescriptor | undefined = getAdapterDescriptor("arxiv");

  assert.ok(descriptor);
  assert.equal(descriptor.risk, risk);
  assert.equal(descriptor.output_mode, outputMode);
  assert.equal(descriptor.runtime_kind, runtimeKind);
});

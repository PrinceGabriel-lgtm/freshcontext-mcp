#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function textOf(result) {
  return (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function parseFreshContextJson(text) {
  const match = text.match(/\[FRESHCONTEXT_JSON\]\s*([\s\S]*?)\s*\[\/FRESHCONTEXT_JSON\]/);
  assert(match, "Missing [FRESHCONTEXT_JSON] block");
  return JSON.parse(match[1]);
}

function assertNoMisleadingFailureEnvelope(text, label) {
  const failurePattern =
    /\[(?:error|security)\]|(?:^|\n)(?:error|failed|failure|timeout|upstream)\b|Yahoo Finance API error|query1\.finance\.yahoo\.com|\b(?:HTTP|status|error)\s*:?\s*(?:401|403|404|429|5\d\d)\b|\b(?:401|403|404|429|5\d\d)\b[^\n]*(?:error|failed|failure|timeout)/i;
  if (failurePattern.test(text)) {
    assert(!/Confidence:\s*high/i.test(text), `${label}: failure content must not be Confidence: high`);
    assert(!/Score:\s*100\/100/i.test(text), `${label}: failure content must not be Score: 100/100`);
  }
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(root, "dist/server.js")],
  cwd: root,
  stderr: "pipe",
});

const client = new Client({ name: "freshcontext-smoke", version: "0.0.0" });

try {
  await client.connect(transport);

  const serverVersion = client.getServerVersion();
  assert(serverVersion?.version === pkg.version, `serverInfo.version ${serverVersion?.version} !== package.json ${pkg.version}`);

  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name).sort();
  assert(names.length === 22, `Expected 22 tools, got ${names.length}: ${names.join(", ")}`);
  assert(names.includes("evaluate_context"), "Missing evaluate_context");
  assert(names.includes("extract_hackernews"), "Missing extract_hackernews");
  assert(names.includes("extract_finance"), "Missing extract_finance");

  const evaluateContext = textOf(await client.callTool({
    name: "evaluate_context",
    arguments: {
      profile: "academic_research",
      intent: "citation_check",
      now: "2026-05-24T13:00:00.000Z",
      signals: [
        {
          title: "Fresh research source",
          content: "A relevant academic source with a reliable publication date.",
          source: "https://arxiv.org/abs/2605.12345",
          source_type: "arxiv",
          published_at: "2026-05-24T12:00:00.000Z",
          retrieved_at: "2026-05-24T13:00:00.000Z",
          semantic_score: 0.94,
          date_confidence: "high",
        },
      ],
    },
  }));
  assert(/FreshContext evaluate_context/.test(evaluateContext), "evaluate_context missing title");
  assert(/Decision:\s+Cite as primary/i.test(evaluateContext), "evaluate_context missing decision-first output");
  assert(/\[FRESHCONTEXT_EVALUATION_JSON\]/.test(evaluateContext), "evaluate_context missing structured JSON block");

  const hnText = textOf(await client.callTool({
    name: "extract_hackernews",
    arguments: { url: "browser agents", max_length: 2000 },
  }));
  assert(!/Invalid URL|Expected string to match URL/i.test(hnText), "HN text query failed URL validation");
  assert(/\[FRESHCONTEXT\]/.test(hnText), "HN text query missing FreshContext envelope");
  parseFreshContextJson(hnText);

  const hnUrl = textOf(await client.callTool({
    name: "extract_hackernews",
    arguments: { url: "https://news.ycombinator.com/news", max_length: 2000 },
  }));
  const hnJson = parseFreshContextJson(hnUrl);
  const hnDate = hnJson.freshcontext.content_date;
  if (hnDate) {
    assert(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\s+\d+/.test(hnDate), "HN date contains malformed ISO + epoch suffix");
    assert(!Number.isNaN(new Date(hnDate).getTime()), `HN date is not valid ISO: ${hnDate}`);
    assert(typeof hnJson.freshcontext.freshness_score === "number", "HN dated result should have numeric freshness_score");
  }

  const finance = textOf(await client.callTool({
    name: "extract_finance",
    arguments: { url: "MSFT", max_length: 2000 },
  }));
  assert(!/Yahoo Finance API error|query1\.finance\.yahoo\.com|\[MSFT\].*401|Yahoo 401/i.test(finance), "Finance still exposes Yahoo 401 path");
  assertNoMisleadingFailureEnvelope(finance, "finance MSFT");
  let financeStatus = "ok";
  if (/\[FRESHCONTEXT_JSON\]/.test(finance)) {
    assert(/source:\s*stooq/i.test(finance), "Finance output missing source: stooq");
    parseFreshContextJson(finance);
  } else {
    assert(/\[Error\]/i.test(finance), "Finance output missing FreshContext JSON block and explicit error marker");
    assert(/source=stooq|Stooq/i.test(finance), "Finance upstream failure missing Stooq source marker");
    financeStatus = "upstream_unavailable";
  }

  const financeFailure = textOf(await client.callTool({
    name: "extract_finance",
    arguments: { url: "NO_SUCH_TICKER_123456789", max_length: 2000 },
  }));
  assertNoMisleadingFailureEnvelope(financeFailure, "finance failure");

  console.log(JSON.stringify({
    ok: true,
    package_version: pkg.version,
    server_version: serverVersion.version,
    tool_count: names.length,
    finance_status: financeStatus,
  }, null, 2));
} finally {
  await client.close();
}

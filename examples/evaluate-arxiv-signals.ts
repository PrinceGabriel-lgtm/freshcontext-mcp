import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { searchArxivSignals } from "../src/adapters/arxiv.js";
import {
  evaluateSignals,
  getSourceProfile,
  interpretEvaluations,
} from "../src/core/index.js";
import type {
  ContextDecisionResult,
  CoreSignalEvaluationResult,
} from "../src/core/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, "fixtures/arxiv-sample.xml");
const FIXTURE_XML = readFileSync(FIXTURE_PATH, "utf8");
const NOW = "2026-06-02T12:00:00.000Z";

const profile = getSourceProfile("academic_research");
if (!profile) {
  throw new Error("Built-in academic_research source profile is missing.");
}

function installFixtureFetch(): () => void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => new Response(FIXTURE_XML, {
    status: 200,
    headers: { "Content-Type": "application/atom+xml" },
  });

  return () => {
    globalThis.fetch = originalFetch;
  };
}

function pct(value: number | null | undefined): string {
  return typeof value === "number" ? String(value) : "null";
}

function score(value: number): string {
  return value.toFixed(3);
}

function printResult(
  result: CoreSignalEvaluationResult,
  decision: ContextDecisionResult,
  index: number
): void {
  console.log(`${index + 1}. ${result.signal.title ?? "Untitled arXiv source"}`);
  console.log(`   Decision: ${decision.label}`);
  console.log(`   Meaning: ${decision.meaning}`);
  console.log(`   Action: ${decision.action}`);

  if (decision.warnings.length > 0) {
    console.log(`   Warnings: ${decision.warnings.join("; ")}`);
  }

  console.log(`   Source: ${result.signal.source}`);
  console.log(`   Freshness: ${pct(result.freshness_score)}`);
  console.log(`   Rank score: ${score(result.ranked.final_score)}`);
  console.log(`   Utility: ${score(result.utility.score)}`);
  console.log(`   Confidence: ${result.ranked.confidence}`);
  console.log(`   Why: ${result.explanation}`);
  console.log("");
}

async function main(): Promise<void> {
  const restoreFetch = installFixtureFetch();

  try {
    const signals = await searchArxivSignals({
      query: "freshness-ranked context selection",
      retrievedAt: NOW,
      semanticScore: 0.96,
    });
    const evaluations = evaluateSignals(signals, {
      now: NOW,
      defaultSourceType: "arxiv",
    });
    const decisions = interpretEvaluations(evaluations, {
      sourceProfile: profile,
      intentProfile: "citation_check",
    });

    console.log("arXiv signal extraction demo");
    console.log("arXiv XML -> FreshContext signals -> Core decisions");
    console.log("");
    console.log(`Profile: ${profile.profile_id}`);
    console.log(`Purpose: ${profile.purpose}`);
    console.log("");
    console.log("Decision-ready arXiv context:");
    console.log("");

    evaluations.forEach((result, index) => printResult(result, decisions[index], index));
  } finally {
    restoreFetch();
  }
}

await main();

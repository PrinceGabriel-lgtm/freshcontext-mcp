import {
  evaluateSignals,
  getSourceProfile,
} from "../src/core/index.js";
import type {
  CoreSignalEvaluationResult,
  FreshContextSignalInput,
} from "../src/core/index.js";

const NOW = "2026-05-24T13:00:00.000Z";

const profile = getSourceProfile("academic_research");
if (!profile) {
  throw new Error("Built-in academic_research source profile is missing.");
}

const candidates: FreshContextSignalInput[] = [
  {
    id: "paper_recent",
    source: "https://arxiv.org/abs/2605.12345",
    source_type: "arxiv",
    title: "Fresh benchmark for temporal retrieval in agent systems",
    content: "A recent paper about temporal retrieval evaluation for agent context systems.",
    published_at: "2026-05-20T09:00:00.000Z",
    retrieved_at: NOW,
    semantic_score: 0.94,
    date_confidence: "high",
    status: "success",
    metadata: { profile_id: profile.profile_id },
  },
  {
    id: "paper_foundational",
    source: "https://scholar.example.edu/foundational-context-aging",
    source_type: "google_scholar",
    title: "Foundational study on information aging and relevance",
    content: "Older but highly relevant research about how information value changes over time.",
    published_at: "2022-03-15T00:00:00.000Z",
    retrieved_at: NOW,
    semantic_score: 0.88,
    date_confidence: "high",
    status: "success",
    metadata: { profile_id: profile.profile_id },
  },
  {
    id: "paper_unknown_date",
    source: "https://research.example.org/context-notes",
    source_type: "google_scholar",
    title: "Useful context notes with missing publication date",
    content: "Relevant notes, but the publication date is missing and should be treated cautiously.",
    published_at: null,
    retrieved_at: NOW,
    semantic_score: 0.78,
    date_confidence: "unknown",
    status: "success",
    metadata: { profile_id: profile.profile_id },
  },
  {
    id: "paper_failed",
    source: "https://research.example.org/blocked-paper",
    source_type: "arxiv",
    title: "Blocked source that should not look fresh",
    content: "[ERROR] upstream timeout while retrieving paper metadata",
    published_at: "2026-05-21T09:00:00.000Z",
    retrieved_at: NOW,
    semantic_score: 0.2,
    date_confidence: "high",
    status: "success",
    metadata: { profile_id: profile.profile_id },
  },
];

function pct(value: number | null | undefined): string {
  return typeof value === "number" ? String(value) : "null";
}

function score(value: number): string {
  return value.toFixed(3);
}

function printResult(result: CoreSignalEvaluationResult, index: number): void {
  console.log(`${index + 1}. ${result.signal.title ?? "Untitled source"}`);
  console.log(`   Source: ${result.signal.source}`);
  console.log(`   Freshness: ${pct(result.freshness_score)}`);
  console.log(`   Final score: ${score(result.ranked.final_score)}`);
  console.log(`   Utility: ${score(result.utility.score)}`);
  console.log(`   Confidence: ${result.ranked.confidence}`);
  console.log(`   Why: ${result.explanation}`);

  if (result.reasons.length > 0) {
    console.log(`   Warnings: ${result.reasons.join("; ")}`);
  }
  console.log("");
}

const evaluated = evaluateSignals(candidates, {
  now: NOW,
  defaultSourceType: profile.source_types[0],
});

console.log("FreshContext local evaluate demo");
console.log("Raw candidate context goes in; FreshContext ranks what deserves to reach the model first.");
console.log("");
console.log(`Profile: ${profile.profile_id}`);
console.log(`Purpose: ${profile.purpose}`);
console.log(`Authority: ${profile.authority_hint}`);
console.log(`Date policy: ${profile.date_policy}`);
console.log(`Failure policy: ${profile.failure_policy}`);
console.log(`Half-life: ${profile.half_life_hours} hours`);
console.log("");
console.log("Ranked context:");
console.log("");

evaluated.forEach(printResult);

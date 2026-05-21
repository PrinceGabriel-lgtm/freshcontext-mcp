import test from "node:test";
import assert from "node:assert/strict";
import {
  LAMBDA,
  calculateContextUtility,
  calculateFreshnessScore,
} from "../src/core/index.js";
import workerIntelligence from "../worker/src/intelligence.ts";

const {
  applyDecay,
  generateAuditSig,
  scoreSignal,
} = workerIntelligence;

const ONE_HOUR_MS = 60 * 60 * 1000;

function isoHoursBefore(retrievedAt: string, hours: number): string {
  return new Date(new Date(retrievedAt).getTime() - hours * ONE_HOUR_MS).toISOString();
}

function assertAround(actual: number, expected: number, tolerance: number): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

function withFixedNow<T>(fixedIso: string, fn: () => T): T {
  const originalNow = Date.now;
  Date.now = () => new Date(fixedIso).getTime();
  try {
    return fn();
  } finally {
    Date.now = originalNow;
  }
}

async function expectedAuditSig(resultId: string, contentHash: string): Promise<string> {
  const input = `${resultId}:${contentHash}:FRESHCONTEXT_DAR_V1`;
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

test("Core DAR freshness reaches half score at ln(2) / lambda", () => {
  const adapter = "hackernews";
  const lambda = LAMBDA[adapter];
  const halfLifeHours = Math.log(2) / lambda;
  const retrievedAt = "2026-05-21T12:00:00.000Z";
  const publishedAt = isoHoursBefore(retrievedAt, halfLifeHours);

  const score = calculateFreshnessScore(publishedAt, retrievedAt, adapter);

  assert.equal(score, 50);
});

test("Core context utility uses the same half-life decay factor", () => {
  const lambda = LAMBDA.hackernews;
  const halfLifeHours = Math.log(2) / lambda;

  const utility = calculateContextUtility({
    contextualRelevance: 80,
    lambda,
    ageHours: halfLifeHours,
    dateConfidence: "high",
    status: "success",
  });

  assertAround(utility.decayFactor, 0.5, 1e-12);
  assertAround(utility.score, 40, 1e-10);
});

test("Core context utility gives zero utility to failed or unknown-date signals", () => {
  const base = {
    contextualRelevance: 90,
    lambda: LAMBDA.hackernews,
    ageHours: 1,
  };

  const failed = calculateContextUtility({
    ...base,
    dateConfidence: "high",
    status: "failed",
  });
  const unknownDate = calculateContextUtility({
    ...base,
    dateConfidence: "unknown",
    status: "success",
  });

  assert.equal(failed.score, 0);
  assert.match(failed.reasons.join(" "), /failed/);
  assert.equal(unknownDate.score, 0);
  assert.match(unknownDate.reasons.join(" "), /unknown/);
});

test("Worker DAR applyDecay is deterministic around the documented half-life", () => {
  const adapter = "hackernews";
  const halfLifeHours = Math.log(2) / LAMBDA[adapter];
  const now = "2026-05-21T12:00:00.000Z";
  const publishedAt = isoHoursBefore(now, halfLifeHours);

  const decayed = withFixedNow(now, () => applyDecay(100, publishedAt, adapter));

  assert.equal(decayed.rt, 50);
  assert.equal(decayed.entropy, "stable");
  assert.equal(decayed.is_expired, false);
});

test("Worker DAR treats missing and meaningfully future timestamps as half-life old", () => {
  const adapter = "hackernews";
  const now = "2026-05-21T12:00:00.000Z";
  const futurePublishedAt = new Date(new Date(now).getTime() + 24 * ONE_HOUR_MS).toISOString();
  const missingDate = withFixedNow(now, () => applyDecay(100, null, adapter));
  const futureDate = withFixedNow(now, () => applyDecay(100, futurePublishedAt, adapter));

  assert.equal(missingDate.rt, 50);
  assert.equal(futureDate.rt, 50);
  assert.equal(missingDate.entropy, "stable");
  assert.equal(futureDate.entropy, "stable");
});

test("Worker Ha-Pri signature matches the current documented formula", async () => {
  const resultId = "sr_test";
  const contentHash = "abc123";

  const sig = await generateAuditSig(resultId, contentHash);

  assert.equal(sig, await expectedAuditSig(resultId, contentHash));
  assert.match(sig, /^[a-f0-9]{64}$/);
});

test("Worker scoreSignal keeps explicit error output from scoring relevant or fresh", async () => {
  const score = await scoreSignal({
    resultId: "sr_error",
    contentHash: "errorhash",
    raw: "[ERROR] upstream timeout while fetching source content",
    adapter: "hackernews",
    profile: {
      id: "profile_test",
      name: "Test",
      targets: ["unrelated target"],
      skills: ["unrelated skill"],
      location: "remote",
    },
  });

  assert.equal(score.base_score, 0);
  assert.equal(score.rt_score, 0);
  assert.equal(score.relevancy_score, 0);
  assert.equal(score.is_relevant, 0);
  assert.equal(score.is_expired, 1);
  assert.match(score.ha_pri_sig, /^[a-f0-9]{64}$/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const FIXTURE = "examples/batches/signal-contract-v1.academic.json";
const REPLAY_FIXTURES = [
  {
    path: "examples/batches/signal-contract-v1.academic.json",
    profile: "academic_research",
    intent: "citation_check",
    total: 12,
  },
  {
    path: "examples/batches/signal-contract-v1.official-docs.json",
    profile: "official_docs",
    intent: "developer_adoption",
    total: 12,
  },
  {
    path: "examples/batches/signal-contract-v1.rag-vendors.json",
    profile: "company_intel",
    intent: "business_due_diligence",
    total: 12,
  },
  {
    path: "examples/batches/signal-contract-v1.jobs.json",
    profile: "jobs_opportunities",
    intent: "job_search",
    total: 12,
  },
  {
    path: "examples/batches/signal-contract-v1.mixed-agent-handoff.json",
    profile: "composite_landscape",
    intent: "developer_adoption",
    total: 12,
  },
] as const;

function runBatch(path: string) {
  return spawnSync(
    process.execPath,
    ["package-script-guard.mjs", "batch:validate", "--", path],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    }
  );
}

function writeTempJson(value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "freshcontext-batch-"));
  const path = join(dir, "batch.json");
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
  return path;
}

function baseBatch(overrides: Record<string, unknown> = {}) {
  return {
    profile: "academic_research",
    intent: "citation_check",
    now: "2026-06-09T12:00:00.000Z",
    signals: [
      {
        title: "Useful current source",
        content: "A relevant current source with a clear timestamp.",
        source: "https://example.com/source",
        source_type: "arxiv",
        published_at: "2026-06-08T12:00:00.000Z",
        retrieved_at: "2026-06-09T12:00:00.000Z",
        semantic_score: 0.9,
      },
    ],
    ...overrides,
  };
}

function extractStructured(stdout: string) {
  const match = stdout.match(/\[FRESHCONTEXT_BATCH_JSON\]\n([\s\S]+?)\n\[\/FRESHCONTEXT_BATCH_JSON\]/);
  assert.ok(match, "expected structured batch JSON block");
  return JSON.parse(match[1]);
}

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

function sumAnomalies(counts: Record<string, number>): number {
  return Object.entries(counts)
    .filter(([key]) => key !== "failed_status")
    .reduce((sum, [, count]) => sum + count, 0);
}

function assertHumanReviewSummary(structured: any, expectLabels: boolean): void {
  assert.ok(structured.human_review, "expected human_review summary");
  const review = structured.human_review;

  assert.equal(review.labeled_signals + review.unlabeled_signals, structured.total_signals);
  assert.equal(review.label_match_count + review.label_mismatch_count, review.labeled_signals);

  if (expectLabels) {
    assert.ok(review.labeled_signals > 0, "expected fixture to include human labels");
    assert.equal(typeof review.label_match_rate, "number");
  } else {
    assert.equal(review.labeled_signals, 0);
    assert.equal(review.label_match_rate, null);
  }

  assert.ok(Array.isArray(review.mismatches));
  for (const mismatch of review.mismatches) {
    assert.equal(typeof mismatch.index, "number");
    assert.equal(typeof mismatch.title, "string");
    assert.equal(typeof mismatch.source, "string");
    assert.equal(typeof mismatch.expected_decision, "string");
    assert.equal(typeof mismatch.actual_decision, "string");
    assert.equal(typeof mismatch.review_note, "string");
    assert.equal(typeof mismatch.reason, "string");
  }
}

test("all replay fixtures run through the batch harness", () => {
  for (const fixture of REPLAY_FIXTURES) {
    const result = runBatch(fixture.path);
    assert.equal(result.status, 0, `${fixture.path}\n${result.stderr}`);

    const structured = extractStructured(result.stdout);
    assert.equal(structured.profile, fixture.profile);
    assert.equal(structured.intent, fixture.intent);
    assert.equal(structured.total_signals, fixture.total);
    assert.equal(sumCounts(structured.decision_counts), fixture.total);
    assert.ok(sumCounts(structured.status_counts) >= fixture.total);
    assert.ok(sumCounts(structured.date_confidence_counts) >= fixture.total);
    assert.ok(structured.top_results.length > 0);
    assert.ok(
      Object.values(structured.decision_counts).some((count) => Number(count) > 0),
      `${fixture.path} should produce at least one decision`
    );
    assert.ok(
      sumAnomalies(structured.anomaly_counts) > 0 || structured.anomaly_counts.failed_status > 0,
      `${fixture.path} should include at least one intentional anomaly`
    );
    assertHumanReviewSummary(structured, true);
  }
});

test("batch validation fixture exits 0 and prints a decision-ready summary", () => {
  const result = runBatch(FIXTURE);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /FreshContext Signal Contract batch validation/);
  assert.match(result.stdout, /Candidate context batch -> Core evaluation -> decision-ready context/);
  assert.match(result.stdout, /Status counts:/);
  assert.match(result.stdout, /Date confidence counts:/);
  assert.match(result.stdout, /Decision counts:/);
  assert.match(result.stdout, /Anomaly counts:/);
  assert.match(result.stdout, /Top decision-ready results:/);
  assert.match(result.stdout, /\[FRESHCONTEXT_BATCH_JSON\]/);
});

test("batch validation fixture reports mixed anomaly and decision counts", () => {
  const result = runBatch(FIXTURE);
  const structured = extractStructured(result.stdout);

  assert.equal(structured.total_signals, 12);
  assert.equal(structured.profile, "academic_research");
  assert.equal(structured.intent, "citation_check");
  assert.equal(structured.anomaly_counts.missing_date, 1);
  assert.equal(structured.anomaly_counts.invalid_timestamp, 1);
  assert.equal(structured.anomaly_counts.future_timestamp, 1);
  assert.equal(structured.anomaly_counts.clamped_semantic_score, 2);
  assert.equal(structured.anomaly_counts.failed_status, 1);
  assert.ok(structured.decision_counts.cite_as_primary >= 1);
  assert.ok(structured.decision_counts.needs_verification >= 1);
  assert.ok(structured.decision_counts.exclude >= 1);
  assert.ok(structured.top_results.length > 0);
  assertHumanReviewSummary(structured, true);
});

test("batch validation rejects unknown source profiles", () => {
  const result = runBatch(writeTempJson(baseBatch({ profile: "unknown_profile" })));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /profile "unknown_profile" is not a built-in Source Profile/);
});

test("batch validation rejects unsupported intents", () => {
  const result = runBatch(writeTempJson(baseBatch({ intent: "write_me_a_trade" })));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /intent "write_me_a_trade" is not supported/);
});

test("batch validation rejects unsupported expected human decisions", () => {
  const result = runBatch(writeTempJson(baseBatch({
    signals: [
      {
        title: "Useful current source",
        content: "A relevant current source with a clear timestamp.",
        source: "https://example.com/source",
        source_type: "arxiv",
        published_at: "2026-06-08T12:00:00.000Z",
        retrieved_at: "2026-06-09T12:00:00.000Z",
        semantic_score: 0.9,
        expected_decision: "looks_good_to_me",
      },
    ],
  })));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /expected_decision must be a supported FreshContext decision label/);
});

test("batch validation keeps stable human_review output when no labels are present", () => {
  const result = runBatch(writeTempJson(baseBatch()));
  assert.equal(result.status, 0, result.stderr);

  const structured = extractStructured(result.stdout);
  assertHumanReviewSummary(structured, false);
});

test("batch validation rejects missing, non-array, and empty signals", () => {
  const missing = runBatch(writeTempJson(baseBatch({ signals: undefined })));
  const nonArray = runBatch(writeTempJson(baseBatch({ signals: { source: "https://example.com" } })));
  const empty = runBatch(writeTempJson(baseBatch({ signals: [] })));

  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /signals must be an array/);
  assert.notEqual(nonArray.status, 0);
  assert.match(nonArray.stderr, /signals must be an array/);
  assert.notEqual(empty.status, 0);
  assert.match(empty.stderr, /signals must include at least one candidate context item/);
});

test("batch validation harness avoids host and retrieval runtime terms", () => {
  const source = readFileSync("examples/validate-signal-batch.ts", "utf8");

  assert.doesNotMatch(source, /fetch\(|readdir|createServer|listen\(/);
  assert.doesNotMatch(source, /McpServer|WebStandardStreamableHTTPServerTransport|worker\/src|\.\.\/worker/);
  assert.doesNotMatch(source, /\bD1\b|\bKV\b|\bCACHE\b|retrieve\(|Operator/);
});

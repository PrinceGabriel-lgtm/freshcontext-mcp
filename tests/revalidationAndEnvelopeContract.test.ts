import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ENVELOPE_CONTENT_LENGTH,
  clampEnvelopeMaxLength,
  computeRevalidateAfter,
  computeVerdictRevalidateAfter,
  evaluateSignal,
  getSourceProfile,
  interpretEvaluation,
  normalizeSignal,
} from "../src/core/index.js";
import { handleRestRequest } from "../src/rest/handler.js";

const SIGNAL = {
  source: "https://arxiv.org/abs/2401.00001",
  title: "A paper",
  content: "body",
  published_at: "2026-09-01T00:00:00.000Z",
  retrieved_at: "2026-09-14T00:00:00.000Z",
  source_type: "arxiv",
  status: "ok" as const,
  date_confidence: "high" as const,
  id: "sig-1",
};

// ── The two clocks ──────────────────────────────────────────────────────────
// These answer different questions and must not collapse into one another. If a
// refactor ever makes them agree for an input whose anchors differ, that is the
// bug this test exists to catch.

test("content clock is anchored at content_date, verdict clock at evaluated_at", () => {
  const profile = getSourceProfile("academic_research");
  const contentClock = computeRevalidateAfter(
    SIGNAL.published_at,
    SIGNAL.retrieved_at,
    SIGNAL.source_type
  );
  const verdictClock = computeVerdictRevalidateAfter("2026-09-14T00:00:00.000Z", profile);

  assert.ok(contentClock, "content clock should resolve for a dated signal");
  assert.ok(verdictClock, "verdict clock should resolve with a source profile");
  assert.notEqual(
    contentClock,
    verdictClock,
    "the two clocks must not produce the same instant from different anchors"
  );
});

test("content clock may point into the past; verdict clock never does", () => {
  const ancient = computeRevalidateAfter(
    "2020-01-01T00:00:00.000Z",
    "2026-09-14T00:00:00.000Z",
    "arxiv"
  );
  assert.ok(ancient);
  assert.ok(
    new Date(ancient).getTime() < new Date("2026-09-14T00:00:00.000Z").getTime(),
    "content published long ago crossed the staleness line in the past"
  );

  const verdict = computeVerdictRevalidateAfter(
    "2026-09-14T00:00:00.000Z",
    getSourceProfile("academic_research")
  );
  assert.ok(verdict);
  assert.ok(
    new Date(verdict).getTime() > new Date("2026-09-14T00:00:00.000Z").getTime(),
    "a verdict is always valid for some period after it is reached"
  );
});

test("verdict clock is null without a source profile basis, never fabricated", () => {
  assert.equal(computeVerdictRevalidateAfter("2026-09-14T00:00:00.000Z", undefined), null);
});

test("the verdict clock helper is reachable from the public Core surface", () => {
  assert.equal(typeof computeVerdictRevalidateAfter, "function");
  // The content clock stays exported under its original name: it has been public
  // since 0.3.21 and renaming it would break installed consumers.
  assert.equal(typeof computeRevalidateAfter, "function");
});

// ── The envelope cap ────────────────────────────────────────────────────────
// Negative control: this fails before the pipeline path adopts the shared clamp.

test("clampEnvelopeMaxLength is the single cap implementation", () => {
  assert.equal(clampEnvelopeMaxLength(undefined), 8000, "default is unchanged");
  assert.equal(clampEnvelopeMaxLength(0), 0, "explicit zero is honoured");
  assert.equal(clampEnvelopeMaxLength(500), 500);
  assert.equal(clampEnvelopeMaxLength(9e9), MAX_ENVELOPE_CONTENT_LENGTH);
  assert.equal(clampEnvelopeMaxLength(Number.POSITIVE_INFINITY), 8000, "non-finite falls back");
});

test("an extreme envelopeMaxLength cannot exceed the cap on the evaluation path", () => {
  const result = evaluateSignal(
    normalizeSignal({ ...SIGNAL, content: "X".repeat(60000) }),
    { includeEnvelope: true, envelopeMaxLength: 9e9 }
  );
  assert.ok(result.envelope, "envelope requested");
  assert.equal(
    result.envelope.context.content.length,
    MAX_ENVELOPE_CONTENT_LENGTH,
    "pipeline envelope must honour MAX_ENVELOPE_CONTENT_LENGTH"
  );
});

test("both envelope constructors agree on the cap", async () => {
  const { stampFreshness } = await import("../src/core/envelope.js");
  const long = "X".repeat(60000);
  const stamped = stampFreshness(
    { raw: long, content_date: SIGNAL.published_at, freshness_confidence: "high" },
    { url: SIGNAL.source, maxLength: 9e9 },
    "arxiv"
  );
  const piped = evaluateSignal(normalizeSignal({ ...SIGNAL, content: long }), {
    includeEnvelope: true,
    envelopeMaxLength: 9e9,
  });
  assert.equal(stamped.content.length, piped.envelope?.context.content.length);
});

// ── The REST option contract ────────────────────────────────────────────────

const postEvaluate = async (body: unknown) => {
  const res = await handleRestRequest(
    new Request("https://example.test/v1/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

test("an unknown option key never reaches Core", async () => {
  const { json } = await postEvaluate({
    signal: SIGNAL,
    options: { includeEnvelope: true, notARealOption: "surprise", __proto__: { polluted: true } },
  });
  assert.ok(json.envelope, "recognised options still apply");
  assert.equal(
    JSON.stringify(json).includes("notARealOption"),
    false,
    "unrecognised keys must be dropped, not forwarded"
  );
});

test("the deterministic reference clock remains supported over REST", async () => {
  const undated = { ...SIGNAL, retrieved_at: undefined };
  const a = await postEvaluate({ signal: undated, options: { now: "2026-09-14T00:00:00.000Z" } });
  const b = await postEvaluate({ signal: undated, options: { now: "2026-09-14T00:00:00.000Z" } });
  assert.equal(
    (a.json.signal as Record<string, unknown>).retrieved_at,
    "2026-09-14T00:00:00.000Z",
    "now sets the evaluation reference clock"
  );
  assert.deepEqual(a.json.freshness_score, b.json.freshness_score, "same clock, same answer");
});

test("a malformed reference clock is ignored rather than honoured", async () => {
  const { json } = await postEvaluate({ signal: SIGNAL, options: { now: "not-a-date" } });
  assert.equal(json.freshness_score !== undefined, true, "request still succeeds");
});

test("caller-asserted engineVersion is echoed but is not a server attestation", async () => {
  const { json } = await postEvaluate({
    signal: SIGNAL,
    options: {
      includeProvenance: true,
      provenance: { resultId: "caller-1", engineVersion: "9.9.9-asserted" },
    },
  });
  const provenance = json.provenance as Record<string, unknown> | undefined;
  assert.ok(provenance, "provenance is produced when engineVersion is supplied");
  assert.equal(provenance.engineVersion, "9.9.9-asserted", "echoed back to the caller");
  // The value is carried in a keyless digest the caller can recompute. It is not a
  // FreshContext service-version claim and never reaches a server-signed record
  // through this route: the evaluate routes receive no ledger binding at all.
  assert.equal(typeof provenance.haPriSigV2, "string");
});

test("the evaluate route exposes no secret-shaped material", async () => {
  const { json } = await postEvaluate({ signal: SIGNAL, options: { includeProvenance: true, provenance: { resultId: "r", engineVersion: "v" } } });
  assert.equal(/FC_HMAC|PRIVATE KEY|_SECRET/i.test(JSON.stringify(json)), false);
});

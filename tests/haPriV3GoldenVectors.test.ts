import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildHaPriPayload,
  buildHaPriPayloadV3,
  sha256Hex,
} from "../src/core/index.js";
import type {
  HaPriV2Input,
  HaPriV3Input,
} from "../src/core/index.js";

interface V3GoldenExpected {
  canonicalContentSha256: string;
  semanticFingerprintSha256: string;
  signingPayload: string;
}

interface V3GoldenVector {
  name: string;
  input: HaPriV3Input;
  expected: V3GoldenExpected;
}

interface V3GoldenFixture {
  schema: string;
  validVectors: V3GoldenVector[];
}

const fixture = JSON.parse(
  readFileSync("tests/fixtures/ha-pri-v3-golden-vectors.json", "utf8")
) as V3GoldenFixture;

function validVector(name: string): V3GoldenVector {
  const vector = fixture.validVectors.find((v) => v.name === name);
  assert.ok(vector, `missing v3 golden vector: ${name}`);
  return vector;
}

// ─── Fixture structure ────────────────────────────────────────────────────────

test("Ha-Pri v3 golden fixture covers expected cases", () => {
  assert.equal(fixture.schema, "freshcontext.ha_pri_v3.golden.v1");
  assert.equal(fixture.validVectors.length, 2);
  assert.ok(fixture.validVectors.some((v) => v.input.decision === "use_first"));
  assert.ok(fixture.validVectors.some((v) => v.input.decision === "exclude"));
  assert.ok(fixture.validVectors.some((v) => v.input.semanticFingerprint === null));
});

// ─── Golden vector parity — the primary deliverable of Brick 2 ───────────────
//
// signingPayload in each fixture vector was computed via:
//   node -e "const {createHash}=require('crypto'); ..."
// BEFORE this test was written. The test asserts the implementation produces the
// same string — not that it agrees with itself on first run.

test("Ha-Pri v3 golden vectors produce the exact pinned signing payload", () => {
  for (const vector of fixture.validVectors) {
    const result = buildHaPriPayloadV3(vector.input);
    const second = buildHaPriPayloadV3(vector.input);
    assert.equal(result, second, `${vector.name}: must be deterministic`);
    assert.equal(result, vector.expected.signingPayload, `${vector.name}: must match pinned payload`);
  }
});

// ─── Header distinction — v3 must not produce a v2 payload ───────────────────

test("Ha-Pri v3 payload starts with FRESHCONTEXT_HA_PRI_V3, not V2", () => {
  for (const vector of fixture.validVectors) {
    const payload = buildHaPriPayloadV3(vector.input);
    assert.ok(payload.startsWith("FRESHCONTEXT_HA_PRI_V3\n"), `${vector.name}: wrong header`);
    assert.ok(!payload.startsWith("FRESHCONTEXT_HA_PRI_V2"), `${vector.name}: must not start with V2 header`);
  }
});

// ─── v2/v3 parity guard — same base content must produce different payloads ──
//
// This is the invariant that makes v2 and v3 non-interchangeable: a HMAC over a
// v3 payload cannot be replayed as a valid v2 signature and vice versa.

test("Ha-Pri v3 payload differs from v2 payload for the same base content", () => {
  const v3vector = validVector("v3 full fields use_first");
  const v2input: HaPriV2Input = {
    resultId: v3vector.input.resultId,
    rawContent: v3vector.input.rawContent,
    semanticFingerprint: v3vector.input.semanticFingerprint,
    adapter: v3vector.input.adapter,
    publishedAt: v3vector.input.publishedAt,
    retrievedAt: v3vector.input.retrievedAt,
    engineVersion: v3vector.input.engineVersion,
  };
  const v2payload = buildHaPriPayload(v2input);
  const v3payload = buildHaPriPayloadV3(v3vector.input);
  assert.notEqual(v2payload, v3payload, "v2 and v3 payloads must differ for the same content");
  assert.notEqual(sha256Hex(v2payload), sha256Hex(v3payload), "v2 and v3 payload hashes must differ");
});

// ─── Field coverage — verdict_id and decision bind to the signed bytes ────────

test("Ha-Pri v3 payload changes when verdict_id is changed", () => {
  const base = validVector("v3 full fields use_first");
  const tampered: HaPriV3Input = { ...base.input, verdictId: "a".repeat(64) };
  const original = buildHaPriPayloadV3(base.input);
  const tampered_payload = buildHaPriPayloadV3(tampered);
  assert.notEqual(original, tampered_payload, "different verdict_id must produce different payload");
});

test("Ha-Pri v3 payload changes when decision is changed", () => {
  const base = validVector("v3 full fields use_first");
  const tampered: HaPriV3Input = { ...base.input, decision: "exclude" };
  const original = buildHaPriPayloadV3(base.input);
  const tampered_payload = buildHaPriPayloadV3(tampered);
  assert.notEqual(original, tampered_payload, "different decision must produce different payload");
});

// ─── Null field handling — null sentinel passthrough ─────────────────────────

test("Ha-Pri v3 null optional fields produce 'null' sentinel in payload", () => {
  const nullVector = validVector("v3 null optional fields exclude");
  const payload = buildHaPriPayloadV3(nullVector.input);
  assert.ok(payload.includes("published_at=null"), "null publishedAt must appear as sentinel");
  assert.ok(payload.includes("retrieved_at=null"), "null retrievedAt must appear as sentinel");
  assert.ok(payload.includes("semantic_fingerprint_sha256=74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b"),
    "null semanticFingerprint must hash as sha256('null')");
});

// ─── Field order — 10 lines, verdict_id and decision at end ──────────────────

test("Ha-Pri v3 payload has 10 lines with verdict_id at line 9 and decision at line 10", () => {
  const vector = validVector("v3 full fields use_first");
  const lines = buildHaPriPayloadV3(vector.input).split("\n");
  assert.equal(lines.length, 10, "v3 payload must have exactly 10 lines");
  assert.equal(lines[0], "FRESHCONTEXT_HA_PRI_V3");
  assert.ok(lines[8].startsWith("verdict_id="), `line 9 must be verdict_id, got: ${lines[8]}`);
  assert.ok(lines[9].startsWith("decision="), `line 10 must be decision, got: ${lines[9]}`);
});

// ─── v2 is provably untouched — v2 vectors still produce expected payloads ───
//
// This test verifies v2 golden vector 1 to guarantee buildHaPriPayload was not
// modified during this brick. The full v2 suite runs separately; this is the guard.

test("Ha-Pri v2 buildHaPriPayload is untouched by Brick 2 (v3 additive check)", () => {
  const v2input: HaPriV2Input = {
    resultId: "fc-test-001",
    rawContent: "Canonical test content for FreshContext.\nSecond line with evidence.",
    semanticFingerprint: "academic retrieval evaluation context",
    adapter: "arxiv",
    publishedAt: "2026-05-20T00:00:00.000Z",
    retrievedAt: "2026-06-09T12:00:00.000Z",
    engineVersion: "0.3.19",
  };
  const expected = "FRESHCONTEXT_HA_PRI_V2\nresult_id=fc-test-001\ncanonical_content_sha256=9f4e132a2f45f5694e782f3f6bfcd6f5234f718e398100392244ae260f803a07\nsemantic_fingerprint_sha256=6f8ba42b67507f500f2b88e3aa740e88d8db696e93430f31eb7d76525a37844c\nadapter=arxiv\npublished_at=2026-05-20T00:00:00.000Z\nretrieved_at=2026-06-09T12:00:00.000Z\nengine_version=0.3.19";
  assert.equal(buildHaPriPayload(v2input), expected, "v2 golden vector 1 must be unchanged");
});

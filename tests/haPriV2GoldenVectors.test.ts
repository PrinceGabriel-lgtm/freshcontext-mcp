import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  calculateHaPriV2,
  canonicalizeHaPriContent,
  sha256Hex,
  verifyHaPriV2,
} from "../src/core/index.js";
import type {
  HaPriV2Input,
  HaPriVerificationStatus,
} from "../src/core/index.js";

interface GoldenExpected {
  canonicalContent: string;
  canonicalContentSha256: string;
  semanticFingerprintSha256: string;
  signingPayload: string;
  haPriSigV2: string;
  verifyStatus: HaPriVerificationStatus;
}

interface GoldenVector {
  name: string;
  input: HaPriV2Input;
  expected: GoldenExpected;
}

interface TamperVector {
  name: string;
  baseVector: string;
  tamperField: keyof HaPriV2Input;
  tamperValue: string | null;
  expectedVerifyStatus: HaPriVerificationStatus;
}

interface StoredSignatureVector {
  name: string;
  baseVector: string;
  actualSig: string | null;
  expectedVerifyStatus: HaPriVerificationStatus;
}

interface GoldenFixture {
  schema: string;
  validVectors: GoldenVector[];
  tamperVectors: TamperVector[];
  storedSignatureVectors: StoredSignatureVector[];
}

const fixture = JSON.parse(
  readFileSync("tests/fixtures/ha-pri-v2-golden-vectors.json", "utf8")
) as GoldenFixture;

function validVector(name: string): GoldenVector {
  const vector = fixture.validVectors.find((candidate) => candidate.name === name);
  assert.ok(vector, `missing golden vector: ${name}`);
  return vector;
}

test("Ha-Pri v2 golden fixture covers deterministic provenance cases", () => {
  assert.equal(fixture.schema, "freshcontext.ha_pri_v2.golden.v1");
  assert.equal(fixture.validVectors.length, 3);
  assert.equal(fixture.tamperVectors.length, 6);
  assert.equal(fixture.storedSignatureVectors.length, 3);

  assert.ok(fixture.validVectors.some((vector) => vector.name.includes("whitespace-normalized")));
  assert.ok(fixture.validVectors.some((vector) => vector.name.includes("whitespace-only")));
  assert.ok(fixture.tamperVectors.some((vector) => vector.tamperField === "rawContent"));
  assert.ok(fixture.tamperVectors.some((vector) => vector.tamperField === "semanticFingerprint"));
  assert.ok(fixture.tamperVectors.some((vector) => vector.tamperField === "adapter"));
  assert.ok(fixture.tamperVectors.some((vector) => vector.tamperField === "publishedAt"));
  assert.ok(fixture.tamperVectors.some((vector) => vector.tamperField === "retrievedAt"));
  assert.ok(fixture.tamperVectors.some((vector) => vector.tamperField === "engineVersion"));
});

test("Ha-Pri v2 golden vectors match exact canonical material and signatures", () => {
  for (const vector of fixture.validVectors) {
    const first = calculateHaPriV2(vector.input);
    const second = calculateHaPriV2(vector.input);
    const verification = verifyHaPriV2(vector.input, vector.expected.haPriSigV2);

    assert.deepEqual(first, second, `${vector.name} should be deterministic`);
    assert.equal(canonicalizeHaPriContent(vector.input.rawContent), vector.expected.canonicalContent);
    assert.equal(sha256Hex(vector.expected.canonicalContent), vector.expected.canonicalContentSha256);
    assert.equal(first.canonicalContentSha256, vector.expected.canonicalContentSha256);
    assert.equal(first.semanticFingerprintSha256, vector.expected.semanticFingerprintSha256);
    assert.equal(first.signingPayload, vector.expected.signingPayload);
    assert.equal(first.haPriSigV2, vector.expected.haPriSigV2);
    assert.equal(first.haPriSigV2, sha256Hex(first.signingPayload));
    assert.equal(verification.status, vector.expected.verifyStatus);
    assert.equal(verification.expected, vector.expected.haPriSigV2);
    assert.equal(verification.actual, vector.expected.haPriSigV2);
  }
});

test("Ha-Pri v2 whitespace golden vector freezes canonicalization behavior", () => {
  const whitespace = validVector("valid whitespace-normalized payload");
  const whitespaceOnly = validVector("valid whitespace-only content payload");

  assert.equal(whitespace.expected.canonicalContent, "Alpha evidence line\nBeta evidence\nGamma evidence");
  assert.equal(canonicalizeHaPriContent(whitespace.input.rawContent), whitespace.expected.canonicalContent);
  assert.equal(whitespaceOnly.expected.canonicalContent, "\n");
  assert.equal(canonicalizeHaPriContent(whitespaceOnly.input.rawContent), "\n");
});

test("Ha-Pri v2 golden tamper vectors verify as invalid", () => {
  for (const vector of fixture.tamperVectors) {
    const base = validVector(vector.baseVector);
    const tampered: HaPriV2Input = { ...base.input };
    tampered[vector.tamperField] = vector.tamperValue as never;

    const verification = verifyHaPriV2(tampered, base.expected.haPriSigV2);

    assert.equal(verification.status, vector.expectedVerifyStatus, vector.name);
    assert.equal(verification.actual, base.expected.haPriSigV2);
    assert.match(verification.reasons.join(" "), /did not match/);
  }
});

test("Ha-Pri v2 stored signature vectors keep unknown and invalid behavior stable", () => {
  for (const vector of fixture.storedSignatureVectors) {
    const base = validVector(vector.baseVector);
    const verification = verifyHaPriV2(base.input, vector.actualSig);

    assert.equal(verification.status, vector.expectedVerifyStatus, vector.name);
    assert.equal(verification.actual, vector.actualSig);
    if (vector.expectedVerifyStatus === "unknown") {
      assert.equal(verification.expected, null);
      assert.match(verification.reasons.join(" "), /missing/);
    } else {
      assert.equal(verification.expected, base.expected.haPriSigV2);
      assert.match(verification.reasons.join(" "), /did not match/);
    }
  }
});

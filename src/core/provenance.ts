import { createHash } from "node:crypto";
import type {
  HaPriV2Input,
  HaPriV2Result,
  HaPriV2VerificationResult,
} from "./types.js";

const HA_PRI_V2_VERSION = "FRESHCONTEXT_HA_PRI_V2" as const;
const NULL_SENTINEL = "null";

function fieldValue(value: string | null | undefined): string {
  return value ?? NULL_SENTINEL;
}

export function canonicalizeHaPriContent(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function calculateHaPriV2(input: HaPriV2Input): HaPriV2Result {
  const canonicalContentSha256 = sha256Hex(canonicalizeHaPriContent(input.rawContent));
  const semanticFingerprintSha256 = sha256Hex(fieldValue(input.semanticFingerprint));
  const resultId = fieldValue(input.resultId);
  const adapter = fieldValue(input.adapter);
  const publishedAt = fieldValue(input.publishedAt);
  const retrievedAt = fieldValue(input.retrievedAt);
  const engineVersion = fieldValue(input.engineVersion);

  const signingPayload = [
    HA_PRI_V2_VERSION,
    `result_id=${resultId}`,
    `canonical_content_sha256=${canonicalContentSha256}`,
    `semantic_fingerprint_sha256=${semanticFingerprintSha256}`,
    `adapter=${adapter}`,
    `published_at=${publishedAt}`,
    `retrieved_at=${retrievedAt}`,
    `engine_version=${engineVersion}`,
  ].join("\n");

  return {
    version: HA_PRI_V2_VERSION,
    resultId,
    canonicalContentSha256,
    semanticFingerprintSha256,
    adapter,
    publishedAt,
    retrievedAt,
    engineVersion,
    signingPayload,
    haPriSigV2: sha256Hex(signingPayload),
  };
}

export function verifyHaPriV2(
  input: HaPriV2Input,
  actualSig: string | null | undefined
): HaPriV2VerificationResult {
  if (actualSig === null || actualSig === undefined || actualSig.trim() === "") {
    return {
      status: "unknown",
      expected: null,
      actual: actualSig ?? null,
      reasons: ["missing ha_pri_sig_v2; verification status unknown"],
    };
  }

  const expected = calculateHaPriV2(input).haPriSigV2;
  if (actualSig === expected) {
    return {
      status: "valid",
      expected,
      actual: actualSig,
      reasons: [],
    };
  }

  return {
    status: "invalid",
    expected,
    actual: actualSig,
    reasons: ["stored ha_pri_sig_v2 did not match recomputed signature"],
  };
}

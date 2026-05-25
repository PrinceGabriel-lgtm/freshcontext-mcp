// FreshContext Ha-Pri v2 developer fixture.
//
// This example demonstrates the pure Core helper only. It does not touch D1,
// change Worker behavior, deploy Ha-Pri v2, or wire v2 into production output.
// It shows the three verification states: valid, invalid, and unknown.

import { calculateHaPriV2, verifyHaPriV2 } from "../src/core/index.js";

const input = {
  resultId: "result_demo_001",
  rawContent: "FreshContext demo signal\r\nStatus: usable  ",
  semanticFingerprint: "freshcontext-demo|https://example.com/demo|2026-05-25",
  adapter: "demo",
  publishedAt: "2026-05-25T08:00:00.000Z",
  retrievedAt: "2026-05-25T09:00:00.000Z",
  engineVersion: "freshcontext-ha-pri-v2-demo",
};

const result = calculateHaPriV2(input);
const valid = verifyHaPriV2(input, result.haPriSigV2);
const invalid = verifyHaPriV2(
  { ...input, rawContent: `${input.rawContent}\nTampered: true` },
  result.haPriSigV2
);
const unknown = verifyHaPriV2(input, undefined);

console.log(JSON.stringify({
  canonicalContentSha256: result.canonicalContentSha256,
  semanticFingerprintSha256: result.semanticFingerprintSha256,
  signingPayload: result.signingPayload,
  haPriSigV2: result.haPriSigV2,
  verification: {
    valid: valid.status,
    invalid: invalid.status,
    unknown: unknown.status,
  },
}, null, 2));

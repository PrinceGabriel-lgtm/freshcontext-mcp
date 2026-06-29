import test, { describe, before } from "node:test";
import assert from "node:assert/strict";
import workerIntelligence from "../worker/src/intelligence.ts";
import { handleRestRequest } from "../src/rest/handler.js";

const { hmacSha256 } = workerIntelligence;

// Pinned v3 golden vector 1 signing payload (proven stable by haPriV3GoldenVectors.test.ts).
// Using a pinned string decouples this test from buildHaPriPayloadV3 — we're testing the
// verify endpoint's behavior given known inputs, not the payload builder.
const KNOWN_PAYLOAD =
  "FRESHCONTEXT_HA_PRI_V3\n" +
  "result_id=fc-v3-001\n" +
  "canonical_content_sha256=9f4e132a2f45f5694e782f3f6bfcd6f5234f718e398100392244ae260f803a07\n" +
  "semantic_fingerprint_sha256=6f8ba42b67507f500f2b88e3aa740e88d8db696e93430f31eb7d76525a37844c\n" +
  "adapter=arxiv\n" +
  "published_at=2026-05-20T00:00:00.000Z\n" +
  "retrieved_at=2026-06-09T12:00:00.000Z\n" +
  "engine_version=0.3.23\n" +
  "verdict_id=cb1a2b1e64fc1814de0b4c4c8bf7c33c36f8da2aa0a06d0088baf23d98ee2a85\n" +
  "decision=use_first";

// Test key: obviously fake, committed only for test purposes. Never used in production.
const TEST_KEY = "freshcontext-test-hmac-key-do-not-use-in-production";

function verifyRequest(body: unknown): Request {
  return new Request("https://freshcontext.test/v1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/v1/verify stateless endpoint", () => {
  let knownSig: string;

  before(async () => {
    // knownSig is computed dynamically rather than pinned. hmacSigning.test.ts already pins
    // the HMAC function's correctness against a Node createHmac ground truth; here we're
    // testing the endpoint's routing and comparison logic, not the HMAC function itself.
    knownSig = await hmacSha256(TEST_KEY, KNOWN_PAYLOAD);
  });

  test("valid signature → status:valid, empty reasons", async () => {
    const r = await handleRestRequest(
      verifyRequest({ signing_payload: KNOWN_PAYLOAD, signature: knownSig }),
      TEST_KEY
    );
    const body = await r.json() as { status: string; reasons: string[] };
    assert.equal(r.status, 200);
    assert.equal(body.status, "valid");
    assert.deepEqual(body.reasons, []);
  });

  test("tampered payload (decision changed) → status:invalid", async () => {
    const tampered = KNOWN_PAYLOAD.replace("decision=use_first", "decision=exclude");
    const r = await handleRestRequest(
      verifyRequest({ signing_payload: tampered, signature: knownSig }),
      TEST_KEY
    );
    const body = await r.json() as { status: string; reasons: string[] };
    assert.equal(r.status, 200);
    assert.equal(body.status, "invalid");
    assert.ok(body.reasons.length > 0, "invalid response must include at least one reason");
  });

  test("correct payload but wrong signature → status:invalid", async () => {
    const wrongSig = "a".repeat(64);
    const r = await handleRestRequest(
      verifyRequest({ signing_payload: KNOWN_PAYLOAD, signature: wrongSig }),
      TEST_KEY
    );
    const body = await r.json() as { status: string; reasons: string[] };
    assert.equal(r.status, 200);
    assert.equal(body.status, "invalid");
  });

  test("missing signature field → status:unknown", async () => {
    const r = await handleRestRequest(
      verifyRequest({ signing_payload: KNOWN_PAYLOAD }),
      TEST_KEY
    );
    const body = await r.json() as { status: string; reasons: string[] };
    assert.equal(r.status, 200);
    assert.equal(body.status, "unknown");
    assert.ok(
      body.reasons.some((s) => s.toLowerCase().includes("signature")),
      "unknown reason must mention signature"
    );
  });

  test("empty string signature → status:unknown", async () => {
    const r = await handleRestRequest(
      verifyRequest({ signing_payload: KNOWN_PAYLOAD, signature: "" }),
      TEST_KEY
    );
    const body = await r.json() as { status: string; reasons: string[] };
    assert.equal(r.status, 200);
    assert.equal(body.status, "unknown");
  });

  test("null signature → status:unknown", async () => {
    const r = await handleRestRequest(
      verifyRequest({ signing_payload: KNOWN_PAYLOAD, signature: null }),
      TEST_KEY
    );
    const body = await r.json() as { status: string; reasons: string[] };
    assert.equal(r.status, 200);
    assert.equal(body.status, "unknown");
  });

  test("no hmacSecret configured → status:unknown with secret reason", async () => {
    const r = await handleRestRequest(
      verifyRequest({ signing_payload: KNOWN_PAYLOAD, signature: knownSig })
      // intentionally omitting second argument — secret undefined
    );
    const body = await r.json() as { status: string; reasons: string[] };
    assert.equal(r.status, 200);
    assert.equal(body.status, "unknown");
    assert.ok(
      body.reasons.some((s) => s.toLowerCase().includes("secret")),
      "unknown reason must mention secret"
    );
  });

  test("missing signing_payload → 400 invalid_request", async () => {
    const r = await handleRestRequest(
      verifyRequest({ signature: knownSig }),
      TEST_KEY
    );
    const body = await r.json() as { error: { code: string } };
    assert.equal(r.status, 400);
    assert.equal(body.error.code, "invalid_request");
  });

  test("empty signing_payload → 400 invalid_request", async () => {
    const r = await handleRestRequest(
      verifyRequest({ signing_payload: "", signature: knownSig }),
      TEST_KEY
    );
    const body = await r.json() as { error: { code: string } };
    assert.equal(r.status, 400);
    assert.equal(body.error.code, "invalid_request");
  });

  test("non-POST method → 405 method_not_allowed", async () => {
    const r = await handleRestRequest(
      new Request("https://freshcontext.test/v1/verify", { method: "GET" }),
      TEST_KEY
    );
    assert.equal(r.status, 405);
  });

  test("SERVICE_VERSION not substituted: old engine_version in payload validates correctly", async () => {
    // Proves the verify endpoint never consults the local SERVICE_VERSION constant.
    // If it did, a payload with engine_version=0.1.0 would fail even with a correct signature
    // (the recomputed payload would differ). Here we construct such a payload and verify it
    // validates correctly, proving the endpoint treats the payload as opaque bytes.
    const oldVersionPayload = KNOWN_PAYLOAD.replace("engine_version=0.3.23", "engine_version=0.1.0");
    const oldVersionSig = await hmacSha256(TEST_KEY, oldVersionPayload);
    const r = await handleRestRequest(
      verifyRequest({ signing_payload: oldVersionPayload, signature: oldVersionSig }),
      TEST_KEY
    );
    const body = await r.json() as { status: string };
    assert.equal(body.status, "valid", "verify must accept any engine_version, not just the local constant");
  });
});

import { SELF } from "cloudflare:test";
import { describe, expect, test } from "vitest";
import {
  ED25519_SIGNATURE_VERSION,
  appendEd25519Attestations,
  buildHaPriPayloadV4,
  keyIdFromV4Payload,
  signEd25519,
  verifyEd25519,
} from "../src/ed25519Attestation.js";

const KEY_ID = "fc-test-2026-09";
const PRIVATE_KEY_B64 = "MC4CAQAwBQYDK2VwBCIEICysCF/82Ccv4o4HQf4xJdYoGC8FfpFbcQrgfZUonk5q";
const PUBLIC_KEY_B64 = "MCowBQYDK2VwAyEAWaIFrc+B+rHA/Sk5Fco3UWUq2wuBHGsU/fDgWLXmvaE=";

const V3_PAYLOAD = [
  "FRESHCONTEXT_HA_PRI_V3",
  "result_id=fc-e2-test-001",
  "canonical_content_sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "semantic_fingerprint_sha256=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "adapter=arxiv",
  "published_at=2026-09-01T00:00:00.000Z",
  "retrieved_at=2026-09-10T00:00:00.000Z",
  "engine_version=0.5.1",
  "verdict_id=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "decision=use_first",
].join("\n");

function postVerify(body: unknown): Request {
  return new Request("https://freshcontext.test/v1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("E-2 Ed25519 attestation primitives", () => {
  test("signatures verify offline with only the published public key", async () => {
    const payload = buildHaPriPayloadV4(V3_PAYLOAD, KEY_ID);
    const signature = await signEd25519(PRIVATE_KEY_B64, payload);

    expect(keyIdFromV4Payload(payload)).toBe(KEY_ID);
    expect(await verifyEd25519(PUBLIC_KEY_B64, payload, signature)).toBe(true);
    expect(await verifyEd25519(PUBLIC_KEY_B64, `${payload}\ntampered=true`, signature)).toBe(false);
  });

  test("additive V4 block signs the exact embedded decision-bound payload", async () => {
    const legacy = [
      "[FRESHCONTEXT_SIG_V3]",
      "algo=HMAC-SHA256",
      `item=1 result_id=fc-e2-test-001 verdict_id=${"c".repeat(64)} sig=${"d".repeat(64)} payload=${JSON.stringify(V3_PAYLOAD)}`,
      "[/FRESHCONTEXT_SIG_V3]",
    ].join("\n");

    const upgraded = await appendEd25519Attestations(legacy, {
      FC_ED25519_KEY_ID: KEY_ID,
      FC_ED25519_PRIVATE_KEY_B64: PRIVATE_KEY_B64,
      FC_ED25519_PUBLIC_KEY_B64: PUBLIC_KEY_B64,
    });

    expect(upgraded).toContain("[FRESHCONTEXT_SIG_V4]");
    expect(upgraded).toContain("algo=Ed25519");
    expect(upgraded).toContain(`key_id=${KEY_ID}`);

    const v4 = upgraded.slice(upgraded.indexOf("[FRESHCONTEXT_SIG_V4]"));
    const line = v4.split("\n").find((candidate) => candidate.startsWith("item=1 ") && candidate.includes(" payload="));
    expect(line).toBeTruthy();
    const marker = " payload=";
    const payloadAt = line!.indexOf(marker);
    const left = line!.slice(0, payloadAt);
    const sigMatch = left.match(/ sig=([^ ]+)$/);
    expect(sigMatch).toBeTruthy();
    const payload = JSON.parse(line!.slice(payloadAt + marker.length)) as string;
    expect(payload.startsWith(`${ED25519_SIGNATURE_VERSION}\n`)).toBe(true);
    expect(await verifyEd25519(PUBLIC_KEY_B64, payload, sigMatch![1])).toBe(true);
  });
});

describe("E-2 mounted Worker surface", () => {
  test("publishes the active Ed25519 verification key", async () => {
    const response = await SELF.fetch("https://freshcontext.test/.well-known/freshcontext-signing-keys.json");
    expect(response.status).toBe(200);
    const body = await response.json() as {
      schema: string;
      algorithm: string;
      keys: Array<{ key_id: string; public_key_spki_b64: string; status: string }>;
    };
    expect(body.schema).toBe("freshcontext.signing-keys.v1");
    expect(body.algorithm).toBe("Ed25519");
    expect(body.keys).toContainEqual(expect.objectContaining({
      key_id: KEY_ID,
      public_key_spki_b64: PUBLIC_KEY_B64,
      status: "active",
    }));
  });

  test("/v1/verify accepts V4 without the private key or HMAC recomputation", async () => {
    const payload = buildHaPriPayloadV4(V3_PAYLOAD, KEY_ID);
    const signature = await signEd25519(PRIVATE_KEY_B64, payload);

    const response = await SELF.fetch(postVerify({
      signing_payload: payload,
      signature,
      signature_version: ED25519_SIGNATURE_VERSION,
      key_id: KEY_ID,
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as {
      status: string;
      signature_version: string;
      algorithm: string;
      key_id: string;
    };
    expect(body.status).toBe("valid");
    expect(body.signature_version).toBe(ED25519_SIGNATURE_VERSION);
    expect(body.algorithm).toBe("Ed25519");
    expect(body.key_id).toBe(KEY_ID);
  });

  test("/v1/verify rejects a tampered V4 payload", async () => {
    const payload = buildHaPriPayloadV4(V3_PAYLOAD, KEY_ID);
    const signature = await signEd25519(PRIVATE_KEY_B64, payload);
    const tampered = payload.replace("decision=use_first", "decision=exclude");

    const response = await SELF.fetch(postVerify({ signing_payload: tampered, signature }));
    const body = await response.json() as { status: string };
    expect(body.status).toBe("invalid");
  });
});

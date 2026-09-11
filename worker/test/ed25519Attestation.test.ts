import { env, SELF } from "cloudflare:test";
import { describe, expect, test } from "vitest";
import {
  ED25519_SIGNATURE_VERSION,
  activeSigningConfig,

  buildHaPriPayloadV4,
  keyIdFromV4Payload,
  signEd25519,
  verifyEd25519,
} from "../src/ed25519Attestation.js";

// Read from the Worker's own bindings, never restated here. vitest.config.mts generates
// a fresh Ed25519 keypair per run, so no private key material exists in the repository —
// and these tests exercise the exact key the Worker under test is configured with rather
// than a copy that could drift from it.
const KEY_ID = env.FC_ED25519_KEY_ID as string;
const PRIVATE_KEY_B64 = env.FC_ED25519_PRIVATE_KEY_B64 as string;
const PUBLIC_KEY_B64 = env.FC_ED25519_PUBLIC_KEY_B64 as string;

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

  // NOTE: the test that used to sit here drove appendEd25519Attestations — the wrapper's
  // scrape-own-output-and-re-sign path, deleted in this change. It is not being dropped
  // silently: worker.ts now signs V4 inline alongside V2/V3, and the behaviour that
  // actually matters (a V4 row reaching the ledger and verifying through /v1/verify
  // Mode 2) is covered end to end in verifyRoute.test.ts, which exercises the real
  // Worker against a real D1 rather than a hand-built string.
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
      verification_method: string;
      issuer_attested?: boolean;
      key_id: string;
    };
    expect(body.status).toBe("valid");
    expect(body.signature_version).toBe(ED25519_SIGNATURE_VERSION);
    expect(body.key_id).toBe(KEY_ID);
    // The field that matters to a caller: this result is independently verifiable,
    // not something FreshContext attested to under a secret only FreshContext holds.
    expect(body.verification_method).toBe("ed25519");
    expect(body.issuer_attested).toBeUndefined();
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

// ─── E-2 §8 — rotation, and the guards that keep an unsigned row out of the ledger ───
describe("E-2 key rotation", () => {
  const RETIRED_KEY_ID = "fc-test-ephemeral-retired";
  const RETIRED_PRIVATE_KEY_B64 = env.TEST_RETIRED_PRIVATE_KEY_B64 as string;

  // Keys are append-only. A rotated key is never removed from the published document,
  // because every verdict ever signed under it must stay verifiable — otherwise the
  // ledger quietly loses its history the moment you rotate, which is the opposite of
  // what an append-only ledger is for.
  test("a verdict signed under a RETIRED key still verifies", async () => {
    const payload = buildHaPriPayloadV4(V3_PAYLOAD, RETIRED_KEY_ID);
    const signature = await signEd25519(RETIRED_PRIVATE_KEY_B64, payload);

    const response = await SELF.fetch(postVerify({ signing_payload: payload, signature }));
    const body = await response.json() as {
      status: string; key_id: string; verification_method: string;
    };
    expect(body.status).toBe("valid");
    expect(body.key_id).toBe(RETIRED_KEY_ID);
    expect(body.verification_method).toBe("ed25519");
  });

  test("the published document serves the retired key alongside the active one", async () => {
    const response = await SELF.fetch("https://freshcontext.test/.well-known/freshcontext-signing-keys.json");
    const body = await response.json() as {
      keys: Array<{ key_id: string; status: string; public_key_spki_b64: string }>;
    };
    const active = body.keys.find((k) => k.key_id === KEY_ID);
    const retired = body.keys.find((k) => k.key_id === RETIRED_KEY_ID);

    expect(active?.status).toBe("active");
    expect(retired?.status).toBe("retired");
    // Distinct key material, or "rotation" would be a rename.
    expect(retired?.public_key_spki_b64).not.toBe(active?.public_key_spki_b64);
  });

  test("a retired key cannot verify a verdict signed under the ACTIVE key", async () => {
    // Rotation must not make the two keys interchangeable. Signed with active, relabelled
    // retired: the key_id is inside the signed bytes, so this has to fail.
    const payload = buildHaPriPayloadV4(V3_PAYLOAD, KEY_ID);
    const signature = await signEd25519(PRIVATE_KEY_B64, payload);
    const relabelled = payload.replace(`key_id=${KEY_ID}`, `key_id=${RETIRED_KEY_ID}`);

    const response = await SELF.fetch(postVerify({ signing_payload: relabelled, signature }));
    const body = await response.json() as { status: string };
    expect(body.status).toBe("invalid");
  });
});

describe("E-2 signing guards — never an unsigned or mislabelled ledger row", () => {
  // worker.ts only signs V4 when activeSigningConfig() returns a complete set. If it
  // returns null the row stays V3/HMAC, which is honest; what must never happen is a row
  // labelled V4 that nothing can verify. These pin the three ways it can be incomplete.
  const COMPLETE = {
    FC_ED25519_KEY_ID: KEY_ID,
    FC_ED25519_PRIVATE_KEY_B64: PRIVATE_KEY_B64,
    FC_ED25519_PUBLIC_KEY_B64: PUBLIC_KEY_B64,
  };

  test("a complete configuration is accepted", () => {
    expect(activeSigningConfig(COMPLETE)?.keyId).toBe(KEY_ID);
  });

  // Derived from COMPLETE rather than restating the three binding names as literals.
  // Self-maintaining — a fourth required binding is covered the moment it is added here —
  // and it drops a line of three long SCREAMING_SNAKE strings that GitGuardian's
  // generic-high-entropy heuristic read as a secret assignment. The finding was a false
  // positive, but deriving the list is the better code regardless.
  for (const missing of Object.keys(COMPLETE) as Array<keyof typeof COMPLETE>) {
    test(`${missing} absent → no signing config, so the row stays V3/HMAC`, () => {
      const partial = { ...COMPLETE, [missing]: undefined };
      expect(activeSigningConfig(partial)).toBeNull();
    });
  }

  test("a malformed key_id is refused rather than smuggled into the payload", () => {
    expect(activeSigningConfig({ ...COMPLETE, FC_ED25519_KEY_ID: "has spaces and \n newlines" })).toBeNull();
    // A key_id carrying a newline would forge extra payload lines, since the payload is
    // newline-delimited. buildHaPriPayloadV4 rejects it too, belt and braces.
    expect(() => buildHaPriPayloadV4(V3_PAYLOAD, "evil\nkey_id=other")).toThrow();
  });

  // This is what the writer's try/catch is for: signing configured but the key material
  // unusable. worker.ts logs and drops the row rather than inserting one whose signature
  // cannot be reproduced. E-2 §8: never an unsigned insert.
  test("unusable private key material rejects instead of producing a bad signature", async () => {
    await expect(signEd25519("not-base64-at-all-!!!", "payload")).rejects.toThrow();
    await expect(signEd25519(PUBLIC_KEY_B64, "payload")).rejects.toThrow();
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── E-2 §7 — the offline verification deliverable ─────────────────────────────
//
// E-2's acceptance criterion 1 is: "a stranger, with no FreshContext account and no
// network access to the Worker, can verify a verdict." These tests are that stranger.
// They run the SHIPPED scripts as real subprocesses against a real signature and assert
// on the process exit code, because that is exactly what a third party would do.
//
// Nothing here imports the verifiers as modules or reimplements their logic: a test that
// checked a copy of the algorithm would prove the algorithm agrees with itself, which is
// the one thing already guaranteed.

const NODE_VERIFIER = "scripts/verify-offline.mjs";
const PY_VERIFIER = "scripts/verify_offline.py";
const KEY_ID = "fc-test-offline";

// A V4 payload with the exact shape worker.ts writes: the V4 header, the V3 body, then
// key_id and signature_algorithm.
function buildV4Payload(keyId: string): string {
  return [
    "FRESHCONTEXT_HA_PRI_V4",
    "result_id=fc-offline-001",
    `canonical_content_sha256=${"a".repeat(64)}`,
    `semantic_fingerprint_sha256=${"b".repeat(64)}`,
    "adapter=arxiv",
    "published_at=2026-09-01T00:00:00.000Z",
    "retrieved_at=2026-09-10T00:00:00.000Z",
    "engine_version=0.5.1",
    `verdict_id=${"c".repeat(64)}`,
    "decision=use_first",
    `key_id=${keyId}`,
    "signature_algorithm=Ed25519",
  ].join("\n");
}

interface Fixture {
  dir: string;
  payloadPath: string;
  signaturePath: string;
  keysPath: string;
  payload: string;
  signatureB64Url: string;
}

function makeFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "fc-offline-"));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");

  const payload = buildV4Payload(KEY_ID);
  // Signed the way the Worker signs, then written out base64url the way it emits.
  const signature = nodeSign(null, Buffer.from(payload, "utf8"), privateKey);
  const signatureB64Url = signature
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  const keys = {
    schema: "freshcontext.signing-keys.v1",
    algorithm: "Ed25519",
    keys: [
      {
        key_id: KEY_ID,
        algorithm: "Ed25519",
        public_key_spki_b64: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
        status: "active",
      },
      // A second, genuinely published key. Without it, a key_id swap would fail at
      // lookup rather than at signature check — which proves the wrong thing.
      {
        key_id: "fc-test-offline-other",
        algorithm: "Ed25519",
        public_key_spki_b64: generateKeyPairSync("ed25519")
          .publicKey.export({ type: "spki", format: "der" })
          .toString("base64"),
        status: "retired",
      },
    ],
  };

  const payloadPath = join(dir, "verdict.payload");
  const signaturePath = join(dir, "verdict.sig");
  const keysPath = join(dir, "keys.json");
  writeFileSync(payloadPath, payload);
  writeFileSync(signaturePath, signatureB64Url);
  writeFileSync(keysPath, JSON.stringify(keys, null, 2));

  return { dir, payloadPath, signaturePath, keysPath, payload, signatureB64Url };
}

function runVerifier(script: string, fixture: Fixture, payloadPath?: string): number {
  const isPython = script.endsWith(".py");
  const result = spawnSync(
    isPython ? "python3" : process.execPath,
    [
      script,
      "--payload", payloadPath ?? fixture.payloadPath,
      "--signature-file", fixture.signaturePath,
      "--keys", fixture.keysPath,
    ],
    { encoding: "utf8" }
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function withTamperedPayload(fixture: Fixture, from: string, to: string): string {
  const path = join(fixture.dir, `tampered-${Buffer.from(to).toString("hex").slice(0, 8)}.payload`);
  writeFileSync(path, fixture.payload.replace(from, to));
  return path;
}

test("E-2 §7 — offline verification of a FreshContext attestation", async (t) => {
  const fixture = makeFixture();

  // The cross-implementation check. §8 calls this "the test that proves independence —
  // the others only prove self-consistency". One signature, two unrelated verifiers:
  // Node's OpenSSL-backed Ed25519, and a pure-Python RFC 8032 implementation that shares
  // no code with it. Agreement between them is evidence the signature is genuinely
  // verifiable rather than verifiable only by the thing that produced it.
  await t.test("a signature verifies in BOTH shipped verifiers", () => {
    assert.equal(runVerifier(NODE_VERIFIER, fixture), 0, "node verifier rejected a valid signature");
    assert.equal(runVerifier(PY_VERIFIER, fixture), 0, "python verifier rejected a valid signature");
  });

  await t.test("a flipped decision is rejected by both", () => {
    const tampered = withTamperedPayload(fixture, "decision=use_first", "decision=exclude");
    assert.equal(runVerifier(NODE_VERIFIER, fixture, tampered), 1);
    assert.equal(runVerifier(PY_VERIFIER, fixture, tampered), 1);
  });

  // key_id is inside the signed bytes, so pointing the verdict at a DIFFERENT key that
  // is genuinely published must still fail. A verifier that resolved the key and stopped
  // thinking would pass this; both must not.
  await t.test("key_id is covered by the signature, not merely a lookup hint", () => {
    const swapped = withTamperedPayload(fixture, `key_id=${KEY_ID}`, "key_id=fc-test-offline-other");
    assert.equal(runVerifier(NODE_VERIFIER, fixture, swapped), 1);
    assert.equal(runVerifier(PY_VERIFIER, fixture, swapped), 1);
  });

  await t.test("an unpublished key_id fails rather than verifying under some other key", () => {
    const unknown = withTamperedPayload(fixture, `key_id=${KEY_ID}`, "key_id=fc-never-published");
    assert.equal(runVerifier(NODE_VERIFIER, fixture, unknown), 1);
    assert.equal(runVerifier(PY_VERIFIER, fixture, unknown), 1);
  });

  await t.test("a V3 payload is refused, not silently treated as verifiable", () => {
    const v3 = join(fixture.dir, "v3.payload");
    writeFileSync(v3, fixture.payload.replace("FRESHCONTEXT_HA_PRI_V4", "FRESHCONTEXT_HA_PRI_V3"));
    assert.equal(runVerifier(NODE_VERIFIER, fixture, v3), 1);
    assert.equal(runVerifier(PY_VERIFIER, fixture, v3), 1);
  });
});

// The Python verifier implements Ed25519 by hand, so agreement with Node is necessary
// but not sufficient — both could in principle share a misunderstanding. RFC 8032's own
// published vectors are the independent check.
test("the bundled Python Ed25519 implementation matches RFC 8032's published vectors", () => {
  const vectors = [
    {
      name: "TEST 1 (empty message)",
      publicKey: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
      message: "",
      signature:
        "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155" +
        "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
    },
    {
      name: "TEST 2 (one byte)",
      publicKey: "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
      message: "72",
      signature:
        "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da" +
        "085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
    },
    {
      name: "TEST 3 (two bytes)",
      publicKey: "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025",
      message: "af82",
      signature:
        "6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac" +
        "18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a",
    },
  ];

  // Exercised through the shipped file itself, loaded as a module, so the vectors test
  // the code that actually ships rather than a transcription of it.
  const program = `
import binascii, importlib.util, json, sys
spec = importlib.util.spec_from_file_location("fcverify", "${PY_VERIFIER}")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
h = binascii.unhexlify
out = []
for v in json.loads(sys.argv[1]):
    good = mod.ed25519_verify(h(v["publicKey"]), h(v["signature"]), h(v["message"]))
    # The same vector with one byte appended MUST fail, or "verify" could just return True.
    mutated = mod.ed25519_verify(h(v["publicKey"]), h(v["signature"]), h(v["message"]) + b"\\x00")
    out.append({"name": v["name"], "verified": good, "mutatedVerified": mutated})
print(json.dumps(out))
`;
  const stdout = execFileSync("python3", ["-c", program, JSON.stringify(vectors)], { encoding: "utf8" });
  const results = JSON.parse(stdout) as Array<{ name: string; verified: boolean; mutatedVerified: boolean }>;

  assert.equal(results.length, vectors.length);
  for (const result of results) {
    assert.equal(result.verified, true, `${result.name}: RFC 8032 vector failed to verify`);
    assert.equal(result.mutatedVerified, false, `${result.name}: a mutated message still verified`);
  }
});

#!/usr/bin/env node
// Verify a FreshContext Ed25519 attestation WITHOUT contacting FreshContext.
//
//   node scripts/verify-offline.mjs \
//     --payload verdict.payload --signature-file verdict.sig --keys freshcontext-keys.json
//
// Node 20+, standard library only. No npm install, no network, no FreshContext account.
// That is the entire point: an attestation you can only check by asking the issuer is
// issuer attestation, not verification.
//
// key_id lives INSIDE the signed payload, so it is covered by the signature and this
// script resolves the key itself. Changing key_id changes the signed bytes, so pointing
// a verdict at a different published key breaks verification rather than silently
// verifying under the wrong one.
//
// Exit 0 = valid. Exit 1 = invalid, unverifiable, or malformed. Nothing else.
import { readFileSync } from "node:fs";
import { createPublicKey, verify } from "node:crypto";

const V4_HEADER = "FRESHCONTEXT_HA_PRI_V4";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const die = (message) => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};

if (process.argv.includes("--help") || process.argv.length < 3) {
  console.log(`Verify a FreshContext Ed25519 attestation offline.

  --payload <file>          the exact signing_payload bytes (required)
  --signature <b64url>      the signature, or:
  --signature-file <file>   read the signature from a file
  --keys <file>             the published key document (.well-known/freshcontext-signing-keys.json)
  --key <spki-b64>          a single public key, instead of --keys

Exits 0 when the signature verifies, 1 otherwise.`);
  process.exit(process.argv.length < 3 ? 1 : 0);
}

const payloadPath = arg("payload") ?? die("--payload is required");
const payload = readFileSync(payloadPath);

const signatureRaw = arg("signature")
  ?? (arg("signature-file") ? readFileSync(arg("signature-file"), "utf8") : undefined)
  ?? die("--signature or --signature-file is required");
// The Worker emits base64url; standard base64 is accepted too so a copy-paste through
// a tool that re-encodes still works.
const signature = Buffer.from(signatureRaw.trim().replace(/-/g, "+").replace(/_/g, "/"), "base64");

const lines = payload.toString("utf8").split("\n");
if (lines[0] !== V4_HEADER) {
  die(`not a ${V4_HEADER} payload (first line is ${JSON.stringify(lines[0])}).
     V2 and V3 payloads are HMAC-signed and can only be checked by FreshContext itself.`);
}
if (!lines.includes("signature_algorithm=Ed25519")) {
  die("payload does not declare signature_algorithm=Ed25519");
}

let spkiBase64 = arg("key");
if (!spkiBase64) {
  const keysPath = arg("keys") ?? die("--keys or --key is required");
  const keyId = lines.find((l) => l.startsWith("key_id="))?.slice("key_id=".length);
  if (!keyId) die("payload carries no key_id line");

  const document = JSON.parse(readFileSync(keysPath, "utf8"));
  const entry = document.keys?.find((k) => k.key_id === keyId);
  if (!entry) {
    die(`no published key for key_id=${keyId} in ${keysPath}.
     Retired keys must stay published — if this one is absent, the key document is
     incomplete and this verdict cannot be checked, which is NOT the same as invalid.`);
  }
  spkiBase64 = entry.public_key_spki_b64;
  console.log(`key_id ${keyId} -> ${entry.status ?? "unknown status"} key from ${keysPath}`);
}

const publicKey = createPublicKey({
  key: Buffer.from(spkiBase64, "base64"),
  format: "der",
  type: "spki",
});

// null algorithm: Ed25519 prescribes its own hash, so no digest is passed separately.
const ok = verify(null, payload, publicKey, signature);
console.log(
  ok
    ? "VALID   signature verifies against the published key"
    : "INVALID signature does not verify — the payload or the signature has been altered"
);
process.exit(ok ? 0 : 1);

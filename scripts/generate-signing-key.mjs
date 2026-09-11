#!/usr/bin/env node
// Generate a FreshContext Ed25519 signing keypair for production.
//
// DESIGNED TO BE PIPED. The PKCS#8 private key goes to stdout and nowhere else:
//
//     node scripts/generate-signing-key.mjs | npx wrangler secret put FC_ED25519_PRIVATE_KEY_B64
//
// The private half therefore exists only in the pipe between two processes. It is never
// assigned to a shell variable, never written to disk, and never printed to a log. The
// public half and the derived key_id go to $GITHUB_OUTPUT (or stderr when run locally),
// because those are meant to be published.
//
// Do not "helpfully" add a --print-private flag. The entire value of this script is that
// there is no path by which the private key reaches a human's screen or a log file.
import { generateKeyPairSync, createHash } from "node:crypto";
import { appendFileSync } from "node:fs";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privatePkcs8B64 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
const publicSpki = publicKey.export({ type: "spki", format: "der" });
const publicSpkiB64 = publicSpki.toString("base64");

// key_id = "fc-" + YYYY-MM + "-" + first 8 hex of SHA-256(SPKI bytes), per E-2 §2.3.
// Self-describing and collision-resistant, and derived rather than chosen — a human
// picking key ids is a human who eventually reuses one, and a reused key id silently
// breaks the guarantee that a key id identifies exactly one key.
const month = new Date().toISOString().slice(0, 7);
const fingerprint = createHash("sha256").update(publicSpki).digest("hex").slice(0, 8);
const keyId = `fc-${month}-${fingerprint}`;

const publicOutput = [
  `key_id=${keyId}`,
  `public_key_spki_b64=${publicSpkiB64}`,
];

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, publicOutput.join("\n") + "\n");
} else {
  // stderr, not stdout: stdout is reserved for the private key so the pipe stays clean.
  process.stderr.write(publicOutput.join("\n") + "\n");
}

process.stdout.write(privatePkcs8B64);

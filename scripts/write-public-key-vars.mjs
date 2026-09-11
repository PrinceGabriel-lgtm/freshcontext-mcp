#!/usr/bin/env node
// Write the PUBLIC Ed25519 key values into worker/wrangler.jsonc as committed `vars`.
//
//   node scripts/write-public-key-vars.mjs <key_id> <public_key_spki_b64>
//
// These belong in the config, not in the Cloudflare dashboard. Per Cloudflare's docs:
// "When not used (or set to false), Wrangler will delete all vars before setting those
// found in the Wrangler configuration." wrangler.jsonc declares no `vars`, so anything
// set by hand in the dashboard is removed by the next deploy — and a published key that
// silently disappears makes every verdict signed under it unverifiable, which looks
// identical to forged. Committed vars survive every deploy and are reviewable.
//
// Secrets are the opposite case and are never touched by a deploy, which is why the
// PRIVATE key is a secret and never appears here.
//
// Edits the file as TEXT rather than parse-and-restringify: wrangler.jsonc carries load-
// bearing comments explaining the compatibility date and the entry point, and JSON.parse
// would silently delete every one of them.
import { readFileSync, writeFileSync } from "node:fs";

const [keyId, publicKey] = process.argv.slice(2);
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };

if (!keyId || !publicKey) fail("usage: write-public-key-vars.mjs <key_id> <public_key_spki_b64>");
if (!/^[A-Za-z0-9._:-]{1,128}$/.test(keyId)) fail(`key_id ${JSON.stringify(keyId)} is not a valid key id`);
// An Ed25519 SPKI DER is 44 bytes -> 60 base64 chars including padding.
if (!/^[A-Za-z0-9+/]{59}=$/.test(publicKey)) fail("public key is not a 44-byte Ed25519 SPKI DER in base64");

const path = new URL("../worker/wrangler.jsonc", import.meta.url);
const original = readFileSync(path, "utf8");

const block = `  // PUBLIC Ed25519 verification key, published deliberately — see docs/VERIFYING.md.
  // Committed rather than set in the dashboard because \`wrangler deploy\` deletes vars
  // absent from this file. Written by scripts/write-public-key-vars.mjs during the key
  // ceremony; key_id is derived from the key itself, so editing either by hand breaks
  // the pair. The PRIVATE key is a Worker secret and never appears in this repository.
  "vars": {
    "FC_ED25519_KEY_ID": "${keyId}",
    "FC_ED25519_PUBLIC_KEY_B64": "${publicKey}"
  },
`;

let updated;
if (/^\s*"vars"\s*:/m.test(original)) {
  // Replace an existing vars block, comments above it included, so a rotation does not
  // leave the previous key's values behind.
  updated = original.replace(
    /(?:^[ \t]*\/\/.*\n)*^[ \t]*"vars"[\s\S]*?^[ \t]*\},\n/m,
    block
  );
  if (updated === original) fail("found a vars key but could not rewrite it — refusing to guess");
} else {
  const anchor = /^([ \t]*"compatibility_flags"\s*:.*\n)/m;
  if (!anchor.test(original)) fail("could not find compatibility_flags to anchor the vars block");
  updated = original.replace(anchor, `$1${block}`);
}

// Prove the result is still parseable before writing. A config this script corrupted
// would fail at deploy time, in production, which is the worst place to find out.
const stripped = updated.replace(/^\s*\/\/.*$/gm, "");
let parsed;
try {
  parsed = JSON.parse(stripped);
} catch (cause) {
  fail(`the edit produced invalid JSONC, refusing to write it: ${cause.message}`);
}
if (parsed.vars?.FC_ED25519_KEY_ID !== keyId) fail("post-edit check: key_id did not land");
if (parsed.vars?.FC_ED25519_PUBLIC_KEY_B64 !== publicKey) fail("post-edit check: public key did not land");
// The comments are load-bearing; make sure the edit did not eat them.
const commentsBefore = (original.match(/^\s*\/\//gm) ?? []).length;
const commentsAfter = (updated.match(/^\s*\/\//gm) ?? []).length;
if (commentsAfter < commentsBefore) fail(`the edit removed ${commentsBefore - commentsAfter} comment lines`);

writeFileSync(path, updated);
console.log(`wrangler.jsonc updated: key_id=${keyId}`);
console.log(`comment lines preserved: ${commentsBefore} -> ${commentsAfter}`);

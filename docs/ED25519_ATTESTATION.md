# E-2 — Ed25519 Attestation and Independent Verification

**Status:** live in production and proven against it.

Key `fc-2026-09-ceced1ab` is installed and published, the Worker signs every new ledger row
`FRESHCONTEXT_HA_PRI_V4`, and the `attestation-proof` workflow has obtained a real verdict
from production and verified it with both shipped verifiers — including the negative
controls and a ledger round-trip confirming the *stored* row is V4, not merely the emitted
block ([run 34649322932](https://github.com/PrinceGabriel-lgtm/freshcontext-mcp/actions/runs/34649322932)).

That run is what closes the gap this document used to hold open. Configuration alone could
not: a published public key that is not the pair of the installed private secret produces
verdicts that look perfectly well-formed and fail for every third party who checks, and
unverifiable is indistinguishable from forged. The proof rules that out with evidence
rather than assurance, and re-runs daily.

## Why this exists

FreshContext's Ha-Pri v2/v3 production path uses HMAC-SHA256. HMAC detects tampering, but the signing secret is held by FreshContext, so an outside verifier must ask the issuer to recompute the MAC. That is issuer-operated verification, not independent verification.

E-2 adds an asymmetric Ed25519 attestation path. FreshContext holds only the private signing key; anyone can verify an attestation with the published public key, offline and without calling FreshContext.

This is required by the Context Integrity Benchmark v1 design: benchmark evidence must be recomputable and verifiable without trusting the benchmark author.

## Transition contract

E-2 is additive so the existing 17 historical HMAC ledger rows remain valid.

- Existing `FRESHCONTEXT_HA_PRI_V2` / `FRESHCONTEXT_HA_PRI_V3` signatures continue to verify through the legacy HMAC path.
- When the Ed25519 key bindings are present, successful MCP `evaluate_context` responses that already contain the decision-bound V3 payload receive an additional `[FRESHCONTEXT_SIG_V4]` block.
- V4 signs a versioned payload containing the V3 decision-bound fields plus `key_id` and `signature_algorithm=Ed25519`.
- `/.well-known/freshcontext-signing-keys.json` publishes the verification keys.
- `/v1/verify` accepts V4 stateless verification, but the service endpoint is optional: the same signature is independently verifiable offline.
- The existing `evaluation_snapshots` rows are not rewritten. E-2 does not mutate historical HMAC evidence or pretend it was asymmetrically signed.

The benchmark harness can use the same Ed25519 signing primitive directly for RFC 8785-canonicalized benchmark run records. The benchmark record canonicalization is separate from the Ha-Pri line payload; both are signed as exact bytes.

## Worker bindings

Production needs these bindings before V4 signing activates:

- `FC_ED25519_KEY_ID` — public identifier such as `fc-prod-2026-09-a`.
- `FC_ED25519_PRIVATE_KEY_B64` — PKCS#8 DER private key encoded as standard base64. **Secret. Never commit it.**
- `FC_ED25519_PUBLIC_KEY_B64` — SPKI DER public key encoded as standard base64. Public.
- `FC_ED25519_PUBLIC_KEYS_JSON` — optional JSON array retaining previous public keys for rotation/history.

If the three active-key fields are incomplete, the wrapper does not sign and the base Worker behavior is unchanged.

## Generate a keypair

Generate production keys locally in a controlled environment. Node 20+ example:

```js
import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
console.log("PRIVATE_PKCS8_B64=" + privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"));
console.log("PUBLIC_SPKI_B64=" + publicKey.export({ type: "spki", format: "der" }).toString("base64"));
```

Store the private value as a Cloudflare secret. The public value and key id are intentionally publishable.

## Public key document

`GET /.well-known/freshcontext-signing-keys.json` returns:

```json
{
  "schema": "freshcontext.signing-keys.v1",
  "algorithm": "Ed25519",
  "keys": [
    {
      "key_id": "fc-prod-2026-09-a",
      "algorithm": "Ed25519",
      "public_key_spki_b64": "...",
      "status": "active"
    }
  ]
}
```

The optional history binding accepts entries with `key_id`, `public_key_spki_b64`, `status`, and optional `valid_from` / `valid_until` fields. The active binding wins if the same key id appears in history.

## Rotation policy

1. Generate a new Ed25519 keypair and a never-reused key id.
2. Add the outgoing public key to `FC_ED25519_PUBLIC_KEYS_JSON` with `status: "retired"`. Do this **before** changing the active key.
3. Set the new private key secret, public key, and active key id.
4. Deploy and verify that the well-known endpoint contains both the retired and active keys.
5. Produce a test V4 attestation and verify it offline using only the published public key.
6. Keep retired public keys published for as long as signed artifacts that reference them are expected to remain verifiable.

Never reuse a key id for different key material. Never delete a public verification key merely because its private key has been retired.

## Offline verification

**See [VERIFYING.md](./VERIFYING.md)** — the third-party-facing document, plus two
runnable verifiers that ship in this repository and in the npm package:

```sh
node   scripts/verify-offline.mjs  --payload verdict.payload --signature-file verdict.sig --keys keys.json
python3 scripts/verify_offline.py  --payload verdict.payload --signature-file verdict.sig --keys keys.json
```

Both exit 0 on a valid signature, 1 otherwise, and resolve the key themselves from the
`key_id` carried inside the signed payload. Neither contacts FreshContext.

A correction to the E-2 spec, which asked for "Node and Python, ~20 lines each, using
standard libraries": **that is not achievable in Python.** The standard library has no
Ed25519. The options were a `pip install cryptography` — a native extension that can
fail to build — or implementing RFC 8032 verification inline. The script does the
latter, because a verifier a sceptic can run with nothing but an interpreter is worth
more than one that needs a working compiler toolchain first. It is validated against
RFC 8032's published vectors in `tests/offlineVerification.test.ts`, negative cases
included.

`tests/offlineVerification.test.ts` also runs both scripts as real subprocesses against
a real signature — the cross-implementation check E-2 section 8 calls "the test that
proves independence; the others only prove self-consistency".

## Deployment gate

Do not call E-2 "live" until all of these are true in production:

1. production Ed25519 keypair generated and private key stored as a Cloudflare secret;
2. public key document returns the active key id and expected SPKI bytes;
3. a real MCP `evaluate_context` response contains a V4 block;
4. the V4 payload verifies offline from a separate process using only the published public key;
5. tampering with the payload causes offline verification to fail;
6. legacy V3 ledger rows still verify through the existing path;
7. CI, Worker typecheck, and the trust gate are green.

Until that gate is completed, E-2 is implemented but not deployed.

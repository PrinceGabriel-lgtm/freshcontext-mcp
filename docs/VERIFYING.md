# Verifying a FreshContext verdict

This document is for someone who has a FreshContext verdict and wants to check it
**without trusting FreshContext**.

You do not need an account, an API key, or network access to our infrastructure. You
need the verdict's payload, its signature, and a public key you fetched at some earlier
point. That is the whole point: an attestation you can only check by asking the issuer
is issuer attestation, not verification.

---

## What you need

| | |
|---|---|
| **The signing payload** | The exact bytes that were signed. Emitted in the `[FRESHCONTEXT_SIG_V4]` block as a JSON-encoded string, or returned by `/v1/verify`. |
| **The signature** | Base64url, on the same line. |
| **The public key** | From `GET /.well-known/freshcontext-signing-keys.json`. Fetch it once; verification itself never touches the network. |

A signed response block looks like this:

```
[FRESHCONTEXT_SIG_V4]
algo=Ed25519
key_id=fc-2026-09-7f3a9c2e
item=1 result_id=... verdict_id=... sig=<base64url> payload="FRESHCONTEXT_HA_PRI_V4\nresult_id=..."
[/FRESHCONTEXT_SIG_V4]
```

`payload=` is JSON-encoded so its newlines stay on one line. `JSON.parse` it (or
`json.loads`) to recover the exact bytes that were signed. Do not reconstruct the payload
yourself from the other fields — verify the bytes you were given.

---

## Verify it

Two verifiers ship in this repository. They share no code, and either is sufficient.

### Node — standard library only

```sh
node scripts/verify-offline.mjs \
  --payload verdict.payload \
  --signature-file verdict.sig \
  --keys freshcontext-keys.json
```

### Python — no dependencies at all

```sh
python3 scripts/verify_offline.py \
  --payload verdict.payload \
  --signature-file verdict.sig \
  --keys freshcontext-keys.json
```

Both exit **0** when the signature verifies and **1** otherwise. Both resolve the key
themselves from the `key_id` inside the payload, so you pass the whole published key
document rather than picking a key by hand.

> **On the Python verifier's implementation.** Python's standard library has no Ed25519,
> so this script implements RFC 8032 verification inline rather than requiring
> `pip install cryptography` — a native extension that can fail to build, on a script
> whose entire purpose is to be runnable by a sceptic with nothing but an interpreter.
>
> The usual objection to hand-rolled crypto does not apply: this performs *verification*
> only, over a public key, a public signature and a public message. No secret key, no
> nonce, no randomness, nothing whose timing could leak anything. It is checked against
> RFC 8032's own published test vectors in `tests/offlineVerification.test.ts`, including
> the negative case — a mutated message must fail — so a verifier that always returned
> "valid" could not pass.
>
> If you would rather use an audited library, `cryptography`'s
> `Ed25519PublicKey.from_public_bytes(spki[12:]).verify(signature, payload)` checks the
> same bytes. Any correct Ed25519 implementation will agree; that is the property being
> relied on.

---

## What the result means

**Exit 0 — valid.** These bytes were signed by the holder of the private key matching
that published public key, and have not been altered since. `key_id` is *inside* the
signed payload, so it is covered by the signature: pointing a verdict at a different
published key breaks verification rather than silently checking under the wrong one.

**Exit 1 — invalid.** The payload or the signature changed. One flipped character in
`decision=`, one flipped bit in the signature, and this fails.

**Exit 1 — "no published key for key_id=…".** Not the same as invalid, and the
distinction matters. It means the key document you hold does not contain that key, so
you cannot check this verdict. Retired keys stay published precisely so this does not
happen; if it does, refetch the key document before concluding anything.

---

## V2 and V3 payloads are a different thing

Payloads beginning `FRESHCONTEXT_HA_PRI_V2` or `_V3` are **HMAC-SHA256**, and both
verifiers refuse them on purpose.

HMAC uses a shared secret that only FreshContext holds. It proves the payload is
unaltered — but only we can perform the check, so the strongest claim available is
"FreshContext says this is valid". `/v1/verify` labels these responses
`verification_method: "hmac"` with `issuer_attested: true` and says so in plain words.

Those rows are historical and are deliberately **not** re-signed: rewriting ledger
entries to look uniformly stronger would break the append-only property the ledger
exists to demonstrate. A ledger that accurately labels its own weaker history is more
credible than one that pretends uniformity.

Every new verdict is V4/Ed25519.

---

## Key rotation

Keys are **append-only**. A rotated key is never removed from the published document —
it is marked `"status": "retired"` and keeps being served, because verdicts signed under
it must stay verifiable forever or the ledger's value evaporates.

So a retired key verifying a historical verdict is correct and expected, not a warning
sign. What *would* be a warning sign is a key disappearing from the document.

---

## What this does NOT prove

V4 gets you to: *anyone can check that this verdict was signed by FreshContext's
published key and has not been altered.*

It does **not** get you to: *FreshContext did not later suppress or reorder ledger
entries.* That is a transparency-log property — inclusion proofs, an append-only
verifiable structure, third-party witnesses — and it is a different and larger piece of
work that has not been done. Nothing in this repository should be read as claiming it.

Also out of scope today: third-party timestamping, hardware-backed keys, multi-party
signing, and certificate chains.

---

## Reproducing the check yourself

If you would rather not run our scripts at all, the whole contract is:

1. The signed bytes are the payload exactly as given — UTF-8, LF line endings, no
   trailing newline added, no normalisation.
2. The signature is Ed25519 (RFC 8032), base64url encoded, no padding.
3. The public key is SPKI DER, base64 encoded — 44 bytes, of which the last 32 are the
   raw key.

Any Ed25519 implementation will do. That is the property that makes this verification
rather than attestation.

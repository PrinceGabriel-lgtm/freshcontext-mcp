#!/usr/bin/env python3
"""Verify a FreshContext Ed25519 attestation WITHOUT contacting FreshContext.

    python3 scripts/verify_offline.py \\
        --payload verdict.payload --signature-file verdict.sig --keys freshcontext-keys.json

Python 3.8+. NO dependencies — not even `cryptography`.

Ed25519 verification is implemented inline from RFC 8032 below, and that is a
deliberate choice rather than an oversight. Python's standard library has no Ed25519,
so the alternatives were a `pip install cryptography` (a native extension that can and
does fail to build) or this. For a script whose entire purpose is "a sceptic checks our
claim without trusting us or our infrastructure", requiring nothing but an interpreter
is worth more than the convenience of a library.

The usual objection to hand-rolled crypto does not apply here. This code performs
VERIFICATION only: it touches the public key, the signature and the message, all of
which are public. There is no secret key, no nonce, no randomness, and nothing whose
timing could leak anything — the inputs are already published. The implementation is
checked against RFC 8032's own published test vectors in the repository's test suite.

key_id lives INSIDE the signed payload, so it is covered by the signature and this
script resolves the key itself. Changing key_id changes the signed bytes.

Exit 0 = valid. Exit 1 = invalid, unverifiable, or malformed.
"""
import argparse
import base64
import hashlib
import json
import sys

# ─── Ed25519 verification — RFC 8032 §5.1.7 ──────────────────────────────────────
P = 2**255 - 19
L = 2**252 + 27742317777372353535851937790883648493
D = -121665 * pow(121666, P - 2, P) % P
SQRT_M1 = pow(2, (P - 1) // 4, P)


def _recover_x(y, sign):
    """Recover the x coordinate of a point from its compressed y and sign bit."""
    if y >= P:
        return None
    xx = (y * y - 1) * pow(D * y * y + 1, P - 2, P)
    x = pow(xx, (P + 3) // 8, P)
    if (x * x - xx) % P != 0:
        x = x * SQRT_M1 % P
    if (x * x - xx) % P != 0:
        return None
    if x == 0 and sign:
        return None
    return P - x if x & 1 != sign else x


def _add(a, b):
    """Twisted Edwards point addition, affine coordinates."""
    x1, y1 = a
    x2, y2 = b
    t = D * x1 % P * x2 % P * y1 % P * y2 % P
    x3 = (x1 * y2 + x2 * y1) * pow(1 + t, P - 2, P) % P
    y3 = (y1 * y2 + x1 * x2) * pow(1 - t, P - 2, P) % P
    return (x3, y3)


def _mul(point, scalar):
    """Double-and-add scalar multiplication."""
    result = (0, 1)
    while scalar > 0:
        if scalar & 1:
            result = _add(result, point)
        point = _add(point, point)
        scalar >>= 1
    return result


_BASE_Y = 4 * pow(5, P - 2, P) % P
BASE = (_recover_x(_BASE_Y, 0), _BASE_Y)


def _decode_point(data):
    y = int.from_bytes(data, "little")
    sign = y >> 255
    y &= (1 << 255) - 1
    x = _recover_x(y, sign)
    return None if x is None else (x, y)


def ed25519_verify(public_key_32, signature_64, message):
    """True iff signature_64 is a valid Ed25519 signature over message."""
    if len(public_key_32) != 32 or len(signature_64) != 64:
        return False
    a_point = _decode_point(public_key_32)
    r_point = _decode_point(signature_64[:32])
    if a_point is None or r_point is None:
        return False
    s = int.from_bytes(signature_64[32:], "little")
    if s >= L:  # Reject non-canonical scalars.
        return False
    k = int.from_bytes(
        hashlib.sha512(signature_64[:32] + public_key_32 + message).digest(), "little"
    ) % L
    return _add(r_point, _mul(a_point, k)) == _mul(BASE, s)


# ─── CLI ─────────────────────────────────────────────────────────────────────────
V4_HEADER = "FRESHCONTEXT_HA_PRI_V4"
# An Ed25519 SPKI DER is a fixed 12-byte header followed by the raw 32-byte key.
SPKI_PREFIX = bytes.fromhex("302a300506032b6570032100")


def die(message):
    print("FAIL: " + message, file=sys.stderr)
    raise SystemExit(1)


def b64(text):
    """Decode base64 or base64url, with or without padding."""
    clean = text.strip().replace("-", "+").replace("_", "/")
    return base64.b64decode(clean + "=" * (-len(clean) % 4))


def main():
    parser = argparse.ArgumentParser(description="Verify a FreshContext attestation offline.")
    parser.add_argument("--payload", required=True, help="file holding the exact signing_payload bytes")
    parser.add_argument("--signature", help="signature as base64url")
    parser.add_argument("--signature-file", help="file holding the signature")
    parser.add_argument("--key", help="a single SPKI public key, base64")
    parser.add_argument("--keys", help="the published key document (JSON)")
    args = parser.parse_args()

    with open(args.payload, "rb") as handle:
        payload = handle.read()

    if args.signature:
        signature_text = args.signature
    elif args.signature_file:
        with open(args.signature_file) as handle:
            signature_text = handle.read()
    else:
        die("--signature or --signature-file is required")
    try:
        signature = b64(signature_text)
    except Exception:
        die("signature is not valid base64")

    lines = payload.decode("utf-8").split("\n")
    if lines[0] != V4_HEADER:
        die(
            "not a %s payload (first line is %r). V2 and V3 payloads are HMAC-signed and "
            "can only be checked by FreshContext itself." % (V4_HEADER, lines[0])
        )
    if "signature_algorithm=Ed25519" not in lines:
        die("payload does not declare signature_algorithm=Ed25519")

    spki_b64 = args.key
    if not spki_b64:
        if not args.keys:
            die("--keys or --key is required")
        key_id = next((l[len("key_id="):] for l in lines if l.startswith("key_id=")), None)
        if not key_id:
            die("payload carries no key_id line")
        with open(args.keys) as handle:
            document = json.load(handle)
        entry = next((k for k in document.get("keys", []) if k.get("key_id") == key_id), None)
        if not entry:
            die(
                "no published key for key_id=%s in %s. Retired keys must stay published — if "
                "this one is absent the key document is incomplete and this verdict cannot be "
                "checked, which is NOT the same as invalid." % (key_id, args.keys)
            )
        spki_b64 = entry["public_key_spki_b64"]
        print("key_id %s -> %s key from %s" % (key_id, entry.get("status", "unknown status"), args.keys))

    spki = b64(spki_b64)
    if not spki.startswith(SPKI_PREFIX) or len(spki) != 44:
        die("public key is not a 44-byte Ed25519 SPKI DER")

    if ed25519_verify(spki[12:], signature, payload):
        print("VALID   signature verifies against the published key")
        return 0
    print("INVALID signature does not verify — the payload or the signature has been altered")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

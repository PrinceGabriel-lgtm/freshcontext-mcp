# Inspection path

A starting point for someone evaluating FreshContext from the outside — a reviewer,
an auditor, a prospective counterparty — who wants to check the claims rather than
read the marketing.

It is deliberately short. [`TECHNICAL_EVIDENCE.md`](TECHNICAL_EVIDENCE.md) is the
detailed index; this page says where to start and what each thing actually proves.

FreshContext evaluates whether the context reaching a model is fresh, sourced and
internally consistent, and emits a signed verdict. The signature is the point: a
verdict can be checked by someone who does not trust the server that produced it.

---

## Start here — live endpoints

Each of these answers immediately in a browser.

| Endpoint | What it proves |
| --- | --- |
| [`api.freshcontext.dev/`](https://api.freshcontext.dev/) | The service document — what is deployed and where everything else is. |
| [`/health`](https://api.freshcontext.dev/health) | Which version **and which commit** is serving right now. |
| [`/v1/health`](https://api.freshcontext.dev/v1/health) | The REST surface is up and the evaluation core is loaded. |
| [`/.well-known/freshcontext-signing-keys.json`](https://api.freshcontext.dev/.well-known/freshcontext-signing-keys.json) | The published Ed25519 public keys. This is what makes a verdict independently checkable. |
| [`freshcontext.dev`](https://freshcontext.dev) | Documentation, the specification and a worked demonstration. |

`POST /mcp` is the Model Context Protocol endpoint. It speaks JSON-RPC to MCP
clients and is not a web page — opening it in a browser returns an error, which is
correct behaviour rather than a fault.

---

## Read in this order

1. [`README.md`](../README.md) — what the system is and the interface it exposes.
2. [`FRESHCONTEXT_SPEC.md`](../FRESHCONTEXT_SPEC.md) — the envelope format, published
   as an open specification so other implementations can target it.
3. [`METHODOLOGY.md`](../METHODOLOGY.md) — how the temporal scoring (the DAR engine)
   actually decides, rather than an assertion that it does.
4. [`docs/TECHNICAL_EVIDENCE.md`](TECHNICAL_EVIDENCE.md) — the evidence index, including
   an explicit section on what it does **not** prove.
5. [`RISKS.md`](../RISKS.md) — open risks, stated by the project, separated into
   active, mitigated, accepted, and needing revalidation.

---

## Verify a verdict yourself

Verdicts are signed with Ed25519. You do not have to take the server's word for one:
[`docs/VERIFYING.md`](VERIFYING.md) walks through checking a signature offline against
the published key, and states plainly what a valid signature does and does not
establish. The key ceremony and rotation policy are in
[`docs/ED25519_ATTESTATION.md`](ED25519_ATTESTATION.md).

---

## Proof that runs without being asked

Two workflows run on a schedule against the live deployment, so the evidence above is
continuously re-established rather than asserted once:

- **Canonical endpoint proof** — confirms the published hostname serves this Worker and
  publishes the expected signing key.
- **Attestation proof** — confirms the published key and the signing key are still a
  matching pair, so a mismatch is caught within a day rather than by the first third
  party who tries to verify something.

Their run history is public under the repository's
[Actions tab](https://github.com/PrinceGabriel-lgtm/freshcontext-mcp/actions), including
the runs that failed.

---

## Licensing

The reference implementation is MIT licensed — see [`LICENSE`](../LICENSE),
[`NOTICE.md`](../NOTICE.md) and [`TRADEMARKS.md`](../TRADEMARKS.md). An MIT licence on
published code is not a statement about the ownership of everything else, and the two
should be assessed separately.

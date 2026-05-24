# Ha-Pri v2 Design

Status: design only
Phase: Math Spine Phase 3-A
Runtime impact: none

## Purpose

Ha-Pri v2 is an additive provenance-hardening model for FreshContext Store/Ledger rows.

The goal is to keep Ha-Pri v1 readable while designing a stronger future signature that binds a row to canonical content, semantic identity, source metadata, timestamps, and engine version.

This document does not implement Ha-Pri v2, change the D1 schema, change Worker write paths, migrate old rows, add HMAC secrets, or alter production scoring.

## Current Ha-Pri v1 Audit

Ha-Pri v1 is implemented today as a provenance stamp and audit reference, not yet hard tamper enforcement.

### Where v1 Lives

Current implementation points:

- `worker/src/intelligence.ts`
  - `PROVENANCE_SALT = "FRESHCONTEXT_DAR_V1"`
  - `generateAuditSig(resultId, contentHash)`
  - `scoreSignal(...)` computes `ha_pri_sig`
- `worker/src/worker.ts`
  - migration adds `ha_pri_sig TEXT`
  - cron write path stores `ha_pri_sig` in `scrape_results`
  - `/v1/intel/feed/:profile_id` returns `ha_pri_sig` in `intelligence_stamps`
- `tests/mathSpine.test.ts`
  - checks that `generateAuditSig` matches the documented v1 formula

### v1 Formula

```text
ha_pri_sig = SHA-256(
  result_id + ":" +
  content_hash + ":" +
  "FRESHCONTEXT_DAR_V1"
)
```

### What v1 Binds

Ha-Pri v1 binds:

- the generated `result_id`
- the current `content_hash` argument passed into `scoreSignal`
- the engine/version salt string `FRESHCONTEXT_DAR_V1`

In the current Worker cron path, `content_hash` is the value named `result_hash`, produced by `simpleHash(raw)`.

### Current Hash Input

The current `result_hash` is a small rolling hash:

```ts
let h = 0;
for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
return Math.abs(h).toString(36);
```

This is useful for cheap change detection, but it is not a cryptographic content digest.

### Storage and Output

Ha-Pri v1 is stored in D1:

- `scrape_results.ha_pri_sig`

It is returned through the live intelligence feed:

- `signals[].intelligence_stamps.ha_pri_sig`

### Verification Status

Current v1 behavior:

- generated on write: yes
- stored in D1: yes
- returned in feed/API output: yes
- recomputed on read: no
- used to reject tampered rows: no
- tied to canonical raw content SHA-256: no

So Ha-Pri v1 works as a provenance stamp and audit reference. It does not yet work as hard tamper enforcement.

## Weaknesses in v1

1. The signature uses a weak content-hash input.

   `ha_pri_sig` is SHA-256, but it currently binds to the rolling `result_hash`, not to canonical raw content bytes. The v1 signature inherits the collision risk and ambiguity of the weaker input.

2. No read-time verification exists.

   Feed and debug reads return the stored signature, but they do not recompute it and compare stored vs recomputed values.

3. No canonicalization contract exists for signed content.

   The current signature signs a hash value, not a documented canonical representation of the row content.

4. v1 does not bind all fields needed for provenance.

   It does not directly bind adapter, published timestamp, scraped timestamp, semantic fingerprint, or a schema marker beyond the fixed salt.

5. v1 is not authentication.

   The salt is public. Anyone with row fields can compute the v1 signature. That is acceptable for a provenance reference, but it should not be presented as proof of origin from a private signing authority.

## Ha-Pri v2 Design Goals

Ha-Pri v2 should be:

- additive, not a breaking migration
- deterministic
- recomputable
- explicit about canonicalization
- stronger than v1 for content integrity
- safe to run without secrets
- compatible with future HMAC signing, without requiring it now
- clear about verification status: valid, invalid, or unknown

## Proposed v2 Fields

Future Store/Ledger rows may add:

```text
canonical_content_sha256 TEXT
semantic_fingerprint_sha256 TEXT
ha_pri_sig_v2 TEXT
ha_pri_v2_status TEXT
ha_pri_v2_checked_at TEXT
```

These are design-level names only. No schema change is made in this phase.

### canonical_content_sha256

`canonical_content_sha256` is:

```text
SHA-256(canonical raw content)
```

It binds the actual content after deterministic normalization.

### semantic_fingerprint_sha256

`semantic_fingerprint_sha256` is:

```text
SHA-256(normalized title + canonical URL + publication date)
```

It is a full SHA-256 version of the current shorter semantic fingerprint idea.

## Canonicalization Rules

All canonicalization should be deterministic.

Recommended rules:

1. Use UTF-8.
2. Normalize line endings to `\n`.
3. Trim trailing whitespace on each line.
4. Preserve meaningful internal whitespace.
5. Normalize null or missing fields to explicit sentinel text, such as `<null>`.
6. Use stable field order.
7. Use ISO-8601 timestamps where available.
8. Do not include fields whose values change during read-time verification unless they are explicitly part of the signed record.
9. Version the canonicalization contract.

For future implementation, canonicalization should live in a pure helper with deterministic fixtures.

## Proposed v2 Formula

```text
ha_pri_sig_v2 = SHA-256(
  "FRESHCONTEXT_HA_PRI_V2" + "\n" +
  result_id + "\n" +
  canonical_content_sha256 + "\n" +
  semantic_fingerprint_sha256 + "\n" +
  adapter + "\n" +
  published_at + "\n" +
  scraped_at + "\n" +
  engine_version
)
```

### Field Meaning

- `FRESHCONTEXT_HA_PRI_V2`: schema/version string
- `result_id`: stable row identifier
- `canonical_content_sha256`: cryptographic digest of canonical raw content
- `semantic_fingerprint_sha256`: cryptographic digest of semantic identity fields
- `adapter`: source adapter name
- `published_at`: source/content publication timestamp, or explicit null sentinel
- `scraped_at` / `retrieved_at`: collection timestamp
- `engine_version`: scoring/signature engine version

## Verification Model

Future read or audit verification should:

1. Load the stored row.
2. Recompute canonical raw content from stored content fields.
3. Recompute `canonical_content_sha256`.
4. Recompute semantic identity fields.
5. Recompute `semantic_fingerprint_sha256`.
6. Recompute `ha_pri_sig_v2` from the canonical field sequence.
7. Compare stored vs recomputed values.
8. Mark the result:
   - `valid`
   - `invalid`
   - `unknown`
9. Surface verification status to internal/debug paths first.
10. Avoid silently trusting unverifiable rows.

Verification must not mutate old rows during read unless a dedicated migration explicitly allows it.

## Backward Compatibility

Ha-Pri v2 should not remove or reinterpret v1.

Rules:

- Keep `ha_pri_sig` readable.
- Add `ha_pri_sig_v2` separately.
- Treat old rows without v2 fields as `unknown`, not invalid.
- Do not reject old rows solely because they lack v2.
- Preserve v1 formula tests.
- Add v2 fixtures before any production write path changes.

## Future HMAC Boundary

HMAC-SHA256 may be useful later if FreshContext needs origin authentication rather than only tamper evidence.

That would require:

- a private deployment key
- secret rotation
- key identifiers
- verification policy for old key versions
- clear trust-boundary documentation

This phase does not add HMAC, secrets, or key management.

## Suggested Future Patch Sequence

1. Add pure canonicalization helpers and deterministic tests.
2. Add pure v2 signature helper and fixtures.
3. Add optional verification helper that returns `valid`, `invalid`, or `unknown`.
4. Add D1 columns in a separate schema phase.
5. Write v2 fields for new rows only.
6. Expose verification status on debug/internal endpoints first.
7. Decide later whether public feed output should include v2 status.

## Non-Goals

This design does not:

- change runtime behavior
- change scoring
- change MCP tool schemas
- change D1 schema
- change Worker write paths
- migrate old rows
- add HMAC
- add secrets
- reject rows in production
- publish npm
- deploy the Worker


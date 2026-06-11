# Ha-Pri v2 Production Enforcement Plan

Status: design only
Phase: Pass 11-K
Runtime impact: none

Ha-Pri v2 production enforcement is a future rollout path. Current FreshContext releases only include the Core helper and deterministic golden vectors unless a later implementation pass explicitly wires Worker/D1 enforcement.

This plan describes how Ha-Pri v2 could move from pure Core provenance helper to production Store/Worker verification without overclaiming current behavior.

## 1. Current State

Current FreshContext behavior:

- Ha-Pri v1 is the current Worker/feed audit stamp.
- Ha-Pri v1 is stored as `scrape_results.ha_pri_sig`.
- Ha-Pri v1 is returned in Worker feed `intelligence_stamps`.
- Ha-Pri v1 is a provenance stamp and audit reference, not hard row rejection.
- Ha-Pri v2 exists as a pure Core helper in `src/core/provenance.ts`.
- Ha-Pri v2 has deterministic golden vectors in `tests/fixtures/ha-pri-v2-golden-vectors.json`.
- Ha-Pri v2 is not production-enforced on Worker/D1 reads.
- Ha-Pri v2 does not currently reject rows.
- Ha-Pri v2 does not currently provide private-key origin authentication.

The current v2 helper provides deterministic canonicalization, SHA-256 hashing, signing payload construction, signature calculation, and verification status:

```txt
valid
invalid
unknown
```

That is real Core behavior. It is not yet Worker/D1 enforcement.

## 2. Target Future State

Future production enforcement should make stored context rows independently reviewable after write.

Target behavior:

- Worker write path stores Ha-Pri v2 provenance material for new rows.
- Rows can later be verified as `valid`, `invalid`, or `unknown`.
- Debug/internal read paths can report verification status.
- Safe public read paths can expose limited verification status without leaking internals.
- Invalid rows are not silently treated as trusted.
- Old rows remain compatible through `unknown` and optional backfill behavior.
- Strict rejection remains optional and staged, not the first rollout.

The target is not "FreshContext proves truth." The target is "FreshContext can detect whether stored provenance material still matches the stored row material under the documented v2 contract."

## 3. Proposed D1 / Storage Fields

Essential fields:

```txt
ha_pri_sig_v2 TEXT
ha_pri_canonical_content_sha256 TEXT
ha_pri_semantic_fingerprint_sha256 TEXT
ha_pri_signing_payload_version TEXT
ha_pri_engine_version TEXT
```

Recommended operational fields:

```txt
ha_pri_verification_status TEXT
ha_pri_verified_at TEXT
ha_pri_backfill_status TEXT
```

Likely unnecessary as separate stored fields:

```txt
ha_pri_adapter
ha_pri_published_at
ha_pri_retrieved_at
```

Reason: adapter, published timestamp, and retrieved/scraped timestamp already exist or should exist as first-class row fields. Duplicating them inside Ha-Pri-specific columns risks drift. The signing payload should read those canonical row fields directly during verification.

Minimum practical schema:

```sql
ALTER TABLE scrape_results ADD COLUMN ha_pri_sig_v2 TEXT;
ALTER TABLE scrape_results ADD COLUMN ha_pri_canonical_content_sha256 TEXT;
ALTER TABLE scrape_results ADD COLUMN ha_pri_semantic_fingerprint_sha256 TEXT;
ALTER TABLE scrape_results ADD COLUMN ha_pri_signing_payload_version TEXT;
ALTER TABLE scrape_results ADD COLUMN ha_pri_engine_version TEXT;
ALTER TABLE scrape_results ADD COLUMN ha_pri_verification_status TEXT;
ALTER TABLE scrape_results ADD COLUMN ha_pri_verified_at TEXT;
ALTER TABLE scrape_results ADD COLUMN ha_pri_backfill_status TEXT;
```

Storage status values should be boring and explicit:

```txt
valid
invalid
unknown
not_checked
```

Backfill status values should avoid pretending old rows were originally v2-stamped:

```txt
none
backfilled
unknown_origin
failed
```

## 4. Write-Path Design

The future Worker write path should dual-stamp v1 and v2 for new rows.

Recommended write sequence:

1. Adapter returns raw candidate content.
2. Existing Worker scoring computes current DAR fields and Ha-Pri v1.
3. Write path prepares Ha-Pri v2 input:
   - `resultId`: row id that will be stored
   - `rawContent`: canonical row raw content
   - `semanticFingerprint`: semantic fingerprint material or stored fingerprint
   - `adapter`: adapter id
   - `publishedAt`: normalized source publication timestamp or `null`
   - `retrievedAt`: normalized scrape/retrieval timestamp
   - `engineVersion`: FreshContext engine/package version or explicit Worker engine version
4. If required v2 material is complete, calculate:
   - canonical content SHA-256
   - semantic fingerprint SHA-256
   - signing payload version
   - Ha-Pri v2 signature
5. Store v1 fields as today.
6. Store v2 fields alongside v1 fields.
7. If material is incomplete, store unknown-compatible metadata and do not pretend the row is valid.

Recommended incomplete-material behavior:

```txt
ha_pri_sig_v2 = null
ha_pri_verification_status = "unknown"
ha_pri_backfill_status = "none"
```

Canonical content should be produced by the same pure helper behavior used in Core golden vectors. Do not invent a second Worker-only canonicalization contract.

Semantic fingerprint should be produced before signing and should be stable across retries for the same underlying source item. If the fingerprint is missing, v2 signing should fall back to `unknown`, not a fake valid signature.

Engine version should be explicit. The safest initial choice is the package/server version used by the running Worker build.

## 5. Read / Debug Verification Design

Future read verification should be a pure recomputation:

```txt
verifyHaPriV2(row) -> valid | invalid | unknown
```

Suggested internal verification input:

```ts
{
  resultId: row.id,
  rawContent: row.raw_content,
  semanticFingerprint: row.semantic_fingerprint,
  adapter: row.adapter,
  publishedAt: row.published_at,
  retrievedAt: row.scraped_at,
  engineVersion: row.ha_pri_engine_version
}
```

Debug output may include:

```json
{
  "ha_pri_v2": {
    "status": "valid",
    "checked_at": "2026-06-11T12:00:00.000Z",
    "payload_version": "FRESHCONTEXT_HA_PRI_V2",
    "canonical_content_sha256": "sha256...",
    "semantic_fingerprint_sha256": "sha256..."
  }
}
```

Safe public output should be smaller:

```json
{
  "provenance": {
    "ha_pri_v2_status": "valid"
  }
}
```

Do not expose signing payloads or debug hashes in broad public outputs unless there is a clear user need.

Suggested staged behavior:

- Phase 1: report-only verification in internal/debug output.
- Phase 2: warning in read/debug path when invalid.
- Phase 3: optional strict mode for private deployments.
- Phase 4: possible reject/block policy only after replay data and operational evidence.

Invalid should not become automatic rejection first. A migration bug, canonicalization mismatch, or schema rollout issue could otherwise hide useful rows during rollout.

## 6. Compatibility And Backfill

Old rows must remain readable.

Compatibility rules:

- v1-only rows verify as `unknown` for v2.
- Rows with missing v2 fields verify as `unknown`.
- Rows with malformed v2 signatures verify as `invalid`.
- Rows with present but mismatched v2 signatures verify as `invalid`.
- Missing `ha_pri_sig_v2` is not the same as tampering.
- Existing `ha_pri_sig` remains readable for historical continuity.

Backfill rules:

- Backfilled provenance must be marked as `backfilled` or `unknown_origin`.
- Backfill must not imply the row was v2-stamped at original write time.
- Backfill should preserve original row timestamps.
- Backfill should record when verification/backfill happened.
- Backfill should be reversible or repeatable where practical.

Possible backfill process:

1. Select rows missing `ha_pri_sig_v2`.
2. Reconstruct v2 input from stored row fields.
3. If required material is complete, calculate v2 fields.
4. Store v2 fields with `ha_pri_backfill_status = "backfilled"`.
5. If required material is incomplete, store `ha_pri_verification_status = "unknown"` and `ha_pri_backfill_status = "unknown_origin"`.
6. Report counts for backfilled, unknown, invalid, and failed rows.

## 7. Security Boundary

Plain SHA-256 gives deterministic integrity and audit checks.

Plain SHA-256 does not prove private origin authentication. Anyone with all payload fields can recompute a plain SHA-256 signature.

Ha-Pri v2 helps detect:

- accidental row corruption
- changed content after write
- changed semantic fingerprint material
- changed adapter/timestamp/version fields included in the signing payload
- malformed stored signatures

Ha-Pri v2 does not solve:

- truth certification
- legal, medical, tax, employment, academic, or investment correctness
- private origin authentication without a secret or private key
- compromise of the write path before signing
- compromise of all row fields plus signature under plain SHA-256

Recommendation:

Do not add HMAC/private signing immediately to the open package. Keep the open package deterministic and stateless.

Consider HMAC or private-key signing later for:

- hosted FreshContext endpoints
- private production deployments
- paid/tenant-specific infrastructure
- environments where the verifier must know the row was stamped by a trusted FreshContext deployment

If HMAC/private signing is added later, it requires:

- secret storage outside the repo
- key ids
- key rotation
- old-key verification policy
- signer/verifier boundary documentation
- tests proving secrets are never logged or returned

## 8. Threat Model

Threats considered:

### Accidental row corruption

Ha-Pri v2 helps by recomputing the expected signature and surfacing `invalid`.

### Stale or partial provenance

Ha-Pri v2 helps by returning `unknown` when required material is missing. The system should not pretend such rows are valid.

### Tampered D1 rows

Ha-Pri v2 helps if an attacker changes stored content or bound fields without also updating all matching v2 fields.

Plain SHA-256 does not help if an attacker can rewrite all row fields and recompute the public signature.

### Malformed signatures

Malformed, blank, or nonmatching signatures should produce `invalid` or `unknown` according to current helper behavior. They should not crash reads.

### Recomputed public SHA-256 signatures

Because v2 currently uses plain SHA-256, a party with all fields can recompute a matching signature. HMAC/private signing is the later answer if origin authentication becomes necessary.

### Debug endpoint leakage

Debug routes should remain authenticated. Public outputs should avoid exposing full signing payloads or internal row material unless deliberately needed.

### Secret exposure if HMAC is added later

HMAC/private signing introduces secret-management risk. Secrets must live in deployment configuration, never in docs, fixtures, npm package output, or client-visible responses.

## 9. Tests Needed Before Implementation

Future implementation should add tests before production rollout:

- D1 migration tests if the migration harness supports them.
- Write-path stamping tests for new rows.
- Dual-stamp tests proving v1 remains unchanged.
- Read-path verification tests for `valid`, `invalid`, and `unknown`.
- Old-row tests proving missing v2 fields are `unknown`, not invalid.
- Tampered-row tests for changed content, semantic fingerprint, adapter, timestamps, and engine version.
- Malformed signature tests.
- Debug output safety tests.
- Public output minimization tests.
- Backfill tests with complete and incomplete rows.
- Worker dry-run validation.
- HMAC/private signing tests if that later lands.

Do not add fake production-enforcement tests before implementation exists.

## 10. Rollout Phases

### Phase 0: Core helper and golden vectors

Done.

Includes:

- pure Core Ha-Pri v2 helper
- deterministic golden vectors
- valid / invalid / unknown verification behavior

### Phase 1: Storage schema design

This document.

No migration yet.

### Phase 2: Write-path dual-stamp v1 + v2

Add D1 columns and write v2 fields for new rows only. Keep v1 intact.

### Phase 3: Report-only read/debug verification

Recompute v2 on read/debug paths and report status. Do not reject rows yet.

### Phase 4: Backfill tooling

Backfill historical rows only with explicit `backfilled` or `unknown_origin` markers.

### Phase 5: Optional strict mode

Private deployments may opt into warnings or blocking for invalid rows after enough evidence.

### Phase 6: Hosted/private HMAC signing

Add origin-authenticated signing only if hosted/private use cases require it.

## 11. Non-Goals

This pass does not implement:

- D1 migration
- Worker enforcement
- read-path rejection
- debug endpoint changes
- HMAC/private signing
- backfill script
- npm publish
- version bump
- Cloudflare deploy
- public security claim upgrade
- new MCP tools
- ranking/scoring changes
- Operator/retrieve behavior

## Release Gates For Future Implementation

Before any implementation pass can claim production enforcement:

- migrations must be reviewed and dry-run
- new rows must dual-stamp v1 and v2
- v1 compatibility tests must pass
- v2 read verification tests must pass
- old-row `unknown` behavior must be proven
- tampered-row `invalid` behavior must be proven
- debug output must avoid leaking secrets or excessive internals
- Worker dry-run must pass
- Trust gate must pass with effective fail 0
- public docs must say exactly what is implemented

## Product Interpretation

Ha-Pri v2 is a provenance hardening lane for stored FreshContext rows. It supports the larger product story only when it stays honest:

```txt
candidate context in
decision-ready context out
optional provenance verification for stored rows
```

It is not a truth engine and not a substitute for authentication, authorization, or hosted tenant isolation.

# RISKS — FreshContext DAR engine and ingestion pipeline

Known algorithmic and data-integrity edge cases in `worker/src/intelligence.ts` and the cron ingestion path. Last reviewed: 2026-05-01.

---

## Active risks (not yet mitigated)

These are real and unguarded. Tracked in CLAUDE.md "Things Pending".

### 1. Frozen signal paradox

When `publishedAt` is `null`, `applyDecay` falls back to `t = halfLifeHours`. The result is `R_t = R_0 · e^(−ln 2) = R_0 / 2` exactly — half the base score, deterministically. Such signals are pinned at half their base score forever, even after cron recompute. Permanent "stable" entropy.

- **Where:** `applyDecay`, intelligence.ts:172
- **Impact:** Signals without an extractable publication date accumulate as permanent middle-tier results.
- **Mitigation pending:** Hard floor (`R_t < 5` → mark expired) plus lazy decay at read time.

### 2. No hard floor on R_t

`is_relevant` uses `R_t >= 35`. Below 35, signals stay in the DB. Below 5 they're effectively dead but unflagged. Storage grows monotonically.

- **Where:** intelligence.ts:255, feed query at worker.ts:942
- **Mitigation pending:** Add `R_t < 5 → is_expired = 1` and exclude expired signals from the feed query.

### 3. Lazy decay missing

`rt_score` is computed at ingest, then recomputed by the cron every 6h. Reads return the stored value, so feed responses can be up to 6h stale.

- **Where:** Feed query reads `sr.rt_score` directly, no recompute.
- **Mitigation pending:** Recompute decay at read time, or shorten the cron interval.

### 4. Re-ignition gap

`isDuplicate(48)` skips fingerprints seen in the last 48h. A story that trends → dies → re-trends within 48h is dropped at ingest. After 48h, a new ingestion is allowed and scored fresh.

- **Where:** intelligence.ts:333
- **Mitigation pending:** Detect re-ignition by comparing the dedup window to the original signal's age and decay state.

### 5. CPU timeout in cron loop

The DAR functions are O(n) on content length and individually cheap. The cron loop processes signals sequentially. At ~1k signals this is well under Workers CPU limits, but the failure mode at scale is unbounded loop time, not per-signal cost.

- **Mitigation pending:** Batch processing with explicit per-batch CPU budget tracking.

---

## Documented behaviors (by design, not bugs)

These are intentional but worth knowing.

### 6. Future dates in `applyDecay` score as freshest

`extractPublishedAt` filters future dates upstream. If any future code path calls `applyDecay` directly with a future-dated string, `t` is clamped to 0 by `Math.max(0, …)` and the signal scores as freshest possible.

- **Where:** `applyDecay`, intelligence.ts:176
- **Why this is OK currently:** Only `scoreSignal` calls `applyDecay`, and it pre-filters via `extractPublishedAt`. Defense-in-depth would add an explicit reject in `applyDecay` itself.

### 7. Semantic fingerprint truncates titles to 80 characters

`semanticFingerprint` slices the normalised title to 80 chars before hashing. Two articles whose titles diverge only after the 80th character will collide on fingerprint and dedupe. Most CMSs produce titles well under 80 chars; this is a tradeoff for fingerprint stability across whitespace/encoding noise.

- **Where:** intelligence.ts:318

### 8. Empty and whitespace-only content collide on a single fingerprint

Both reduce to the input string `"||"` and hash to the same 16-char fingerprint. If garbage signals leak past adapter validation, the second one is silently dropped at `isDuplicate`. Storage-wise benign, but a future debugging trap (you'll see one phantom "empty signal" in the DB and never know how many were ingested).

- **Mitigation if needed:** Short-circuit fingerprint to `null` when title + url + date are all empty, and have the cron skip those.

### 9. `parseStoredProfile` degrades silently on garbage JSON

If `targets` or `skills` columns contain malformed JSON, `safeParse` falls back to comma-split. Garbage tokens enter as profile keywords. They won't match real content, but no error is raised.

- **Where:** intelligence.ts:273
- **Mitigation if needed:** Tighten profile validation at write time; D1 can't enforce JSON shape, so this would have to be a write-path check.

### 10. Excluded signals still complete the scoring pipeline

`scoreSignal` zeroes the score on exclusion match but still computes the fingerprint and audit signature, and the cron presumably inserts the row with `is_relevant=0`. If exclusion-matching content is high-volume, that's pure storage cost.

- **Mitigation if needed:** Skip insertion when `R_0 == 0`.

### 11. `ha_pri_sig` is integrity, not authentication

`PROVENANCE_SALT = "FRESHCONTEXT_DAR_V1"` is hardcoded in a public repo. Anyone with the source can forge a valid `ha_pri_sig` for any `(resultId, contentHash)` pair. The signature proves the pair was hashed together at some point — it does not prove "scored by this engine".

- **Where:** intelligence.ts:195
- **Why this matters:** METHODOLOGY.md describes the signature as proving provenance. That's accurate against accidental tampering, not against an adversary. If a customer ever needs cryptographic provenance, the salt would need to move to a secret binding (env var) and signatures would need to be reissued.

### 12. Trailing-slash URLs do not collapse

`https://example.com/conf` and `https://example.com/conf/` produce different fingerprints. Most sites canonicalize one or the other, but not all. Minor dedup miss.

- **Mitigation if needed:** Strip trailing `/` from `u.pathname` in `semanticFingerprint`.

---

## Resolved 2026-05-01

Stress-test pass on 2026-05-01 surfaced the following data-integrity bugs and fixed them in-place:

- **Duplicate keywords inflated R_0** — `calculateBaseScore` filtered raw `targets` / `skills` arrays without deduping. A profile with duplicate entries (`["typescript","typescript","typescript"]`) inflated the score by +15 per duplicate, capped at +35. Fixed by deduping via `new Set` before matching. Verified: dupe and single profiles now score identically (R_0=55 each).

- **Malformed dates rolled silently** — `extractPublishedAt` accepted dates like `2024-02-30` because JS `new Date('2024-02-30')` rolls to Mar 1 instead of returning Invalid Date. Fixed by adding a round-trip check: reject if `new Date(ts).toISOString().slice(0,10) !== originalString`. Verified: `2024-02-30` → null, `2024-02-29` (valid leap day) → `2024-02-29`.

- **Querystring stripping was too aggressive** — `semanticFingerprint` stripped *all* querystrings, causing `?id=1` and `?id=2` to collide. Fixed by parsing the URL and removing only known tracking params (`utm_*`, `fbclid`, `gclid`, `mc_*`, `igshid`); legitimate query identifiers are preserved. Verified: `?id=1` vs `?id=2` now differ; `?utm_source=hn` vs `?utm_source=reddit` still collide as intended.

- **Hidden 50-char content threshold killed legitimate short signals** — `calculateBaseScore` had a `raw.length < 50 → −40` penalty grouped with `[ERROR]` and `"not found"` checks. The early `< 20` reject is the real floor; the 50-char clause silently zeroed legitimate short content like "OpenAI launches Atlas browser typescript" (40 chars). Removed. Verified: that content now scores R_0=58 (was 15).

---

## Behaviors confirmed working as intended (2026-05-01)

- Future dates filtered at extraction (`2030-01-01` → `null`)
- Bad month/day filtered (`2024-13-45` → `null` via `isNaN`)
- Multiple dates → newest valid wins
- Case-insensitive matching (`TYPESCRIPT` matches target `typescript`)
- Punctuation/case differences in titles → same fingerprint (good dedup)
- `http` vs `https` → different fingerprints (defensive)
- `utm_*` variants → same fingerprint (intentional dedup, preserved post-fix)
- Score capped at 100 and floored at 0
- Unknown adapter falls back to default lambda (0.001)
- Float underflow → 0 silently (no NaN/Infinity)

---

## How to re-run the stress test

The probe script is not committed (deleted after each run to keep the working tree clean). To regenerate:

1. Create `worker/probe.ts` that imports the pure functions from `./src/intelligence`.
2. Feed adversarial inputs: empty / oversized content, malformed/future/rolled dates, duplicate target keywords, UTM-only URL diffs, title-collision boundaries, exclusion matches.
3. Run with `cd worker && npx tsx probe.ts`.
4. Delete the probe script after.

A live load test was also run on 2026-05-01: 755 requests across `/health`, `/debug/db`, `/v1/intel/feed/default`. Zero errors. p50 latencies: `/health` 180ms, `/debug/db` 0.8–1.2s, `/v1/intel/feed/` 0.6–0.9s at concurrency 10–20. No cliffs found at tested loads; the bottleneck for finding real cliffs is a faster client than `xargs + curl.exe` on Windows.

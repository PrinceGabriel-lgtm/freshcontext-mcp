# RISKS — FreshContext DAR engine and ingestion pipeline

Known algorithmic and data-integrity behaviour in `worker/src/intelligence.ts` and the cron
ingestion path, audited against the code rather than against the previous edition of this file.

**Register reviewed: 2026-09-13.** Each entry carries its own evidence and its own last-verified
date, because a single date at the top of a risk register claims more than any single review does.

> **Scope: this file is about the signal-intelligence path, not verdict attestation.**
> Two different signing mechanisms exist in this project and they are not interchangeable.
> `ha_pri_sig` / Ha-Pri v1, discussed below, is a provenance stamp over DAR ingestion rows computed
> with a published constant salt — an audit reference, not authentication. `FRESHCONTEXT_HA_PRI_V4`
> is the Ed25519 attestation over verdict rows, verifiable offline against a published public key
> (`docs/VERIFYING.md`, `docs/ED25519_ATTESTATION.md`). **Nothing in this file describes a weakness
> in V4.**

The maintainer's working notes are not part of this repository. This file is the public record.

---

## ACTIVE / UNMITIGATED

### A-1 · Re-ignition gap in semantic deduplication

A story that trends, dies, and re-trends inside the dedup window is dropped at ingest rather than
re-scored.

- **Code:** `worker/src/intelligence.ts:375-386` — `isDuplicate(db, fingerprint, withinHours = 48)`
  counts rows with the same `semantic_fingerprint` scraped in the last 48 hours. Called at
  `worker/src/worker.ts:2376` with an explicit `48`.
- **Evidence:** behaviour is direct from the query; no test pins re-ignition specifically.
- **Impact:** a genuinely re-emerging signal is invisible for up to 48 hours. After the window it
  ingests and scores normally, so this delays rather than loses.
- **Next action:** compare the dedup window against the original signal's age and decay state, so a
  decayed fingerprint can re-ignite before the window closes.
- **Last verified:** 2026-09-13.

### A-2 · No per-batch CPU budget in the cron loop

The DAR functions are O(n) on content length and individually cheap, but the cron processes watched
queries without an explicit time budget.

- **Code:** cron body in `worker/src/worker.ts` around 2360-2415; writes are batched via
  `env.DB.batch(...)` at `worker/src/worker.ts:1462`, but there is no elapsed-time check that would
  stop the loop before a Workers CPU limit.
- **Evidence:** absence of a budget check, confirmed by inspection. At the current corpus size this
  has never been hit.
- **Impact:** the failure mode at scale is unbounded loop time, not per-signal cost. Low now,
  structural later.
- **Next action:** per-batch CPU budget tracking with an explicit stop-and-resume.
- **Last verified:** 2026-09-13.

---

## MITIGATED / VERIFIED

### M-1 · Lazy decay at read time — **resolved**

Previously listed as an active risk whose mitigation had "shipped" — an internal contradiction this
edition removes. The mitigation is live and the read path is explicit about it.

- **Code:** `worker/src/worker.ts:2677-2681`:
  > *"Lazy decay: rt_score is recomputed from base_score, published_at, and adapter λ at request
  > time, NOT read from the cron-written column. The stored rt_score in scrape_results is a
  > historical record (value-at-write-time); the served value is always fresh as of NOW. This
  > eliminates up-to-6h staleness between cron runs and prevents 'frozen' signals."*
- **Residual:** the stored `rt_score` column is still written by the cron and is still a
  value-at-write-time record. It is not served. Anyone querying the table directly, rather than the
  feed, sees the historical value — which is correct for an audit trail and wrong as a current
  score.
- **Last verified:** 2026-09-13.

### M-2 · Frozen signal paradox — **resolved 2026-06**

Signals with no extractable `publishedAt` fell back to `t = halfLifeHours`, pinning them at exactly
`R_0 / 2` forever, even across cron recomputes.

- **Code:** `worker/src/intelligence.ts:180-225`.
- **Last verified:** 2026-06-19 (investor-readiness audit). Not re-verified in this pass.

### M-3 · No hard floor on R_t — **resolved 2026-06**

`is_relevant` used `R_t >= 35`; below 5 a signal was effectively dead but unflagged, so storage grew
monotonically.

- **Code:** `worker/src/intelligence.ts:180-225`; flag written at
  `worker/src/intelligence.ts:282` (`is_relevant: rt_rounded >= 35 ? 1 : 0`).
- **Residual:** flagging is not deletion. See D-5 and the retention note below.
- **Last verified:** 2026-06-19. Not re-verified in this pass.

### M-4 · Four data-integrity defects found by adversarial probing — **resolved 2026-05-01**

Found by a stress-test pass and fixed in place; each was verified at the time with a stated
before/after.

| Defect | Fix | Verified then |
| --- | --- | --- |
| Duplicate keywords inflated `R_0` by +15 each, capped +35 | dedupe via `new Set` before matching | dupe and single profiles both score `R_0=55` |
| Malformed dates rolled silently (`2024-02-30` → Mar 1 via JS `Date`) | ISO round-trip check | `2024-02-30` → `null`; `2024-02-29` preserved |
| Querystring stripping too aggressive — `?id=1` and `?id=2` collided | strip only known tracking params (`utm_*`, `fbclid`, `gclid`, `mc_*`, `igshid`) | `?id=1` ≠ `?id=2`; `utm_*` variants still collide as intended |
| Hidden `< 50` char content penalty zeroed legitimate short signals | removed; the `< 20` reject is the real floor | 40-char signal went `R_0` 15 → 58 |

- **Last verified:** 2026-05-01. Not re-verified in this pass.

---

## ACCEPTED BEHAVIOUR / DESIGN TRADEOFF

These are intentional. They are listed because a reader auditing the code will find them and should
not have to guess whether they are known.

### D-1 · `ha_pri_sig` is a provenance stamp, not authentication

- **Code:** `worker/src/intelligence.ts:207` — `const PROVENANCE_SALT = "FRESHCONTEXT_DAR_V1"`,
  consumed at `:220` as `${resultId}:${contentHash}:${PROVENANCE_SALT}`.
- **Why it is acceptable:** the salt is a constant in a public repository, so anyone with the source
  can compute a valid `ha_pri_sig` for any `(resultId, contentHash)` pair. That is the intended
  property. Ha-Pri v1 is an audit reference for the v1 formula over ingestion rows — it identifies
  which computation produced a row, and makes no claim to authenticate the row's source or to
  resist tampering.
- **Boundary:** authentication and tamper-evidence live in the verdict path, under Ed25519 V4, with
  a published key and offline verifiers. Ha-Pri v2 stored-signal enforcement is **not live**.
- **Last verified:** 2026-09-13.

### D-2 · Semantic fingerprint truncates titles to 80 characters

- **Code:** `worker/src/intelligence.ts:360` — `.slice(0, 80)` after normalisation.
- **Tradeoff:** two articles whose titles diverge only after the 80th character collide and
  de-duplicate. Bought in exchange for fingerprint stability across whitespace and encoding noise.
  Most CMS titles are well under 80 characters.
- **Last verified:** 2026-09-13.

### D-3 · Trailing-slash URLs do not collapse

- **Code:** `worker/src/intelligence.ts:344` — `u.origin + u.pathname + (u.search || "")`, no
  trailing-slash normalisation.
- **Tradeoff:** `…/conf` and `…/conf/` fingerprint differently, so a site that serves both without
  canonicalising can produce a duplicate. Minor dedup miss; stripping the slash would be a one-line
  change if a real source ever triggers it.
- **Last verified:** 2026-09-13.

### D-4 · `parseStoredProfile` degrades silently on malformed JSON

- **Code:** `worker/src/intelligence.ts:294-310` — `safeParse` falls back to comma-splitting when
  `targets` or `skills` contain invalid JSON.
- **Tradeoff:** garbage tokens enter as profile keywords rather than raising. They will not match
  real content, so the practical effect is a no-op, but no error surfaces. D1 cannot enforce JSON
  shape, so a real fix belongs on the write path.
- **Last verified:** 2026-09-13.

### D-5 · Excluded signals complete the scoring pipeline and are still inserted

- **Code:** `worker/src/intelligence.ts:282` — the row is written with `is_relevant: 0` rather than
  skipped.
- **Tradeoff:** exclusion-matched content still costs a fingerprint, a signature and a row. Keeping
  the row preserves the audit trail of what was seen and rejected; skipping insertion would save
  storage and lose that.
- **Last verified:** 2026-09-13.

### D-6 · Future dates clamp to freshest rather than reject

- **Code:** `worker/src/intelligence.ts:185` — `t = Math.max(0, (Date.now() - published) / …)`.
- **Why it is acceptable:** `extractPublishedAt` filters future dates upstream, and `scoreSignal` is
  the only caller of `applyDecay`. A future-dated string reaching `applyDecay` directly would score
  as freshest possible. Defence in depth would add an explicit reject inside `applyDecay` itself.
- **Last verified:** 2026-09-13.

### D-7 · Empty and whitespace-only content share one fingerprint

- **Code:** `worker/src/intelligence.ts` `semanticFingerprint` — both reduce to `"||"` and hash
  identically.
- **Tradeoff:** if garbage passes adapter validation, the second such signal is silently dropped at
  `isDuplicate`. Storage-wise benign; a debugging trap later, because the table shows one phantom
  empty signal with no record of how many were absorbed into it.
- **Last verified:** 2026-09-13.

---

## NEEDS REVALIDATION

### N-1 · Load-test figures predate the current version

The recorded load test — 755 requests across `/health`, `/debug/db`, `/v1/intel/feed/default`, zero
errors, p50 `/health` 180 ms, `/debug/db` 0.8-1.2 s, `/v1/intel/feed/` 0.6-0.9 s at concurrency
10-20 — was run on **2026-05-01**, four months and several releases ago, before Ed25519 V4 signing
and the lazy-decay read path existed.

Treat those numbers as historical. They are not a current capacity statement and no current one
exists. The bottleneck on re-running it was a faster client than `xargs + curl` on Windows.

### N-2 · M-2, M-3 and M-4 were verified once and not since

They are recorded as resolved on the strength of the audit that fixed them. That is honest but it is
not a standing guarantee: no regression test pins the frozen-signal fallback, the `R_t` floor, or the
four 2026-05-01 fixes specifically. A re-verification pass, or targeted tests, would move them from
"resolved once" to "resolved and defended".

---

## How to re-run the adversarial probe

The probe script is deliberately not committed, to keep the working tree clean between runs.

1. Create `worker/probe.ts` importing the pure functions from `./src/intelligence`.
2. Feed adversarial inputs: empty and oversized content, malformed, future and rolled dates,
   duplicate target keywords, UTM-only URL differences, title-collision boundaries, exclusion
   matches.
3. `cd worker && npx tsx probe.ts`.
4. Delete the probe script.

# FreshContext — Flag A Thesis: The Temporal Math Spine, Its Limits, and the Improvement Path

**Author:** Immanuel Gabriel (Prince Gabriel) — Tsumeb / Grootfontein, Namibia
**Date:** 2026-06-30
**Status:** internal engineering thesis. Honest audit of the decay/scoring math against
1,219 rows of real production data. Companion to METHODOLOGY.md v1.3.
**Purpose:** state precisely what the temporal math spine does correctly, where it is
limited or mis-measured, what genuinely fails, and what is being improved — with no
overclaiming and no false self-criticism. Every claim is traceable to source or data.

---

## 0. Why this thesis exists

"Validate the decay model" usually gets answered with a hand-wave. This document does the
actual thing: it tests the spine against real data, separates *measurement error* from
*genuine limitation*, and defines the improvement path. The headline, stated up front so it
is not lost: **the temporal math spine is mathematically sound and correctly implemented. It
is not broken. What is limited is the OBSERVABILITY of the pure time signal in the blended
feed score, and the CALIBRATION basis of two constant tables. Those are improvement targets,
not failures.**

---

## 1. What the spine actually computes (three distinct scores — this matters)

A persistent source of confusion — including in my own first Flag A pass — is treating
FreshContext as if it produces *one* score. It produces **three**, computed separately in
`src/core/pipeline.ts → evaluateSignal`:

1. **`freshness_score`** — pure time decay. `calculateFreshnessScore` in `decay.ts`:
   `score = 100 · e^(−λ·hoursSinceRetrieved)`. A clean, isolated exponential. Nothing else
   is mixed in. Range 0–100.

2. **`utility`** — the multiplicative trust model. `calculateContextUtility` in `utility.ts`:
   `U = R · e^(−λt) · C_date · C_status`, where R is contextual relevance (0–100), the decay
   term is its own factor, and C_date / C_status are confidence/status multipliers in [0,1].
   This is the Core scoring primitive documented in METHODOLOGY §2.3.

3. **`ranked.final_score`** — a weighted *relevance + freshness* blend. `rank.ts`:
   `final = semantic·w_s + (freshness/100)·w_f`, weights normalised to sum to 1
   (default 0.7 / 0.3).

These are orthogonal by design. **The decay term is a clean, separable factor in all three.**
There is no hidden contamination of the time signal inside the engine.

---

## 2. The Flag A measurement, and the error in its first pass (honesty on my own method)

**What was done:** pulled 1,219 real rows from the live `scrape_results` ledger
(6 active sources, ages 0–77 days). For each row computed `retained = rt_score / base_score`
and `age = now − scraped_at`, then fit `e^(−λt)` and Weibull `e^(−(t/a)^k)` to retained-vs-age
per source, with R² and within-age-bin variance.

**What the first pass concluded (WRONG):** "exponential is not validated — R² is poor/negative
across sources." This was stated, then corrected.

**Why it was wrong — the precise error:** the fit was run against `rt_score`, which in the
`scrape_results` (feed/Store) path is the **DAR feed score** `R_t = R_0 · e^(−λt)` where `R_0`
is itself a profile-relevance score (METHODOLOGY §2.2: baseline + keyword matches − penalties).
So `rt_score / base_score` does NOT isolate `e^(−λt)`; it carries `R_0`'s per-item relevance
structure and the rounding/threshold logic. Fitting a pure-time curve to a relevance-blended
number yields low R² **by construction**, not because the decay is wrong. I tested the wrong
column. The pure `freshness_score` (the actual time primitive) was never the thing fit.

**Verification that the time primitive is clean:** replicating `calculateFreshnessScore`
directly produces a textbook exponential — half-lives: Hacker News ~0.6 days, Reddit ~2.9d,
jobs ~5.8d, GitHub ~144d, arXiv ~578d. Monotonic, per-source, correct. The math primitive is
sound. (METHODOLOGY §2.5 λ table.)

**This is itself a finding:** if *I*, the author, mis-identified which score to validate, then
an external integrator will too. That is an **observability limitation** (see §3.1), not a math
failure — but it is real and it is the most important practical issue this thesis surfaces.

---

## 3. Where the spine is genuinely limited (the honest "fails / incompatible" list)

Precise limitations, ranked by how much they matter. None are "the math is wrong." Each is a
real improvement target.

### 3.1 LIMITATION — the pure time signal is not surfaced; only the blend is visible
**Severity: high (this is the real one).**
The clean `freshness_score` is computed but, in the feed/Store path, what gets persisted and
shown (`rt_score`, `relevancy_score`) is the *relevance-blended* number. A consumer — human or
model — cannot see "this is X% decayed purely due to age" as a separate, legible signal. The
time axis is real but buried. **This is exactly what makes staleness hard to audit downstream,
and it is the thing FreshContext exists to fix — so the engine should not itself bury it.**
→ *Improvement:* surface the pure decay term + a staleness verdict in the emitted envelope
(Brick 6 / the "eyes"). This is the single highest-value spine improvement.

### 3.2 LIMITATION — per-item validity is not a function of age; the model only ranks at source level
**Severity: medium. Honest scope boundary.**
The real data proves it: within a single age bin, retained relevance varies enormously
(Reddit at 36 days: 0.00–0.94; packagetrends at 77 days: 0.01–0.99). Age explains the
*source-level decay RATE* (the ordering HN-fastest → code-search-slowest is stable and real),
but it does NOT predict any individual item's retained value — that is driven by per-item
content (did this specific package die, did this post stay relevant). **So the λ model is a
correct source-volatility-ranking primitive, NOT a per-item validity oracle.** Claiming the
latter would be an overclaim the data does not support.
→ *Improvement (future, NOT now):* per-item validity needs a content/signal axis, not a pure
time function. This is the v2 north (assertion-level granularity). Until then, the honest
framing is "source-level decay rate, calibrated; per-item needs content signal."

### 3.3 LIMITATION — two constant tables are chosen, not calibrated
**Severity: medium. Honesty/defensibility issue, not correctness.**
- The λ table (`decay.ts`) values are *reference defaults* — reasoned from real anchors
  (HN cycle, job open-to-close, paper relevance spans) but not yet fitted from outcome data.
- The `DATE_CONFIDENCE_FACTORS` (1.0/0.75/0.4/0.0) and `STATUS_FACTORS` (1.0/0.65/0.4/0.0/0.5)
  in `utility.ts` are principled defaults but the specific mid-values (0.75, 0.65) are
  judgment calls, not measured.
These are not wrong — every system has tuning constants — but if asked "why 0.75?", the only
honest answer today is "reasoned default, not yet calibrated."
→ *Improvement:* the live append-only ledger (now accumulating signed verdicts) is the data
substrate to eventually *fit* these from real re-evaluation history. DATA-GATED — the ledger
started filling 2026-06-30; meaningful calibration needs weeks of rows. (This is Pass 25.)

### 3.4 LIMITATION — decay anchors to `published_at`, which is extraction-dependent
**Severity: low–medium. Known and already handled honestly.**
The whole time model depends on `published_at` / `content_date`. When that can't be extracted
or is malformed/future-dated, decay can't be computed. The spine handles this *correctly* —
`signal.ts` clears bad/future dates, `date_confidence` drops to `unknown`, and freshness goes
`null` rather than faking freshness (METHODOLOGY §2.4, §2.8 failure-honesty). So this is a
*handled* limitation, not a hole. But it means freshness coverage is only as good as date
extraction, which varies by adapter.
→ *Improvement:* better per-adapter date extraction raises freshness coverage. Incremental.

### 3.5 NON-ISSUE (explicitly cleared) — "exponential is the wrong curve"
Weibull was fit and did NOT meaningfully beat exponential on the (correctly understood) data.
Exponential = constant proportional decay is the right floor model and the data gives no
evidence to abandon it. A Weibull/per-source-shape upgrade remains *available* if future
ledger data shows a source with non-constant decay rate, but there is no current justification
to add that complexity. **Exponential stays. This is a settled question, not an open failure.**

---

## 4. What is being improved, in order

1. **Surface the pure decay signal (Brick 6 / "eyes").** Carry the clean `freshness_score` +
   `revalidate_after` + an explicit staleness verdict in the emitted envelope, so the
   time axis is legible and auditable downstream rather than buried in the blend. Directly
   fixes §3.1, the highest-value limitation. *Near-term.*
2. **Enforcement wrapper (Pass 24).** Let consumers act on the now-visible staleness verdict
   (drop/flag stale context before the model reasons). Converts the signal from advisory to
   load-bearing. *Mid-term.*
3. **Calibrate the constants from the ledger (Pass 25).** Once the signed-verdict ledger has
   weeks of rows, fit λ and the confidence/status factors from real re-evaluation history,
   replacing reasoned defaults with measured values. Fixes §3.3. *DATA-GATED.*
4. **Assertion-level validity (v2 north).** Per-claim stamping with a content/signal axis, for
   per-item validity rather than source-level ranking. Fixes §3.2. *TRACTION-GATED, post-revenue.*

---

## 5. What this thesis is NOT saying (guard against false self-criticism)

- It is NOT saying the decay math is wrong. It is a correct, clean exponential.
- It is NOT saying the multiplicative utility model is flawed. `U = R·e^(−λt)·C_date·C_status`
  is sound and correctly implemented.
- It is NOT saying exponential should be replaced. The data gives no such evidence.
- It IS saying: the pure time signal must be made *visible* (the real fix), per-item validity
  is honestly out of current scope (a known boundary), and two constant tables are reasoned-
  not-calibrated (a defensibility/honesty note with a data-gated fix).

The spine is defensible today. These improvements make it *more* defensible and more legible —
they are not repairs to a broken thing.

---

## 6. One-paragraph version (for a technical reader / the pitch)

"FreshContext's temporal core is a clean per-source exponential decay — Hacker News half-life
under a day, research papers over a year — combined into a multiplicative trust model
`U = R·e^(−λt)·C_date·C_status`. I validated it against 1,219 rows of real production data. The
decay primitive is correct; the honest boundary is that age predicts source-level volatility,
not per-item validity, and the pure time signal is currently blended into the feed score rather
than surfaced on its own. The near-term work makes that time signal explicit and verifiable in
the context envelope; per-item validity and constant calibration are deliberately staged behind
real ledger data and traction. The model is sound and I can tell you exactly where its edges
are — which is the point of a trust layer."

---
*"FreshContext measures temporal utility, not truth."* — METHODOLOGY.md
*Authored Tsumeb, Namibia, 2026-06-30.*

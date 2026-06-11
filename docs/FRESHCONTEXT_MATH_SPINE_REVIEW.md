# FreshContext Math Spine Review

> Historical review artifact. This document records the state of the math spine review on 2026-05-24 and is not current release metadata. Current package/runtime claims live in `package.json`, `server.json`, `README.md`, `docs/CORE_API.md`, `docs/SIGNAL_CONTRACT.md`, and `docs/RELEASE_NOTES.md`.

Date: 2026-05-24
Repository: `freshcontext-mcp`
Current main at review start: `0b29873 Merge pull request #23`
Reviewed package version at time of artifact: `0.3.17`
Scope: current mathematics, code implementation, provenance model, tests, and open review questions.

This document is written for technical review. It describes what FreshContext currently does, where the math lives in code, what is production-wired, what is only a Core primitive, and what should be reviewed before future Store/D1 wiring.

## 1. Executive Summary

FreshContext is built around one central idea:

```text
AI systems should not treat stale retrieved context as current truth.
```

The current math spine has four layers:

1. Freshness envelope scoring
   - Computes a normalized `freshness_score` from source timestamp age.
   - Formula: `score = 100 * e^(-lambda * t)`.
   - Used by the public FreshContext envelope and structured JSON metadata.

2. Decay-Adjusted Relevancy (DAR)
   - Computes profile/task relevance first as `R_0`.
   - Applies source-specific exponential decay to produce `R_t`.
   - Formula: `R_t = R_0 * e^(-lambda * t)`.
   - Used by the Worker Store/Ledger pipeline and live intelligence feed.

3. Context-conditioned utility
   - Pure Core primitive added after v1.2 methodology alignment.
   - Lets FreshContext score the same signal differently for different requester contexts.
   - Formula: `U(q, s, t) = R(q, s) * e^(-lambda * t) * C_date * C_status`.
   - Implemented in Core but not wired into production Store/D1 scoring yet.

4. Ha-Pri provenance
   - v1 exists today as a provenance stamp / audit reference.
   - v2 exists as a pure Core helper and tests.
   - v2 is not wired into Worker, D1, feed output, or row verification yet.

The result is a real mathematical platform spine, but not every part is production-wired. The Core layer now has the primitives needed for future clients, but Worker/D1 integration should stay deliberate.

## 2. Code Map

### Core Package

| File | Responsibility |
|---|---|
| `src/core/decay.ts` | Public envelope freshness score, lambda table, score labels |
| `src/core/envelope.ts` | FreshContext envelope construction, JSON metadata, failure downgrade before stamping |
| `src/core/rank.ts` | Public ranking blend between semantic relevance and freshness |
| `src/core/explain.ts` | Human-readable reasons for ranking outcomes |
| `src/core/utility.ts` | Context-conditioned temporal utility primitive |
| `src/core/provenance.ts` | Pure Ha-Pri v2 canonicalization, SHA-256, calculation, verification |
| `src/core/types.ts` | Public Core types |
| `src/core/index.ts` | Public Core export surface |

### Worker / Store

| File | Responsibility |
|---|---|
| `worker/src/intelligence.ts` | Worker DAR engine, base score, decay, v1 Ha-Pri, semantic fingerprinting |
| `worker/src/worker.ts` | Cron collection, D1 insert path, feed API, lazy read-time Rt recomputation |
| `worker/src/synthesize.ts` | Briefing generation from Store rows |

### Tests

| File | Responsibility |
|---|---|
| `tests/core.test.ts` | Core envelope, context utility, Ha-Pri v2 helper tests |
| `tests/mathSpine.test.ts` | DAR half-life, Worker DAR behavior, Ha-Pri v1 formula test |
| `tests/rank.test.ts` | Ranking and explanation behavior |
| `tests/workerEnvelope.test.ts` | Worker envelope behavior |
| `tests/workerCoreEnvelopeParity.test.ts` | Core/Worker envelope parity boundaries |
| `tests/coreEnvelopeOptions.test.ts` | Worker-compatible Core envelope formatting options |
| `tests/coreApiContract.test.ts` | Public Core API import/contract coverage |

## 3. Source Decay Model

FreshContext uses source-specific exponential decay.

Canonical formula:

```text
R_t = R_0 * e^(-lambda * t)
```

For simple envelope freshness:

```text
freshness_score = 100 * e^(-lambda * t)
```

Where:

- `R_0` is base relevance or utility before time decay.
- `lambda` is the source-specific decay constant.
- `t` is age in hours.
- `R_t` is the current temporal utility / decay-adjusted relevancy.
- `freshness_score` is normalized to `0..100`.

Half-life:

```text
half_life_hours = ln(2) / lambda
```

Interpretation:

- Higher `lambda` means faster decay.
- At one half-life, the score is about 50 percent of its starting value.
- At two half-lives, the score is about 25 percent.

## 4. Current Lambda Table

The Core lambda table in `src/core/decay.ts` mirrors the Worker/D1 engine.

| Adapter / source class | lambda per hour | Approx half-life |
|---|---:|---:|
| `hackernews` | `0.050` | 13.9 hours |
| `gdelt` | `0.020` | 34.7 hours |
| `reddit` | `0.010` | 69.3 hours |
| `producthunt` | `0.010` | 69.3 hours |
| `jobs` | `0.005` | 5.8 days |
| `sec_filings` | `0.005` | 5.8 days |
| `gebiz` | `0.003` | 9.6 days |
| `finance` | `0.001` | 28.9 days |
| `yc` | `0.001` | 28.9 days |
| `govcontracts` | `0.001` | 28.9 days |
| `packagetrends` | `0.0005` | 57.8 days |
| `changelog` | `0.0005` | 57.8 days |
| `github` | `0.0002` | 144.4 days |
| `reposearch` | `0.0002` | 144.4 days |
| `google_scholar` | `0.00005` | 577.6 days |
| `arxiv` | `0.00005` | 577.6 days |
| `default` | `0.001` | 28.9 days |

Composite anchors:

| Composite | lambda | Policy |
|---|---:|---|
| `landscape` | `0.050` | Hacker News drives time signal |
| `gov_landscape` | `0.001` | Anchored to gov contracts |
| `finance_landscape` | `0.001` | Anchored to finance |
| `company_landscape` | `0.005` | Anchored to SEC filing cadence |
| `idea_landscape` | `0.050` | HN / pain-signal lead |

Review note:

The Worker source still contains older wording about proprietary constants. Public methodology now frames the table as reference/default calibration values. That wording mismatch is documentation/code-comment debt, not a runtime bug.

## 5. Envelope Freshness Scoring

Implementation:

- Core: `src/core/decay.ts`
- Envelope construction: `src/core/envelope.ts`
- Worker equivalent: `worker/src/intelligence.ts`

Core formula:

```text
freshness_score = round(100 * e^(-lambda * hours_since_published))
```

Core behavior:

- Missing `content_date` returns `null`.
- Invalid `content_date` returns `null`.
- Unknown adapter falls back to `default` lambda.
- Score is clamped to `0..100`.
- Score labels:
  - `>= 90`: `current`
  - `>= 70`: `reliable`
  - `>= 50`: `verify before acting`
  - `< 50`: `use with caution`
  - `null`: `unknown`

Envelope output fields:

```text
[FRESHCONTEXT]
Source:
Published:
Retrieved:
Confidence:
Score:
---
content
[/FRESHCONTEXT]

[FRESHCONTEXT_JSON]
{
  "freshcontext": {
    "source_url": "...",
    "content_date": "...",
    "retrieved_at": "...",
    "freshness_confidence": "...",
    "freshness_score": 0,
    "adapter": "..."
  },
  "content": "..."
}
[/FRESHCONTEXT_JSON]
```

Failure honesty:

`src/core/envelope.ts` calls `looksLikeFailedAdapterContent()` before stamping. If content looks like an adapter failure:

- `content_date` is cleared to `null`
- confidence is downgraded to `low`
- `freshness_score` becomes `null`

This prevents failed upstream calls from being represented as high-confidence fresh content.

Future timestamp guard:

Core envelope scoring tolerates small clock skew but does not reward meaningfully future-dated content with a maximum freshness score. If `content_date` is more than 5 minutes after `retrieved_at`, Core returns `freshness_score: null`; stamped envelopes also downgrade confidence to `low`.

Worker DAR keeps its separate half-life fallback for Store ranking continuity. The Core guard does not change Worker DAR, D1, or Store behavior.

## 6. Worker DAR Engine

Implementation:

- `worker/src/intelligence.ts`

Pipeline:

```text
raw signal
  -> extractPublishedAt(raw)
  -> calculateBaseScore(raw, profile)
  -> applyDecay(base_score, published_at, adapter)
  -> generateAuditSig(resultId, contentHash)
  -> SignalScore
```

### 6.1 Date Extraction

Worker date extraction:

- matches ISO-like dates from 2020 onward
- rejects invalid dates that JS would silently roll over
- rejects future dates
- selects the most recent valid date
- returns `YYYY-MM-DD` or `null`

Current limitation:

It only extracts date precision, not full timestamp precision.

### 6.2 Base Score R_0

Implementation:

- `calculateBaseScore(raw, profile, extraExclusions)`

Formula is rule-based, not ML-based.

Current scoring:

```text
if raw missing or length < 20:
  R_0 = 0

if any exclusion term matches:
  R_0 = 0

start score = 40
target matches: +15 each, capped at +35
skill matches: +3 each, capped at +15
remote/location accessibility: +8
error/not found penalty: -40
clamp to 0..100 and round
```

Interpretation:

- `R_0` is semantic/profile utility before temporal decay.
- It is intentionally not a truth score.
- It asks: "Is this signal useful for this profile or watched query before considering age?"

### 6.3 Decay Application R_t

Implementation:

- `applyDecay(baseScore, publishedAt, adapter)`

Formula:

```text
R_t = R_0 * e^(-lambda * t)
```

Time handling:

- If `baseScore === 0`, returns `rt = 0`, entropy `high`, expired `true`.
- If `publishedAt` is missing or invalid, `t` defaults to one source half-life.
- If `publishedAt` is more than 5 minutes in the future, `t` defaults to one source half-life.
- Otherwise `t = max(0, now - publishedAt)` in hours.

Rounding:

- Worker `rt_score` is rounded to one decimal place.
- `relevancy_score` is `round(rt_score)` for compatibility.

Relevance flag:

```text
is_relevant = round(rt_score) >= 35
```

Expiry flag:

```text
is_expired = rt_score < 5
```

### 6.4 Entropy Labels

Entropy describes position on the decay curve, not confidence.

```text
entropyRatio = t / half_life

if entropyRatio < 0.5:
  entropy = "low"
else if entropyRatio < 1.5:
  entropy = "stable"
else:
  entropy = "high"
```

Meaning:

- `low`: signal is still near peak temporal value
- `stable`: signal is usable with some decay
- `high`: signal is significantly degraded

Review note:

The labels are historically named. "High entropy" here means high temporal degradation, not high uncertainty in the timestamp.

## 7. Context-Conditioned Utility

Implementation:

- `src/core/utility.ts`

This is a pure Core primitive. It is not wired into Worker/D1 production scoring yet.

Formula:

```text
U(q, s, t) = R(q, s) * e^(-lambda * t) * C_date * C_status
```

Where:

- `q` is requester context: user, query, agent, platform, workflow.
- `s` is a signal or database record.
- `R(q, s)` is contextual relevance, normalized `0..100`.
- `lambda` is the source-specific decay constant.
- `t` is signal age in hours.
- `C_date` is a timestamp-confidence factor.
- `C_status` is a success/partial/stale/failure factor.

Input safety:

- `contextualRelevance` clamps to `0..100`.
- invalid or negative `lambda` clamps to `0`.
- invalid or negative `ageHours` clamps to `0`.
- all reductions add human-readable reasons.

Date confidence factors:

| `dateConfidence` | Factor |
|---|---:|
| `high` | `1.0` |
| `medium` | `0.75` |
| `low` | `0.4` |
| `unknown` | `0.0` |

Status factors:

| `status` | Factor |
|---|---:|
| `success` | `1.0` |
| `partial` | `0.65` |
| `stale` | `0.4` |
| `failed` | `0.0` |
| `unknown` | `0.5` |

Important distinction:

This is the mathematically clean future-facing primitive for database, agent, workflow, and multi-context ranking. The current Worker Store path still uses `calculateBaseScore` plus DAR. The ranking API in Core also uses a simpler semantic/freshness blend.

## 8. Public Ranking Model

Implementation:

- `src/core/rank.ts`
- `src/core/explain.ts`

Formula:

```text
final_score =
  semantic_score * semantic_weight +
  freshness_component * freshness_weight
```

Defaults:

```text
semantic_weight = 0.7
freshness_weight = 0.3
```

Where:

```text
freshness_component = freshness_score / 100
```

If `freshness_score` is missing:

```text
freshness_component = 0
```

Confidence:

- failure-looking content is always `low`
- dated signal plus semantic score >= 0.7 is `high`
- dated signal or semantic score >= 0.5 is `medium`
- otherwise `low`

Ranking is stable:

- if final scores tie, original input order is preserved.

Review note:

This ranking model is simpler than context-conditioned utility. It remains useful as public Core API behavior, but future Store or agent systems may migrate toward `calculateContextUtility` once semantics are better formalized.

## 9. Semantic Fingerprinting and Deduplication

Implementation:

- `worker/src/intelligence.ts`

Current semantic fingerprint input:

```text
normalized_title | canonical_url | date
```

Source material:

- first URL-like string in raw content
- first date from raw content
- first substantial non-empty line as title

URL handling:

- known tracking params are stripped:
  - `utm_*`
  - `fbclid`
  - `gclid`
  - `mc_*`
  - `igshid`
- legitimate query identifiers are preserved.
- hash fragments are removed.

Title handling:

- lowercased
- punctuation removed
- whitespace collapsed
- truncated to 80 characters

Fingerprint output:

```text
first 16 hex chars of SHA-256(normalized_title | canonical_url | date)
```

Deduplication:

- `isDuplicate(db, fingerprint, withinHours = 48)`
- checks whether the same semantic fingerprint exists in recent Store rows.

Review note:

This is a deduplication fingerprint, not an integrity hash. It intentionally trades cryptographic completeness for stable cross-adapter matching.

## 10. Ha-Pri v1 Provenance

Implementation:

- `worker/src/intelligence.ts`
- `worker/src/worker.ts`
- `tests/mathSpine.test.ts`

Current v1 formula:

```text
ha_pri_sig = SHA-256(resultId + ":" + contentHash + ":" + "FRESHCONTEXT_DAR_V1")
```

Current Worker call:

```text
generateAuditSig(resultId, contentHash)
```

In the cron path:

```text
contentHash = simpleHash(raw)
```

`simpleHash(raw)` is a small rolling hash:

```text
h = 0
for each char:
  h = 31 * h + charCode
return abs(h).toString(36)
```

Current v1 properties:

- generated on write
- stored in D1 as `scrape_results.ha_pri_sig`
- returned by `/v1/intel/feed/:profile_id` under `intelligence_stamps`
- tested against the documented formula

Current v1 limitations:

- it signs a weak rolling `result_hash` / content hash, not canonical content SHA-256
- no read-time recomputation exists
- no row rejection exists
- not authentication, because the salt is public

Correct claim:

```text
Ha-Pri v1 is a provenance stamp and audit reference.
```

Avoid this overclaim:

```text
Ha-Pri v1 enforces tamper rejection by itself.
```

## 11. Ha-Pri v2 Core Helper

Implementation:

- `src/core/provenance.ts`
- `src/core/types.ts`
- `src/core/index.ts`
- tests in `tests/core.test.ts`

Status:

- implemented as a pure Core helper
- tested
- exported publicly from Core
- not wired into Worker/D1
- not stored in D1
- not returned in feed output
- not used to reject rows

### 11.1 Functions

```text
canonicalizeHaPriContent(input)
sha256Hex(input)
calculateHaPriV2(input)
verifyHaPriV2(input, actualSig)
```

### 11.2 Canonicalization

Current rules:

- CRLF and CR normalize to LF
- trailing spaces and tabs are trimmed from each line
- internal whitespace is preserved
- optional null/undefined fields become literal string `"null"`
- field order is stable
- SHA-256 uses UTF-8 through Node built-in crypto

### 11.3 Signing Payload

Current exact payload:

```text
FRESHCONTEXT_HA_PRI_V2
result_id=<resultId>
canonical_content_sha256=<canonicalContentSha256>
semantic_fingerprint_sha256=<semanticFingerprintSha256>
adapter=<adapter>
published_at=<publishedAt-or-null>
retrieved_at=<retrievedAt-or-null>
engine_version=<engineVersion>
```

Signature:

```text
haPriSigV2 = SHA-256(signingPayload)
```

### 11.4 Verification

```text
verifyHaPriV2(input, actualSig)
```

Returns:

- `valid` if actual signature equals recomputed signature
- `invalid` if provided signature does not match
- `unknown` if signature is null, undefined, or blank

Review note:

The helper uses Node built-in `crypto`. This is correct for the npm/Core package today. Future Worker wiring should not be assumed until the project chooses either:

- a Web Crypto-compatible implementation,
- a small environment-neutral crypto abstraction,
- or a Worker build configuration that safely supports `node:crypto`.

## 12. Store / Ledger Data Flow

Implementation:

- `worker/src/worker.ts`

Current cron write flow:

```text
watched query
  -> runAdapter()
  -> raw content
  -> simpleHash(raw) as result_hash
  -> skip if same as last result_hash
  -> semanticFingerprint(raw)
  -> skip if duplicate within 48h
  -> scoreSignal(...)
  -> INSERT INTO scrape_results
```

Stored columns include:

- `id`
- `watched_query_id`
- `adapter`
- `query`
- `raw_content`
- `result_hash`
- `is_new`
- `scraped_at`
- `relevancy_score`
- `is_relevant`
- `base_score`
- `rt_score`
- `ha_pri_sig`
- `entropy_level`
- `published_at`
- `semantic_fingerprint`
- `is_expired`

Current updates:

- `is_new` may be updated after briefing.
- watched query `last_run_at` is updated.
- scored content fields are not updated in normal read paths.

Review note:

Docs say ledger rows are immutable once written. The practical implementation mutates consumption metadata such as `is_new`, but does not mutate raw content, score, signature, or fingerprint in normal flow. The wording should be understood as "scored signal material is immutable", not "no column in the table is ever updated".

## 13. Feed Read-Time Decay

Implementation:

- `worker/src/worker.ts` route `/v1/intel/feed/:profile_id`

Important behavior:

The feed does not simply trust stored `rt_score`. It recomputes fresh `R_t` at read time:

```text
fresh_rt = applyDecay(stored_base_score, stored_published_at, adapter)
```

Then it:

- filters expired rows
- filters below `min_rt`
- sorts by fresh `R_t`
- returns `rt_score_at_write` separately for diagnostics

This prevents intelligence feed rows from being frozen at cron-time relevance.

## 14. Failure Honesty

FreshContext currently has several failure-honesty layers:

1. Core envelope guard
   - failure-looking adapter content clears `content_date`
   - confidence becomes `low`
   - freshness score becomes `null`

2. Core context utility
   - `status = failed` gives status factor `0.0`
   - `dateConfidence = unknown` gives date factor `0.0`

3. Worker base score
   - empty content returns `0`
   - explicit error content is penalized

4. Worker scoreSignal test
   - explicit upstream error output does not score relevant or fresh

This is one of the most important trust boundaries: a failed upstream call must never be dressed as fresh intelligence.

## 15. Current Test Coverage

### Envelope and Freshness

Covered:

- valid ISO content date gives numeric score
- missing date gives null score
- invalid date gives null score
- adapter-specific decay behavior
- failure-looking output downgrades confidence
- structured JSON envelope shape
- text envelope shape

Covered:

- future date tolerance in Core envelope scoring is covered by active tests.

### DAR

Covered:

- half-life behavior
- Worker applyDecay deterministic around documented half-life
- missing/future timestamps in Worker use conservative half-life fallback
- error output does not become relevant/fresh

### Context Utility

Covered:

- deterministic score
- exponential decay factor
- higher lambda decays faster
- date confidence factors
- status factors
- failed/unknown-date signals score zero
- relevance clamping
- negative age handling
- invalid lambda handling
- public exports

### Ha-Pri v1

Covered:

- v1 signature matches documented formula
- v1 emits 64-char lowercase hex signature
- v1 remains unchanged after v2 helper work

### Ha-Pri v2

Covered:

- deterministic signature
- content tamper changes content SHA and signature
- result ID binding
- engine version binding
- adapter binding
- timestamp binding
- semantic fingerprint binding
- CRLF/LF canonicalization
- verification `valid`
- verification `invalid`
- verification `unknown`
- public Core API exports

## 16. Current Non-Goals / Not Implemented

These are intentionally not implemented today:

- Ha-Pri v2 storage in D1
- `ha_pri_sig_v2` feed output
- read-time v2 verification in Worker
- rejection of tampered rows
- migration of old rows
- HMAC / secret signing
- key rotation
- vector database
- multi-agent orchestration
- production use of `calculateContextUtility`
- moving Worker Store scoring into Core

This is good. The math primitives are now real, but production wiring can be reviewed separately.

## 17. Review Risks and Questions

### 17.1 Future Timestamp Handling

Core envelope scoring now tolerates up to 5 minutes of clock skew and returns `freshness_score: null` for meaningfully future-dated content.

Status:

Resolved for Core envelope scoring in Phase 3-D. Worker DAR remains intentionally unchanged and continues to use its Store-oriented half-life fallback for meaningfully future timestamps.

### 17.2 Lambda Table Duplication

Lambda constants exist in both Core and Worker.

Question:

Should Worker import the Core lambda table to remove drift risk?

Complication:

Worker currently owns Cloudflare runtime concerns. Shared Core imports must stay compatible with Worker builds.

Recommendation:

Eventually yes, but only after confirming the Core module remains Worker-safe. Avoid pulling Node-only provenance helpers into Worker bundles accidentally.

### 17.3 Node Crypto in Core Provenance

`src/core/provenance.ts` imports `node:crypto`.

Question:

Is Core intended to stay universally Worker-compatible, or is Core allowed to include Node-only helpers as long as Worker does not import them?

Recommendation:

Document the boundary. If future Worker wiring is desired, add Web Crypto helpers or a runtime-neutral SHA-256 abstraction before importing v2 into Worker.

### 17.4 Ha-Pri v1 Documentation vs Code Comment

Earlier Worker comment wording said v1 proved the signal was scored by this engine. Because the salt is public and no secret is used, this is better described as a provenance stamp/audit reference, not proof of private origin.

Status:

Completed in Phase 3-C0 as a docs/comment-only patch. Runtime behavior was not changed.

### 17.5 Semantic Fingerprint Strength

Current semantic fingerprint is first 16 hex chars of SHA-256 over a normalized tuple.

Question:

Is 16 hex chars enough for dedup at current scale?

Recommendation:

Probably acceptable for lightweight dedup. Do not use it for integrity. Ha-Pri v2 already separates semantic fingerprint SHA-256 from canonical content SHA-256.

### 17.6 Rounding Differences

Core envelope:

- integer score

Worker DAR:

- one-decimal `rt_score`
- rounded integer `relevancy_score`

Context utility:

- returns unrounded floating score

Question:

Should public Core utilities define rounding policy explicitly?

Recommendation:

Leave context utility unrounded for composability, but document that presentation layers may round.

### 17.7 Missing Timestamp Policy

Core envelope:

- missing timestamp -> `freshness_score = null`

Worker DAR:

- missing timestamp -> assume one source half-life old

Context utility:

- unknown date confidence -> score `0`

Question:

Are these differences intentional by layer?

Current interpretation:

- envelope compatibility favors honesty/null
- Store/DAR uses conservative ranking fallback
- context utility uses explicit confidence factor

Recommendation:

Document this as layer-specific behavior, not inconsistency.

## 18. Suggested External Review Checklist

Ask reviewers to answer:

1. Is exponential decay the right base model for the current source classes?
2. Are the lambda values plausible as default/reference half-lives?
3. Is the Core future-dated envelope policy conservative enough for public context metadata?
4. Is the current `R_0` rule-based profile score acceptable as a first Store implementation?
5. Should context-conditioned utility replace or augment the Worker `R_0` model later?
6. Is `status = unknown` factor `0.5` too generous?
7. Is `dateConfidence = unknown` factor `0.0` correct?
8. Is Ha-Pri v2 canonicalization strict enough?
9. Should Ha-Pri v2 sign full semantic identity material instead of a provided semantic fingerprint?
10. Should v2 use Web Crypto compatibility now, before any Worker integration?
11. Should Store rows expose verification status publicly or only internally?
12. Is HMAC needed for the intended buyer/client trust model, or is SHA-256 tamper evidence enough?
13. Should the D1 ledger eventually become append-only with separate consumption-state tables?
14. Should Core become the only source for lambda constants?
15. Are the names `entropy_level`, `freshness_score`, `rt_score`, and `context utility` clear enough for external clients?

## 19. Recommended Next Steps

Do not wire Ha-Pri v2 into D1 immediately.

Recommended sequence:

1. Create a developer-facing Ha-Pri v2 fixture. Completed in Phase 3-C.
   - Show input row material.
   - Show canonical content hash.
   - Show signing payload.
   - Show signature.
   - Show valid / invalid / unknown verification.

2. Patch comments only. Completed in Phase 3-C0.
   - Clarify Ha-Pri v1 comments as provenance stamp / audit reference.
   - Avoid proof-of-origin language unless HMAC or private signing is added.

3. Fix Core future timestamp guard. Completed in Phase 3-D.
   - Add 5-minute clock skew tolerance.
   - Return no numeric Core freshness score for meaningfully future-dated content.
   - Activate skipped test.

4. Decide crypto compatibility.
   - Keep Node-only Core provenance for npm only, or
   - add Web Crypto variant before Worker usage.

5. Only then plan Store/D1 wiring.
   - Add columns separately.
   - Write v2 for new rows only.
   - Add read-time verification status.
   - Do not reject production rows until monitoring is mature.

## 20. Current Bottom Line

FreshContext now has a coherent math spine:

```text
Freshness envelope:
  100 * e^(-lambda * t)

DAR:
  R_t = R_0 * e^(-lambda * t)

Context-conditioned utility:
  U(q, s, t) = R(q, s) * e^(-lambda * t) * C_date * C_status

Ha-Pri v1:
  SHA-256(result_id + ":" + rolling_result_hash + ":FRESHCONTEXT_DAR_V1")

Ha-Pri v2:
  SHA-256(labelled canonical signing payload)
```

The system is not overclaimed:

- v1 is provenance, not hard tamper enforcement.
- v2 is implemented as a pure Core helper, not production Store wiring.
- context-conditioned utility exists as Core math, not yet production ranking.
- Worker DAR is live and Store-backed.
- public envelope scoring is live and Core-backed.

This is the right state for review: enough is real to evaluate, and the remaining production wiring boundaries are explicit.

# Context Integrity Benchmark v1 (CIB-1)

```bash
npm run benchmark:context-integrity
npm run benchmark:context-integrity -- --json results.json --markdown results.md --repeat 5
```

Source-checkout only. It is not part of the npm package and `package.json` `files[]` is
asserted clean of it by `tests/contextIntegrityBenchmark.test.ts`.

## What this measures

**FreshContext's own context-evaluation contract.** Given candidate context with known
properties, does the engine treat it the way the public contract says it will?

It answers one question and refuses the neighbouring ones. It is **not** an LLM quality
benchmark, **not** a model benchmark, and **not** a claim that FreshContext certifies truth.
No answer quality is measured anywhere in it.

## Why it is reproducible

Everything is local and deterministic. No network, no clock dependence, no sampling.

Freshness scoring never reads the wall clock — it works from each signal's `retrieved_at`
— and the harness passes a fixed `now` to **both** Core layers: `evaluateSignals` for the
freshness math and `interpretEvaluations` for the decision clock. Two runs over unchanged
fixtures produce an identical `result_sha256`, and a test asserts exactly that.

The harness deliberately does **not** go through the MCP tool path. `evaluateContextInput`
leaves `evaluated_at` on the server wall clock on purpose: that field is written into the
signed ledger row and returned by `/v1/verify`, so a caller able to set it could backdate an
audit record. Determinism belongs in the harness, not in the production surface.

## Families

| | Family | What it checks |
| --- | --- | --- |
| **A** | Temporal inversion | Where a staler item carries a stronger semantic score, does the age difference register? |
| **B** | Date integrity | Do unusable dates degrade to explicit low confidence instead of scoring as trustworthy? |
| **C** | Failure honesty | Is failed-looking content marked failed and excluded, rather than stamped fresh because its timestamp is recent? |
| **D** | Source-profile sensitivity | **Which** profile fields are load-bearing, and which are declarative? |
| **E** | Determinism | Do identical inputs at a fixed clock produce an identical digest across repeated runs? |
| **F** | Baseline comparison | How does FreshContext's ordering differ from semantic-score-only ordering? |

E and F are computed by the runner across every case rather than authored as fixtures.

### On family D — read this before quoting it

Family D does **not** assert broad profile-driven differentiation, because the code does not
do that. Most Source Profile metadata never reaches the scoring path:

- `default_decay_lambda` and `half_life_hours` **do not affect freshness scoring.**
  `evaluateSignal` uses `LAMBDA[signal.source_type]` and never receives a profile.
  `half_life_hours` is used in exactly one place: deriving `revalidate_after`.
- `date_policy` has **no branch at all** — it only contributes a reason string.
- `failure_policy` is **not read** in the decision path; failure handling is driven by
  `signal.status` and confidence.
- What does branch: `authority_hint: "high"` with a citation intent, and two hardcoded
  profile-id sets in `decision.ts`.

So D-1 asserts that five profiles produce an **identical** outcome for a comfortably fresh
signal, and D-2/D-3 pin the branches that are real. This documents the engine as it is. A
benchmark asserting differentiation that the code does not implement would be the exact
failure this repository's diligence work exists to remove.

### On B-2 — a known gap, pinned rather than hidden

A calendar-invalid date (`2024-02-30`) is **accepted** by Core: JS `Date` rolls it forward to
1 March and it scores as merely old rather than untrustworthy. The Worker's DAR ingestion
path rejects the same input via an ISO round-trip check; Core does not.

That case is in the fixtures with `known_gap` stating this. It is pinned so the gap is
visible to a reader and so closing it later shows up as a benchmark change rather than
passing unnoticed.

## Output

`--json` emits a run manifest carrying benchmark and fixture versions, git SHA, FreshContext
version, Node version, the fixed benchmark clock, `fixture_sha256`, per-family results,
aggregate metrics, every failing check, an explicit limitations list, and `result_sha256`.

`result_sha256` excludes `git_sha` and `node_version`, so it digests **the measurement**
rather than the machine it ran on. That is what makes two runs on different machines
comparable.

`--markdown` emits the same run as a short human-readable summary.

## Metrics, and what they are not

- `total_contract_pass_rate` — checks passed over checks run
- `determinism_rate` — cases whose digest was stable across `--repeat` runs
- `temporal_correction_rate` — labelled inversion cases where FreshContext's order differs
  from the semantic-only baseline

**These rates describe the fixtures, not a population.** They are authored cases, not sampled
traffic, so they carry no statistical significance and no accuracy estimate for real-world
context. They are a regression contract: if a rate moves, something in the engine moved.

The current temporal correction rate is **2 of 3**, and the case that does not correct
(A-2) is in the fixtures on purpose. There, the semantic gap is wide enough that ranking does
not reorder — but the decision layer still returns `needs_refresh` on the stale item. That is
the honest shape of the behaviour: the correction lives in the decision, not always in the
ranking. A benchmark reporting 3 of 3 would have required dropping the case that shows it.

## Relationship to the other evidence surfaces

| Surface | Proves |
| --- | --- |
| **CIB-1** (this) | Evaluation behaviour — how context is treated, reproducibly, offline |
| `attestation-proof` workflow | Live signing and independent verifiability against production |
| `canonical-endpoint-proof` workflow | The published hostname serves this Worker |

They are deliberately separate. This benchmark signs nothing and contacts nothing.

## What this does not prove

- That FreshContext determines truth. It does not, and no family tests for it.
- That any real-world corpus behaves like these fixtures.
- Anything about Worker throughput, network latency, or capacity. Evaluation here is local
  Core only, and there is no SLA claim anywhere in it.
- That the engine is correct in cases nobody authored. It pins the contract that exists.

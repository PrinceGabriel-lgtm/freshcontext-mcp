# Pass 5 — Phase 1 Audit (read-only)

Generated: 2026-05-10
Scope: confirm gap between Worker's `stamp()` and the npm package's `formatForLLM()` + spec; identify obstacles to Phase 2 implementation.

## TL;DR — STOP recommended at Phase 1.

Two findings before code. The second is mechanical. **The first is a model divergence that requires a human design decision before Phase 2 can ship anything sane.**

1. **DECAY-MODEL DIVERGENCE (blocker).** The npm package's `freshnessStamp.ts` uses a **linear** decay (`100 − daysSince × rate`), while the Worker's deployed DAR engine in `intelligence.ts` uses **exponential** (`R₀ × e^(−λt)`). These are different mathematical models. The METHODOLOGY.md spec specifies exponential. The npm package is the linear approximation. Pass 5's stated goal — "match the npm `formatForLLM`" — would mean shipping linear decay numbers in the worker envelope, which would conflict with the exponential DAR engine that already drives D1 scoring and intel feed. **Cannot proceed mechanically.** Needs a one-line decision (see options below).

2. **Adapter-name mismatches in `stamp()` calls (mechanical).** 13 of 22 `stamp()` call sites in `worker.ts` pass an adapter name that does **not** appear in `intelligence.ts:LAMBDA`. Once `stamp()` starts computing `freshness_score`, all 13 will silently fall through to the default decay rate. Listed below — fixable in Phase 2.

## Finding 1 — Decay model divergence

### npm `src/tools/freshnessStamp.ts` (linear, integer points/day)

```ts
const DECAY_RATES: Record<string, number> = {
  finance:       5.0,   // half-life via this formula ≈ 10d
  search_jobs:   3.0,   // ~17d
  hackernews:    2.0,   // ~25d
  reddit:        2.0,
  producthunt:   2.0,
  yc:            1.5,
  govcontracts:  1.5,
  github:        1.0,
  repoSearch:    1.0,
  packageTrends: 1.0,
  changelog:     1.0,
  scholar:       0.3,
  arxiv:         0.3,
  // default: 1.5
};

// Score = max(0, round(100 − daysSince × decayRate))
```

### Worker `worker/src/intelligence.ts` (exponential, λ per **hour**)

```ts
const LAMBDA: Record<string, number> = {
  hackernews:     0.050,   // t½ ≈ 14h
  reddit:         0.010,   // t½ ≈ 3d
  producthunt:    0.010,
  jobs:           0.005,   // t½ ≈ 6d
  finance:        0.001,   // t½ ≈ 29d
  yc:             0.001,
  packagetrends:  0.0005,  // t½ ≈ 58d
  github:         0.0002,  // t½ ≈ 5mo
  reposearch:     0.0002,
  google_scholar: 0.00005, // t½ ≈ 1.6y
  arxiv:          0.00005,
  default:        0.001,
};

// Score = R₀ × exp(−λ × hoursSince)
```

### What this means in practice

Same content, same age, scored by both:

| Adapter | Age | npm score | worker DAR | Δ |
|---|---|---|---|---|
| `finance` | 1 day | 95 | 98 | +3 |
| `finance` | 30 days | 0 (clamp) | 49 | +49 |
| `finance` | 90 days | 0 (clamp) | 11 | +11 |
| `hackernews` | 1 day | 98 | 30 | −68 |
| `hackernews` | 7 days | 86 | 0.1 | −86 |
| `arxiv` | 30 days | 91 | 96 | +5 |
| `arxiv` | 1 year | 0 (clamp) | 65 | +65 |

The two tables produce wildly different freshness numbers. They are **not** approximations of each other; they encode different beliefs about how each source decays. The half-life columns in the comments don't even agree:

| Adapter | Comment in `freshnessStamp.ts` | Comment in `intelligence.ts` |
|---|---|---|
| finance | half-life ≈ 10d | t½ ≈ 29d |
| hackernews | half-life ≈ 25d | t½ ≈ 14h |
| arxiv | half-life ≈ 167d | t½ ≈ 1.6y (~580d) |

`hackernews` is the most extreme: npm says it stays fresh for weeks, worker engine says it dies in hours. These can't both be right.

### Why this is a blocker for Phase 2

Pass 5's goal as written ("port npm `formatForLLM` into the worker") cannot be done literally without one of these regressions:

- **Option A — port npm's linear table.** Worker envelope freshness_score uses linear decay. But the cron, D1 storage, intel feed, and the entire deployed DAR engine use exponential decay. So a tool's `/mcp` response would show `Score: 86/100 (reliable)` for a 7-day-old HN story while the same story in `/v1/intel/feed/...` is marked `is_expired: 1` because its `rt_score < 5`. Two different numbers for the same fact, in the same product.

- **Option B — keep exponential, port the worker's LAMBDA into the envelope.** The numbers stay consistent across the system (envelope and intel feed both reflect the engine). But the npm package and the worker would emit different freshness scores for identical content — same npm `extract_hackernews` and worker `extract_hackernews` would disagree by ~70 points on a 1-day-old story.

- **Option C — make both packages exponential, treat npm as out of date.** The spec (`METHODOLOGY.md`) says exponential. Update the npm package's `freshnessStamp.ts` to match the worker's LAMBDA. This requires releasing a new npm version (`0.3.16`), but yields one consistent model across the project.

- **Option D — make both packages linear, treat worker engine as out of spec.** Pull npm's table down into worker, replace `LAMBDA` and `applyDecay()` with linear math. Larger blast radius — affects cron, intel feed, briefing scoring, all D1 stored values. Probably not desirable.

**My read:** Option C is the right call. The project's whitepaper, spec, and methodology all describe the exponential model. The npm `freshnessStamp.ts` is a simplification that predates the full DAR engine and got out of sync. Aligning the npm package to the spec is one file change there plus a version bump. Pass 5 then becomes "port the spec-compliant exponential calculation into worker `stamp()`", which is mechanical.

But this is a design call, not a mechanical fix. **I am stopping for your decision.**

## Finding 2 — Adapter-name mismatches in `stamp()` calls

22 `stamp()` call sites in `worker.ts`. Adapter name passed (5th argument) checked against `LAMBDA` keys in `intelligence.ts`.

| Line | Tool | Adapter name in `stamp()` | In `LAMBDA`? | Should be |
|---|---|---|---|---|
| 847 | extract_github | `github` | ✓ | — |
| 879 | extract_hackernews (Algolia) | `hackernews` | ✓ | — |
| 897 | extract_hackernews (scrape) | `hackernews` | ✓ | — |
| 927 | extract_scholar | `google_scholar` | ✓ | — |
| 956 | extract_yc | `ycombinator` | ❌ | `yc` |
| 980 | search_repos | `github_search` | ❌ | `reposearch` |
| 1012 | package_trends | `package_registry` | ❌ | `packagetrends` |
| 1043 | extract_reddit | `reddit` | ✓ | — |
| 1071 | extract_producthunt | `producthunt` | ✓ | — |
| 1102 | extract_finance | `finance` | ✓ | — (Pass 4 fixed) |
| 1142 | search_jobs | `jobs` | ✓ | — (Worker uses `jobs`; LAMBDA has `jobs`) |
| 1173 | extract_landscape | `landscape` | ❌ | needs new entry or inherit |
| 1188 | extract_arxiv | `arxiv` | ✓ | — |
| 1202 | extract_changelog | `changelog` | ❌ | needs new entry |
| 1216 | extract_gdelt | `gdelt` | ❌ | needs new entry |
| 1230 | extract_gebiz | `gebiz` | ❌ | needs new entry |
| 1244 | extract_govcontracts | `govcontracts` | ❌ | needs new entry |
| 1258 | extract_sec_filings | `sec_filings` | ❌ | needs new entry |
| 1302 | extract_gov_landscape | `gov_landscape` | ❌ | needs new entry |
| 1338 | extract_finance_landscape | `finance_landscape` | ❌ | needs new entry |
| 1373 | extract_company_landscape | `company_landscape` | ❌ | needs new entry |
| 1410 | extract_idea_landscape | `idea_landscape` | ❌ | needs new entry |

**Count: 13 of 22 sites silently fall through to `LAMBDA.default = 0.001/h` (≈ 29-day half-life).**

This is invisible today because `stamp()` doesn't use the rate at all. **The moment Pass 5 ships and `stamp()` starts computing `freshness_score`, every one of these 13 tools will be scored as if it were 29-day half-life content.** A 1-week-old HN composite with `landscape` would show `Score: 95/100` instead of expiring properly.

**Composite tools** are interesting — they aggregate multiple sources. `gov_landscape` blends govcontracts (1-yr feed) with HN (hours). One decay rate cannot be right for both. Phase 2 needs to decide:

- Inherit the rate of the **most aggressive** component (HN-fast for landscapes that include HN) → conservative, correct floor
- Use the rate of the **anchor** component (govcontracts for `gov_landscape`)
- Add new entries for landscape-level decay calibrated empirically

I'd recommend "anchor component" — the composite is named after its primary signal source — but flag this for your call.

## Finding 3 — `stamp()` is the only envelope writer

Confirmed via grep: every tool path goes through the single `stamp()` helper at `worker.ts:190`. No tool writes its own `[FRESHCONTEXT]` block directly. So the surface for Pass 5 is that one function.

## Finding 4 — Downstream parsers won't break on additive changes

Verified: the envelope is only emitted on the `/mcp` path (tool responses). Cron stores raw scrape output in D1 (no envelope). `/v1/intel/feed` synthesises its own JSON. Briefing synthesis reads from D1 directly. So adding a `Score:` line and a trailing `[FRESHCONTEXT_JSON]` block has no downstream parser to break — the only consumer is the calling LLM.

## Recommendation for Phase 2

**Do not start Phase 2 until Finding 1 is resolved.** I'd vote for Option C (make npm exponential, then port mechanically), but it changes the npm package and requires a version bump, so it's your call.

If you want to proceed with Phase 2, please reply with:

1. **Decay model decision.** A / B / C / D from Finding 1.
2. **Composite decay rates.** Anchor component (recommended) / most-aggressive / new empirical entries.
3. **Whether to ship the 13 adapter-name fixes in Pass 5** alongside the freshness_score wire-up, or split into a separate small commit first.

Phase 1 complete. Stopping for human decision.

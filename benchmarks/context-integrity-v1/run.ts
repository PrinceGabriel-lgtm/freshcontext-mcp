/**
 * Context Integrity Benchmark v1 (CIB-1)
 *
 * Measures FreshContext's own context-evaluation contract against authored fixtures.
 * It is NOT an LLM quality benchmark, NOT a model benchmark, and NOT a claim that
 * FreshContext certifies truth. It asks one question: given candidate context with known
 * properties, does the engine treat it the way the public contract says it will?
 *
 * Determinism note: this harness passes `now` to BOTH layers — evaluateSignals (freshness
 * math) and interpretEvaluations (decision clock). That is what the Core options are
 * documented for. It deliberately does not go through the MCP tool path, which leaves
 * evaluated_at on the server wall clock on purpose: that field lands in the signed ledger
 * row, and a caller who could set it could backdate an audit record.
 *
 * Usage:
 *   npm run benchmark:context-integrity
 *   npm run benchmark:context-integrity -- --json out.json --markdown out.md --repeat 5
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateSignals,
  interpretEvaluations,
  getSourceProfile,
} from "../../packages/core/src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const BENCHMARK_VERSION = "1.0.0";

/* ── fixture types ─────────────────────────────────────────────────────────── */

interface BenchSignal extends Record<string, unknown> {
  id: string;
  source: string;
  source_type: string;
}
interface BenchAssert {
  order?: string[];
  semantic_only_order?: string[];
  corrects_inversion?: boolean;
  decisions?: Record<string, string>;
  freshness_null?: string[];
  status_failed?: string[];
  date_confidence?: Record<string, string>;
  identical_across_profiles?: boolean;
  diverges_across_profiles?: boolean;
  decisions_by_profile?: Record<string, string>;
  known_gap?: string;
}
interface BenchCase {
  id: string;
  description: string;
  profile?: string;
  profiles?: string[];
  intent: string;
  signals: BenchSignal[];
  assert: BenchAssert;
}
interface BenchFamily { id: string; name: string; claim: string; cases: BenchCase[] }
interface Fixtures { benchmark: string; fixture_version: string; now: string; note: string; families: BenchFamily[] }

/* ── evaluation ────────────────────────────────────────────────────────────── */

interface Observed {
  order: string[];
  freshness: Record<string, number | null>;
  final: Record<string, number | null>;
  decisions: Record<string, string>;
  status: Record<string, string>;
  dateConfidence: Record<string, string>;
}

/** One deterministic evaluation of one case under one profile. */
function evaluateCase(kase: BenchCase, profileId: string, now: string): Observed {
  const profile = getSourceProfile(profileId);
  if (!profile) throw new Error(`${kase.id}: unknown source profile ${profileId}`);

  // `id` is benchmark bookkeeping, not part of Signal Contract v1. Strip it before
  // evaluation and recover identity by source URL, so the engine sees only real input.
  const bySource = new Map<string, string>();
  const inputs = kase.signals.map(({ id, ...signal }) => {
    bySource.set(String(signal.source), id);
    return signal;
  });

  const evaluations = evaluateSignals(inputs as never, { now });
  const decisions = interpretEvaluations(evaluations, {
    sourceProfile: profile,
    intentProfile: kase.intent as never,
    now,
  });

  const observed: Observed = { order: [], freshness: {}, final: {}, decisions: {}, status: {}, dateConfidence: {} };
  evaluations.forEach((evaluation, index) => {
    const id = bySource.get(evaluation.signal.source) ?? evaluation.signal.source;
    observed.order.push(id);
    observed.freshness[id] = evaluation.freshness_score ?? null;
    const final = evaluation.ranked?.final_score;
    observed.final[id] = typeof final === "number" ? Number(final.toFixed(6)) : null;
    observed.decisions[id] = decisions[index].decision;
    observed.status[id] = String(evaluation.signal.status);
    observed.dateConfidence[id] = String(evaluation.signal.date_confidence);
  });
  return observed;
}

/** Family F baseline: order by semantic_score alone, descending, input order on ties. */
function semanticOnlyOrder(kase: BenchCase): string[] {
  return kase.signals
    .map((s, index) => ({ id: s.id, score: Number(s.semantic_score ?? 0), index }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map((s) => s.id);
}

/* ── checks ────────────────────────────────────────────────────────────────── */

interface Check { case_id: string; family: string; check: string; pass: boolean; detail?: string }

function checkCase(family: BenchFamily, kase: BenchCase, now: string, checks: Check[]): void {
  const add = (check: string, pass: boolean, detail?: string) =>
    checks.push({ case_id: kase.id, family: family.id, check, pass, ...(detail ? { detail } : {}) });
  const a = kase.assert;

  if (kase.profiles) {
    // Multi-profile case: the unit under test is whether outcomes diverge.
    const perProfile = new Map<string, Observed>();
    for (const p of kase.profiles) perProfile.set(p, evaluateCase(kase, p, now));
    const signatures = new Map<string, string>();
    for (const [p, o] of perProfile) signatures.set(p, JSON.stringify([o.order, o.freshness, o.final, o.decisions]));
    const distinct = new Set(signatures.values()).size;

    if (a.identical_across_profiles) {
      add("identical_across_profiles", distinct === 1,
        distinct === 1 ? undefined : `${distinct} distinct outcomes across ${kase.profiles.length} profiles`);
    }
    if (a.diverges_across_profiles) {
      add("diverges_across_profiles", distinct > 1,
        distinct > 1 ? undefined : "every profile produced an identical outcome");
    }
    if (a.decisions_by_profile) {
      for (const [p, want] of Object.entries(a.decisions_by_profile)) {
        const got = perProfile.get(p);
        const first = got ? got.decisions[Object.keys(got.decisions)[0]] : undefined;
        add(`decision[${p}]`, first === want, first === want ? undefined : `got ${first}, expected ${want}`);
      }
    }
    return;
  }

  const o = evaluateCase(kase, kase.profile as string, now);

  if (a.order) {
    const same = JSON.stringify(o.order) === JSON.stringify(a.order);
    add("rank_order", same, same ? undefined : `got [${o.order}], expected [${a.order}]`);
  }
  if (a.semantic_only_order) {
    const baseline = semanticOnlyOrder(kase);
    const same = JSON.stringify(baseline) === JSON.stringify(a.semantic_only_order);
    add("baseline_semantic_only_order", same, same ? undefined : `got [${baseline}], expected [${a.semantic_only_order}]`);
    if (a.corrects_inversion !== undefined) {
      const corrected = JSON.stringify(o.order) !== JSON.stringify(baseline);
      add("corrects_inversion", corrected === a.corrects_inversion,
        corrected === a.corrects_inversion ? undefined : `correction=${corrected}, expected ${a.corrects_inversion}`);
    }
  }
  for (const [id, want] of Object.entries(a.decisions ?? {})) {
    add(`decision[${id}]`, o.decisions[id] === want, o.decisions[id] === want ? undefined : `got ${o.decisions[id]}, expected ${want}`);
  }
  for (const id of a.freshness_null ?? []) {
    add(`freshness_null[${id}]`, o.freshness[id] === null, o.freshness[id] === null ? undefined : `got ${o.freshness[id]}`);
  }
  for (const id of a.status_failed ?? []) {
    add(`status_failed[${id}]`, o.status[id] === "failed", o.status[id] === "failed" ? undefined : `got ${o.status[id]}`);
  }
  for (const [id, want] of Object.entries(a.date_confidence ?? {})) {
    add(`date_confidence[${id}]`, o.dateConfidence[id] === want, o.dateConfidence[id] === want ? undefined : `got ${o.dateConfidence[id]}`);
  }
}

/* ── determinism (family E) ────────────────────────────────────────────────── */

function caseDigest(kase: BenchCase, now: string): string {
  const profiles = kase.profiles ?? [kase.profile as string];
  const payload = profiles.map((p) => [p, evaluateCase(kase, p, now)]);
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/* ── main ──────────────────────────────────────────────────────────────────── */

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function gitSha(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
  } catch { return null; }
}

function main(): void {
  const fixturePath = join(HERE, "fixtures.json");
  const fixtureRaw = readFileSync(fixturePath, "utf8");
  const fixtures = JSON.parse(fixtureRaw) as Fixtures;
  const now = fixtures.now;
  const repeat = Math.max(2, Number(arg("--repeat") ?? 3));

  const checks: Check[] = [];
  for (const family of fixtures.families) {
    for (const kase of family.cases) checkCase(family, kase, now, checks);
  }

  // Family E — the same fixed inputs at the same fixed clock must digest identically.
  let determinismPass = 0;
  let determinismTotal = 0;
  for (const family of fixtures.families) {
    for (const kase of family.cases) {
      determinismTotal += 1;
      const digests = new Set<string>();
      for (let i = 0; i < repeat; i += 1) digests.add(caseDigest(kase, now));
      const stable = digests.size === 1;
      if (stable) determinismPass += 1;
      checks.push({
        case_id: kase.id, family: "E", check: `determinism_x${repeat}`, pass: stable,
        ...(stable ? {} : { detail: `${digests.size} distinct digests across ${repeat} runs` }),
      });
    }
  }

  // Family F — how often FreshContext's order differs from a semantic-only baseline,
  // counted only over cases that declare a baseline.
  const inversionCases = fixtures.families.flatMap((f) => f.cases)
    .filter((k) => k.assert.semantic_only_order && !k.profiles);
  let corrected = 0;
  for (const kase of inversionCases) {
    const o = evaluateCase(kase, kase.profile as string, now);
    if (JSON.stringify(o.order) !== JSON.stringify(semanticOnlyOrder(kase))) corrected += 1;
  }

  const byFamily: Record<string, { pass: number; total: number }> = {};
  for (const c of checks) {
    byFamily[c.family] ??= { pass: 0, total: 0 };
    byFamily[c.family].total += 1;
    if (c.pass) byFamily[c.family].pass += 1;
  }
  const passed = checks.filter((c) => c.pass).length;
  const rate = (n: number, d: number) => (d === 0 ? null : Number((n / d).toFixed(4)));

  const results = {
    benchmark_name: fixtures.benchmark,
    benchmark_version: BENCHMARK_VERSION,
    fixture_version: fixtures.fixture_version,
    git_sha: gitSha(),
    freshcontext_version: JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version,
    node_version: process.version,
    benchmark_clock: now,
    fixture_sha256: createHash("sha256").update(fixtureRaw).digest("hex"),
    case_count: fixtures.families.reduce((n, f) => n + f.cases.length, 0),
    check_count: checks.length,
    per_family: Object.fromEntries(
      Object.entries(byFamily).map(([id, v]) => [id, { ...v, rate: rate(v.pass, v.total) }]),
    ),
    metrics: {
      total_contract_pass_rate: rate(passed, checks.length),
      determinism_rate: rate(determinismPass, determinismTotal),
      temporal_correction_rate: rate(corrected, inversionCases.length),
      temporal_correction_basis: `${corrected}/${inversionCases.length} labelled inversion cases`,
    },
    failures: checks.filter((c) => !c.pass),
    limitations: [
      "Authored fixtures, not sampled traffic. These rates describe the fixtures, not a population.",
      "Not an LLM or model benchmark. Nothing here measures answer quality.",
      "FreshContext does not certify truth. A decision describes how context was treated and why.",
      "temporal_correction_rate counts only cases that declare a semantic-only baseline.",
      "Determinism is measured at a fixed benchmark clock passed to both Core layers. Callers that omit `now` get wall-clock evaluated_at by design.",
      "Local Core evaluation only. Not Worker throughput, not network latency, not a capacity or SLA claim.",
    ],
  };
  const resultForDigest = { ...results } as Record<string, unknown>;
  delete resultForDigest.git_sha;
  delete resultForDigest.node_version;
  (results as Record<string, unknown>).result_sha256 =
    createHash("sha256").update(JSON.stringify(resultForDigest)).digest("hex");

  // ── performance, opt-in and observational ──────────────────────────────────
  // Deliberately NOT part of result_sha256 and NOT a pass/fail gate: timings vary with
  // runner hardware, so a latency threshold in CI would fail for reasons that have
  // nothing to do with the engine.
  if (process.argv.includes("--perf")) {
    const batch = fixtures.families.flatMap((f) => f.cases).filter((k) => !k.profiles);
    const iterations = Math.max(20, Number(arg("--perf-iterations") ?? 200));
    const durations: number[] = [];
    let evaluated = 0;
    for (let i = 0; i < iterations; i += 1) {
      const start = process.hrtime.bigint();
      for (const kase of batch) {
        evaluateCase(kase, kase.profile as string, now);
        evaluated += kase.signals.length;
      }
      durations.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    durations.sort((a, b) => a - b);
    const at = (q: number) => Number(durations[Math.min(durations.length - 1, Math.floor(durations.length * q))].toFixed(4));
    const totalMs = durations.reduce((a, b) => a + b, 0);
    (results as Record<string, unknown>).performance = {
      note: "Local Core microbenchmark; not production Worker throughput, not network latency, and not a capacity/SLA claim. Excluded from result_sha256 because it is machine-dependent.",
      iterations,
      signals_evaluated: evaluated,
      total_elapsed_ms: Number(totalMs.toFixed(3)),
      evaluations_per_second: Number((evaluated / (totalMs / 1000)).toFixed(1)),
      per_batch_p50_ms: at(0.5),
      per_batch_p95_ms: at(0.95),
    };
  }

  const jsonOut = arg("--json");
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2) + "\n");

  const md = [
    `# Context Integrity Benchmark v1`,
    ``,
    `| | |`,
    `| --- | --- |`,
    `| Benchmark | \`${results.benchmark_name}\` v${results.benchmark_version} |`,
    `| Fixtures | v${results.fixture_version}, sha256 \`${results.fixture_sha256.slice(0, 16)}…\` |`,
    `| FreshContext | ${results.freshcontext_version} |`,
    `| Commit | \`${(results.git_sha ?? "unknown").slice(0, 12)}\` |`,
    `| Benchmark clock | ${results.benchmark_clock} |`,
    `| Cases / checks | ${results.case_count} / ${results.check_count} |`,
    ``,
    `## Metrics`,
    ``,
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Total contract pass rate | ${results.metrics.total_contract_pass_rate} |`,
    `| Determinism rate | ${results.metrics.determinism_rate} |`,
    `| Temporal correction rate | ${results.metrics.temporal_correction_rate} (${results.metrics.temporal_correction_basis}) |`,
    ``,
    `## Per family`,
    ``,
    `| Family | Pass | Total | Rate |`,
    `| --- | --- | --- | --- |`,
    ...Object.entries(results.per_family).map(([id, v]) => `| ${id} | ${v.pass} | ${v.total} | ${v.rate} |`),
    ``,
    `## What this does not prove`,
    ``,
    ...results.limitations.map((l) => `- ${l}`),
    ``,
  ].join("\n");
  const mdOut = arg("--markdown");
  if (mdOut) writeFileSync(mdOut, md);

  console.log(md);
  if (results.failures.length > 0) {
    console.error(`\n${results.failures.length} failing check(s):`);
    for (const f of results.failures) console.error(`  ${f.family}/${f.case_id} ${f.check}: ${f.detail ?? ""}`);
    process.exitCode = 1;
  }
}

main();

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { evaluateWorkflow } from "../service-kits/common.ts";

const tsxCli = path.resolve("node_modules/tsx/dist/cli.mjs");

function runScript(script: string, fixture: string) {
  const output = mkdtempSync(path.join(tmpdir(), "freshcontext-service-kit-"));
  const result = spawnSync(process.execPath, [tsxCli, path.resolve(script), path.resolve(fixture), output], { encoding: "utf8" });
  return { output, result };
}

test("service kit evaluates real Core output and preserves handoff honesty", () => {
  const report = evaluateWorkflow({
    workflow_id: "test-workflow",
    profile: "academic_research",
    intent: "citation_check",
    now: "2026-09-21T10:00:00.000Z",
    signals: [
      { id: "good", source: "https://arxiv.org/abs/2609.00001", source_type: "arxiv", title: "Recent paper", content: "Recent relevant research.", published_at: "2026-09-18T00:00:00.000Z", retrieved_at: "2026-09-21T09:50:00.000Z", semantic_score: 0.96, date_confidence: "high", status: "success" },
      { id: "failed", source: "https://arxiv.org/abs/2609.99999", source_type: "arxiv", title: "Unavailable", content: "[ERROR] upstream fetch failed", published_at: null, retrieved_at: "2026-09-21T09:50:00.000Z", semantic_score: 0.1, date_confidence: "unknown", status: "failed" },
    ],
  });
  assert.equal(report.summary.total, 2);
  assert.ok(report.summary.handoff_safe >= 1);
  assert.ok(report.summary.handoff_blocked >= 1);
  assert.ok(report.items.some((item) => item.decision === "exclude" && item.safe_for_agent_handoff === false));
});

test("assessment runner emits machine-readable and human evidence", () => {
  const { output, result } = runScript("service-kits/assessment.ts", "service-kits/examples/assessment.example.json");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(path.join(output, "assessment-evidence.json")), true);
  assert.equal(existsSync(path.join(output, "assessment-evidence.md")), true);
  const body = JSON.parse(readFileSync(path.join(output, "assessment-evidence.json"), "utf8"));
  assert.equal(body.schema, "freshcontext.service.assessment.v1");
  assert.equal(body.workflow.summary.total, 3);
  assert.match(readFileSync(path.join(output, "assessment-evidence.md"), "utf8"), /Human assessment required/);
});

test("acceptance runner passes the deterministic example suite", () => {
  const { output, result } = runScript("service-kits/acceptance.ts", "service-kits/examples/acceptance.example.json");
  assert.equal(result.status, 0, result.stderr + "\n" + result.stdout);
  const body = JSON.parse(readFileSync(path.join(output, "acceptance-evidence.json"), "utf8"));
  assert.equal(body.schema, "freshcontext.service.acceptance.v1");
  assert.equal(body.pass, true);
  assert.equal(body.total, 2);
});

test("multi-workflow runner aggregates separately evaluated workflows", () => {
  const { output, result } = runScript("service-kits/multi-workflow.ts", "service-kits/examples/multi-workflow.example.json");
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(readFileSync(path.join(output, "multi-workflow-evidence.json"), "utf8"));
  assert.equal(body.schema, "freshcontext.service.multi-workflow.v1");
  assert.equal(body.summary.workflows, 2);
  assert.equal(body.summary.total, 4);
});

test("build-to-spec validator emits milestone acceptance evidence", () => {
  const { output, result } = runScript("service-kits/build-spec.ts", "service-kits/examples/build-spec.example.json");
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(readFileSync(path.join(output, "build-spec.json"), "utf8"));
  assert.equal(body.schema, "freshcontext.service.build-spec.v1");
  assert.equal(body.milestones.length, 2);
  assert.deepEqual(body.validation_warnings, []);
});

// ---------------------------------------------------------------------------
// The commercial guarantees. Every test above asserts status === 0, so nothing
// pinned the behaviour a Service Order actually sells: that a failed acceptance
// scenario is loud. These do.
// ---------------------------------------------------------------------------

function runWithFixture(script: string, fixture: unknown) {
  const dir = mkdtempSync(path.join(tmpdir(), "freshcontext-service-kit-fixture-"));
  const file = path.join(dir, "fixture.json");
  writeFileSync(file, JSON.stringify(fixture, null, 2));
  return runScript(script, file);
}

test("acceptance runner exits non-zero when a contracted scenario fails", () => {
  // Same suite the passing test uses, with one expectation inverted: assert that
  // recent, well-provenanced context is NOT handoff-safe. The engine disagrees,
  // so the scenario must fail and the runner must say so in its exit code —
  // that is what makes an acceptance schedule enforceable rather than a demo.
  const suite = JSON.parse(readFileSync("service-kits/examples/acceptance.example.json", "utf8"));
  const inverted = suite.scenarios.find((s: { id: string }) => s.id === "A-01");
  assert.ok(inverted, "example suite must still contain scenario A-01");
  inverted.expected.safe_for_agent_handoff = false;

  const { output, result } = runWithFixture("service-kits/acceptance.ts", suite);
  assert.notEqual(result.status, 0, "a failed acceptance scenario must not exit 0");

  const body = JSON.parse(readFileSync(path.join(output, "acceptance-evidence.json"), "utf8"));
  assert.equal(body.pass, false);
  assert.ok(body.passed < body.total, "the failing scenario must be counted as failed");
  const failed = body.scenarios.find((s: { id: string }) => s.id === "A-01");
  assert.equal(failed.pass, false);
});

test("degraded context is never promoted to a primary citation", () => {
  // The invariant the product actually rests on, over the three degraded shapes
  // a client fixture arrives in.
  //
  // Note what is NOT asserted: that stale content is handoff-unsafe. A 2019
  // document with high date confidence comes back use_as_background and
  // safe_for_agent_handoff = true, and that is correct. Its age is known and
  // labelled, so an agent receiving it WITH that decision has been told what it
  // is. The failure this engine exists to prevent is staleness that is
  // invisible, not staleness that is disclosed. Unknown, not old, is the
  // dangerous state — which is why the undated signal IS blocked while the
  // older one is not.
  const report = evaluateWorkflow({
    workflow_id: "degraded-inputs",
    profile: "official_docs",
    intent: "developer_adoption",
    now: "2026-09-21T10:00:00.000Z",
    signals: [
      { id: "failed", source: "https://docs.example.com/gone", source_type: "official_docs", title: "Unavailable", content: "[ERROR] upstream fetch failed", published_at: null, retrieved_at: "2026-09-21T09:50:00.000Z", semantic_score: 0.2, date_confidence: "unknown", status: "failed" },
      { id: "undated", source: "https://docs.example.com/undated", source_type: "official_docs", title: "No publication date", content: "Documentation with no discoverable date.", published_at: null, retrieved_at: "2026-09-21T09:50:00.000Z", semantic_score: 0.9, date_confidence: "unknown", status: "success" },
      { id: "stale", source: "https://docs.example.com/2019", source_type: "official_docs", title: "Superseded release notes", content: "Release notes for a long-superseded version.", published_at: "2019-01-01T00:00:00.000Z", retrieved_at: "2026-09-21T09:50:00.000Z", semantic_score: 0.9, date_confidence: "high", status: "success" },
    ],
  });

  const byId = (id: string) => {
    const item = report.items.find((i) => i.id === id);
    assert.ok(item, `${id} must appear in the report`);
    return item;
  };

  // 1. Nothing degraded is ever offered as a primary citation.
  for (const id of ["failed", "undated", "stale"]) {
    assert.notEqual(byId(id).decision, "cite_as_primary", `${id} must never be cite_as_primary`);
  }

  // 2. Unknown state is blocked from handoff. This is the load-bearing one.
  assert.equal(byId("failed").decision, "exclude");
  assert.equal(byId("failed").safe_for_agent_handoff, false);
  assert.equal(byId("undated").safe_for_agent_handoff, false, "an undateable source must not be handoff-safe");

  // 3. Known-old content is demoted and disclosed rather than blocked.
  assert.equal(byId("stale").decision, "use_as_background");

  // 4. The weaknesses stay visible in the summary rather than being averaged away.
  assert.equal(report.summary.freshness_unknown, 2);
  assert.equal(report.summary.provenance_incomplete, 2);
  assert.equal(report.summary.handoff_blocked, 2);
});

test("build-to-spec warns on unfalsifiable wording but not on FreshContext's own verdicts", () => {
  const base = JSON.parse(readFileSync("service-kits/examples/build-spec.example.json", "utf8"));

  const vague = JSON.parse(JSON.stringify(base));
  vague.milestones[0].acceptance_tests[0].expected_observable_result = "It works well and is enterprise ready.";
  const flagged = runWithFixture("service-kits/build-spec.ts", vague);
  assert.equal(flagged.result.status, 0, flagged.result.stderr);
  const flaggedBody = JSON.parse(readFileSync(path.join(flagged.output, "build-spec.json"), "utf8"));
  assert.equal(flaggedBody.validation_warnings.length, 1, "unfalsifiable wording must warn");
  assert.match(flaggedBody.validation_warnings[0], /subjective acceptance wording/);

  // A binary criterion phrased in the product's own vocabulary. The previous
  // pattern flagged this, which told a buyer their correct acceptance test was
  // subjective.
  const sound = JSON.parse(JSON.stringify(base));
  sound.milestones[0].acceptance_tests[0].expected_observable_result =
    "The stale fixture is reported as not safe for agent handoff.";
  const clean = runWithFixture("service-kits/build-spec.ts", sound);
  assert.equal(clean.result.status, 0, clean.result.stderr);
  const cleanBody = JSON.parse(readFileSync(path.join(clean.output, "build-spec.json"), "utf8"));
  assert.deepEqual(cleanBody.validation_warnings, [], "product vocabulary must not be called subjective");
});

test("service-kit evidence output cannot be committed to this repository", () => {
  // The runners write client fixtures, source URLs and document content into
  // service-output/. One `git add -A` mid-engagement would put a client's
  // material into git history permanently. SOP-009 forbids it; this asserts the
  // repository mechanically enforces it.
  const probe = "service-output/__gitignore_probe__/client-evidence.json";
  const checked = spawnSync("git", ["check-ignore", "-q", probe], { encoding: "utf8" });
  assert.equal(checked.status, 0, "service-output/ must be gitignored");
});

test("assessment evidence is reproducible from the same fixture", () => {
  // Reproducibility is sold, not merely hoped for: an engagement records the
  // commit and the fixture, and a client must be able to get the same evidence
  // back. `now` is supplied by the input for exactly this reason. Nothing
  // asserted it until here, so a future non-deterministic ordering or a stray
  // Date.now() inside the evaluation path would have silently broken the claim.
  const first = runScript("service-kits/assessment.ts", "service-kits/examples/assessment.example.json");
  const second = runScript("service-kits/assessment.ts", "service-kits/examples/assessment.example.json");
  assert.equal(first.result.status, 0, first.result.stderr);
  assert.equal(second.result.status, 0, second.result.stderr);

  const load = (dir: string) => {
    const body = JSON.parse(readFileSync(path.join(dir, "assessment-evidence.json"), "utf8"));
    // generated_at is wall-clock by design — it records when the run happened,
    // not what it concluded. Everything else must match byte for byte.
    delete body.generated_at;
    return body;
  };
  assert.deepEqual(load(first.output), load(second.output), "two runs over one fixture must agree");

  const md = (dir: string) =>
    readFileSync(path.join(dir, "assessment-evidence.md"), "utf8").replace(/^\*\*Generated:.*$/m, "");
  assert.equal(md(first.output), md(second.output), "the human-readable evidence must agree too");
});

test("one workflow's configuration cannot reach another's evaluation", () => {
  // The multi-workflow service is sold as several INDEPENDENTLY configured
  // workflows, not as one blended evaluation. That isolation was a property of
  // how the runner happened to be written rather than something asserted, so a
  // later refactor that hoisted shared state would have produced quietly
  // cross-contaminated client evidence.
  //
  // Two workflows over an identical signal, with profiles and intents chosen to
  // disagree. Each is then compared against the same workflow evaluated alone.
  const signal = {
    id: "shared",
    source: "https://arxiv.org/abs/2609.00042",
    source_type: "arxiv",
    title: "A paper both workflows see",
    content: "Identical content presented to two differently configured workflows.",
    published_at: "2026-06-01T00:00:00.000Z",
    retrieved_at: "2026-09-21T09:50:00.000Z",
    semantic_score: 0.88,
    date_confidence: "high",
    status: "success",
  };
  const alpha = { workflow_id: "alpha", profile: "academic_research", intent: "citation_check", now: "2026-09-21T10:00:00.000Z", signals: [signal] };
  const beta = { workflow_id: "beta", profile: "official_docs", intent: "developer_adoption", now: "2026-09-21T10:00:00.000Z", signals: [signal] };

  const aloneAlpha = evaluateWorkflow(JSON.parse(JSON.stringify(alpha)));
  const aloneBeta = evaluateWorkflow(JSON.parse(JSON.stringify(beta)));

  const { output, result } = runWithFixture("service-kits/multi-workflow.ts", {
    engagement_name: "isolation-check",
    workflows: [JSON.parse(JSON.stringify(alpha)), JSON.parse(JSON.stringify(beta))],
  });
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(readFileSync(path.join(output, "multi-workflow-evidence.json"), "utf8"));
  assert.equal(body.summary.workflows, 2);

  const together = (id: string) => {
    const w = body.workflows.find((x: { workflow_id: string }) => x.workflow_id === id);
    assert.ok(w, `${id} must appear in the aggregate`);
    return w;
  };

  // Each workflow keeps its own configuration through the aggregate run.
  assert.equal(together("alpha").profile, "academic_research");
  assert.equal(together("alpha").intent, "citation_check");
  assert.equal(together("beta").profile, "official_docs");
  assert.equal(together("beta").intent, "developer_adoption");

  // And reaches the same verdict it reaches alone.
  assert.deepEqual(together("alpha").items, aloneAlpha.items, "alpha must be unaffected by beta");
  assert.deepEqual(together("beta").items, aloneBeta.items, "beta must be unaffected by alpha");
  assert.deepEqual(together("alpha").summary, aloneAlpha.summary);
  assert.deepEqual(together("beta").summary, aloneBeta.summary);
});

test("evidence discloses what safe_for_agent_handoff does and does not mean", () => {
  // A client skim-reading handoff_safe: true beside a years-old document will
  // hear "current". The evidence has to say otherwise in the deliverable
  // itself, not only in a conversation the client may not remember.
  const { output, result } = runScript("service-kits/assessment.ts", "service-kits/examples/assessment.example.json");
  assert.equal(result.status, 0, result.stderr);

  const body = JSON.parse(readFileSync(path.join(output, "assessment-evidence.json"), "utf8"));
  assert.ok(body.field_meanings?.safe_for_agent_handoff, "machine-readable evidence must define the field");
  assert.match(body.field_meanings.safe_for_agent_handoff, /NOT a claim that the content is current/);

  const md = readFileSync(path.join(output, "assessment-evidence.md"), "utf8");
  assert.match(md, /## How to read these fields/);
  assert.match(md, /does not mean the content is current/);
  assert.match(md, /\*unknown\*, not \*old\*/);

  const multi = runScript("service-kits/multi-workflow.ts", "service-kits/examples/multi-workflow.example.json");
  assert.equal(multi.result.status, 0, multi.result.stderr);
  const multiBody = JSON.parse(readFileSync(path.join(multi.output, "multi-workflow-evidence.json"), "utf8"));
  assert.ok(multiBody.field_meanings?.safe_for_agent_handoff, "multi-workflow evidence must define it too");
});

// ---------------------------------------------------------------------------
// The acceptance starter suite, and the guard that makes it safe to adapt.
//
// A starter is the artefact a client edits. Before this, an edit that mistyped
// an `expected` key produced a scenario with zero checks, and
// `checks.every(...)` over an empty array returned true — PASS, having verified
// nothing. Shipping a template to be edited while that path was open would have
// multiplied the exposure, so the guard lands with the template rather than
// after it.
// ---------------------------------------------------------------------------

const STARTER = "service-kits/templates/acceptance.single-workflow.v1.json";
const BASELINE_FAMILIES = ["SW-01", "SW-02", "SW-03", "SW-04", "SW-05"];

function starterSuite(): Record<string, any> {
  return JSON.parse(readFileSync(STARTER, "utf8"));
}

test("the starter suite ships all five baseline families", () => {
  const suite = starterSuite();
  assert.deepEqual(
    suite.scenarios.map((s: { id: string }) => s.id),
    BASELINE_FAMILIES,
    "SOP-006 names five families; the starter must carry all of them",
  );
  // `now` pinned, or the relative-freshness families drift daily and the
  // template rots into a fixture that once passed.
  assert.equal(typeof suite.now, "string");
  assert.match(suite.now, /^\d{4}-\d{2}-\d{2}T/);
  for (const scenario of suite.scenarios) {
    assert.ok(scenario.note, `${scenario.id} must carry a note for whoever adapts it`);
  }
});

test("the starter suite passes 5/5 exactly as shipped", () => {
  // It is a working starting point, not a decorative example — and doubles as a
  // regression fixture. If engine behaviour changes, this fails, which is the
  // correct signal that the starter needs revisiting before it goes to a client.
  const { output, result } = runScript("service-kits/acceptance.ts", STARTER);
  assert.equal(result.status, 0, result.stderr + "\n" + result.stdout);

  const body = JSON.parse(readFileSync(path.join(output, "acceptance-evidence.json"), "utf8"));
  assert.equal(body.pass, true);
  assert.equal(body.passed, 5);
  assert.equal(body.total, 5);
  for (const scenario of body.scenarios) {
    assert.ok(scenario.checks.length > 0, `${scenario.id} must make at least one real comparison`);
  }
});

test("a mistyped expected key is rejected by name", () => {
  // The silent-PASS defect. `decision` for `decisions` used to survive the
  // non-empty check, match no comparison, and pass.
  const suite = starterSuite();
  const scenario = suite.scenarios.find((s: { id: string }) => s.id === "SW-01");
  delete scenario.expected.decisions;
  scenario.expected.decision = ["use_first"];

  const { result } = runWithFixture("service-kits/acceptance.ts", suite);
  assert.notEqual(result.status, 0, "an unrecognised expected key must not pass");
  assert.match(result.stderr, /SW-01/);
  assert.match(result.stderr, /unrecognised expected check: decision\b/);
});

test("a wrong-typed expected value is rejected rather than skipped", () => {
  // `min_freshness: "80"` used to be dropped by a typeof guard, silently
  // removing a check the author believed they had written.
  const suite = starterSuite();
  suite.scenarios.find((s: { id: string }) => s.id === "SW-01").expected.min_freshness = "80";

  const { result } = runWithFixture("service-kits/acceptance.ts", suite);
  assert.notEqual(result.status, 0, "a wrong-typed expected value must not pass");
  assert.match(result.stderr, /expected\.min_freshness must be a finite number/);
});

test("the failed-source family is excluded and never handoff-safe", () => {
  // The contractual floor: a failed fetch is never usable context, whatever its
  // content looks like.
  const { output, result } = runScript("service-kits/acceptance.ts", STARTER);
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(readFileSync(path.join(output, "acceptance-evidence.json"), "utf8"));
  const failed = body.scenarios.find((s: { id: string }) => s.id === "SW-05");
  assert.ok(failed);
  assert.equal(failed.actual.decision, "exclude");
  assert.equal(failed.actual.safe_for_agent_handoff, false);

  // And nothing degraded is ever offered as the profile's primary citation.
  for (const id of ["SW-03", "SW-04", "SW-05"]) {
    const s = body.scenarios.find((x: { id: string }) => x.id === id);
    assert.notEqual(s.actual.decision, "use_first", `${id} must never be the primary decision`);
  }
});

test("the starter suite contains no client data", () => {
  // It ships in a public repository and is copied into engagements. Every host
  // must be a reserved example domain.
  const suite = starterSuite();
  for (const scenario of suite.scenarios) {
    const source = String(scenario.signal.source);
    assert.match(source, /^https:\/\/[a-z0-9.-]*example\.(com|org|net)\//, `${scenario.id} source must be synthetic: ${source}`);
  }
  assert.doesNotMatch(readFileSync(STARTER, "utf8"), /freshcontext\.dev|@gmail|api-key|secret/i);
});

test("the starter can be adapted, and a wrong expectation then fails loudly", () => {
  // What a client actually does with it: copy, change one expectation to match
  // their own policy, re-run. A wrong one must fail rather than quietly pass.
  const suite = starterSuite();
  suite.scenarios.find((s: { id: string }) => s.id === "SW-02").expected.safe_for_agent_handoff = false;

  const { output, result } = runWithFixture("service-kits/acceptance.ts", suite);
  assert.notEqual(result.status, 0, "a failed adapted scenario must exit non-zero");

  const body = JSON.parse(readFileSync(path.join(output, "acceptance-evidence.json"), "utf8"));
  assert.equal(body.pass, false);
  assert.equal(body.passed, 4);
  assert.equal(body.total, 5);
  assert.equal(body.scenarios.find((s: { id: string }) => s.id === "SW-02").pass, false);
});

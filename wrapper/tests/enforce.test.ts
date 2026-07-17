import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  enforce,
  DEFAULT_POLICY,
  CONTEXT_DECISIONS,
} from "../src/enforce.ts";
import type { ContextDecision, EnforceableItem } from "../src/enforce.ts";

function item(decision: ContextDecision, extra: Partial<EnforceableItem> & Record<string, unknown> = {}) {
  return { decision, ...extra };
}

describe("enforce — default policy", () => {
  test("drops the four not-handoff-safe decisions, admits the strong three, demotes background", () => {
    const items = [
      item("exclude"),
      item("use_first"),
      item("needs_verification"),
      item("cite_as_primary"),
      item("watch_only"),
      item("use_as_background"),
      item("needs_refresh"),
      item("cite_as_supporting"),
    ];
    const r = enforce(items);
    assert.deepEqual(r.admitted.map((i) => i.decision), ["use_first", "cite_as_primary", "cite_as_supporting"]);
    assert.deepEqual(r.demoted.map((i) => i.decision), ["use_as_background"]);
    assert.deepEqual(r.dropped.map((d) => d.item.decision).sort(), ["exclude", "needs_refresh", "needs_verification", "watch_only"]);
    assert.deepEqual(r.summary, { total: 8, admitted: 3, demoted: 1, dropped: 4 });
  });

  test("admitted is ordered strongest-first regardless of input order", () => {
    const r = enforce([item("cite_as_supporting"), item("use_first"), item("cite_as_primary")]);
    assert.deepEqual(r.admitted.map((i) => i.decision), ["use_first", "cite_as_primary", "cite_as_supporting"]);
  });

  test("every dropped item carries a non-empty reason (no silent drops)", () => {
    const r = enforce([item("exclude"), item("watch_only")]);
    assert.equal(r.dropped.length, 2);
    for (const d of r.dropped) assert.ok(d.reason.length > 0, "dropped item must explain why");
  });

  test("preserves all caller fields on the returned items — never mutates or strips", () => {
    const r = enforce([item("use_first", { id: "s1", content: "hello", custom: 42 })]);
    assert.equal(r.admitted[0].id, "s1");
    assert.equal(r.admitted[0].content, "hello");
    assert.equal((r.admitted[0] as Record<string, unknown>).custom, 42);
  });

  test("empty input -> empty buckets", () => {
    const r = enforce([]);
    assert.deepEqual(r.summary, { total: 0, admitted: 0, demoted: 0, dropped: 0 });
  });
});

describe("enforce — the safe_for_agent_handoff flag is authoritative when supplied", () => {
  test("flag=false drops even a normally-admitted decision (Core folded provenance in)", () => {
    const r = enforce([item("use_first", { safe_for_agent_handoff: false })]);
    assert.equal(r.admitted.length, 0);
    assert.equal(r.dropped.length, 1);
    assert.match(r.dropped[0].reason, /not safe for agent handoff/);
  });

  test("flag=true admits (or demotes) even without a provenance_complete field", () => {
    const admit = enforce([item("cite_as_primary", { safe_for_agent_handoff: true })]);
    assert.equal(admit.admitted.length, 1);
    const demote = enforce([item("use_as_background", { safe_for_agent_handoff: true })]);
    assert.equal(demote.demoted.length, 1);
  });
});

describe("enforce — derived safety (no flag): provenance rule mirrors Core", () => {
  test("admit-able decision but provenance not complete -> dropped by default", () => {
    const r = enforce([item("use_first", { provenance_complete: false })]);
    assert.equal(r.dropped.length, 1);
    assert.match(r.dropped[0].reason, /provenance not complete/);
  });

  test("admit-able decision with complete provenance -> admitted", () => {
    const r = enforce([item("use_first", { provenance_complete: true })]);
    assert.equal(r.admitted.length, 1);
  });

  test("requireProvenanceComplete:false admits on decision alone", () => {
    const r = enforce([item("use_first", { provenance_complete: false })], { requireProvenanceComplete: false });
    assert.equal(r.admitted.length, 1);
  });
});

describe("enforce — custom policy", () => {
  test("a stricter policy drops a handoff-safe decision it does not admit or demote", () => {
    const r = enforce(
      [
        item("use_first", { safe_for_agent_handoff: true }),
        item("cite_as_supporting", { safe_for_agent_handoff: true }),
      ],
      { admit: new Set(["use_first"]), demote: new Set() }
    );
    // use_first is admitted; cite_as_supporting is handoff-safe but the policy admits only
    // use_first and demotes nothing, so it is dropped — "excluded by policy", not a safety no.
    assert.deepEqual(r.admitted.map((i) => i.decision), ["use_first"]);
    assert.equal(r.dropped.length, 1);
    assert.equal(r.dropped[0].item.decision, "cite_as_supporting");
    assert.match(r.dropped[0].reason, /excluded by policy/);
  });

  test("a false handoff flag is an authoritative veto even under a permissive policy", () => {
    const r = enforce(
      [item("use_first", { safe_for_agent_handoff: false })],
      { admit: new Set(CONTEXT_DECISIONS), demote: new Set(), requireProvenanceComplete: false }
    );
    assert.equal(r.admitted.length, 0);
    assert.equal(r.dropped.length, 1);
    assert.match(r.dropped[0].reason, /not safe for agent handoff/);
  });
});

test("CONTEXT_DECISIONS has exactly the eight labels, no duplicates", () => {
  assert.equal(CONTEXT_DECISIONS.length, 8);
  assert.equal(new Set(CONTEXT_DECISIONS).size, 8);
});

test("DEFAULT_POLICY admit + demote sets are disjoint and both handoff-safe", () => {
  for (const d of DEFAULT_POLICY.admit) assert.ok(!DEFAULT_POLICY.demote.has(d));
});

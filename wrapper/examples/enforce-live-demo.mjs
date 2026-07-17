// Live end-to-end proof for the FreshContext enforcement wrapper (Pass 24).
//
// This is the "enforcement is real and in-path, not advisory" artifact. It:
//   1. calls the LIVE deployed evaluate_context tool (production Worker /mcp) over a
//      deliberately mixed set of candidate signals,
//   2. feeds the tool's real [FRESHCONTEXT_EVALUATION_JSON] results[] straight into the
//      wrapper's enforceEvaluateContext(),
//   3. prints what was admitted (strongest-first), demoted, and dropped — with a reason
//      for every drop.
//
// evaluate_context is a pure judgment call (it never fetches), so with a fixed `now` the
// result is deterministic and reproducible. Requires the wrapper to be built first:
//   cd wrapper && npm run build && node examples/enforce-live-demo.mjs
//
// No secret or auth is needed: /mcp tools/list and tools/call are public read paths.

import { enforceEvaluateContext } from "../dist/index.js";

const ENDPOINT = "https://freshcontext-mcp.gimmanuel73.workers.dev/mcp";

// A mix that exercises all three dispositions: one fresh+strong (admit), one older but
// usable (demote), one stale (drop), one failed upstream fetch (authoritative veto → drop).
const REQUEST = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: {
    name: "evaluate_context",
    arguments: {
      profile: "academic_research",
      intent: "citation_check",
      now: "2026-07-17T18:00:00Z",
      signals: [
        { id: "fresh-strong", source: "https://arxiv.org/abs/2507.01234", source_type: "arxiv", title: "Recent transformer scaling result", content: "A 2026 result on scaling laws with fresh experimental data.", published_at: "2026-07-10", semantic_score: 0.95, date_confidence: "high", status: "success" },
        { id: "supporting-midage", source: "https://arxiv.org/abs/2603.09999", source_type: "arxiv", title: "Earlier related method", content: "A related method from a few months back, still relevant.", published_at: "2026-04-05", semantic_score: 0.72, date_confidence: "high", status: "success" },
        { id: "stale-old", source: "https://arxiv.org/abs/2201.00001", source_type: "arxiv", title: "Old preprint", content: "An older preprint whose numbers are likely superseded.", published_at: "2022-01-15", semantic_score: 0.6, date_confidence: "high", status: "stale" },
        { id: "failed-fetch", source: "https://arxiv.org/abs/2507.09999", source_type: "arxiv", title: "Unavailable", content: "[ERROR] upstream fetch failed", published_at: null, date_confidence: "unknown", status: "failed" },
      ],
    },
  },
};

// The MCP HTTP transport replies as Server-Sent Events; pull the single `data:` JSON line.
function parseSse(body) {
  const line = body.split("\n").find((l) => l.startsWith("data:"));
  if (!line) throw new Error("no SSE data line in response");
  return JSON.parse(line.slice(5));
}

function extractResults(rpc) {
  const text = (rpc.result?.content ?? []).map((c) => c.text).join("\n");
  const m = text.match(/\[FRESHCONTEXT_EVALUATION_JSON\]\s*([\s\S]*?)\s*\[\/FRESHCONTEXT_EVALUATION_JSON\]/);
  if (!m) throw new Error("no [FRESHCONTEXT_EVALUATION_JSON] block in tool output");
  return JSON.parse(m[1]).results;
}

const label = (r) => r.title || r.source;
const fresh = (r) => (typeof r.freshness_score === "number" ? r.freshness_score.toFixed(3) : "n/a");

async function main() {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify(REQUEST),
  });
  const results = extractResults(parseSse(await res.text()));

  console.log(`Live evaluate_context returned ${results.length} evaluated signals (${ENDPOINT}).\n`);
  for (const r of results) {
    const h = r.readable?.handoff?.safe_for_agent_handoff;
    console.log(`  ${label(r)}  -> decision=${r.decision}  handoff=${h}  freshness=${fresh(r)}`);
  }

  const out = enforceEvaluateContext(results);

  console.log(`\nENFORCED (default policy = Core's safe_for_agent_handoff line):`);
  console.log(`  summary: ${JSON.stringify(out.summary)}\n`);

  console.log(`  ADMITTED (strongest-first — the only context that reaches the model):`);
  out.admitted.forEach((r, i) => console.log(`    ${i + 1}. ${label(r)}  [${r.decision}]  freshness=${fresh(r)}`));

  console.log(`\n  DEMOTED (handoff-safe but weak — append after admitted, or ignore):`);
  out.demoted.forEach((r) => console.log(`    - ${label(r)}  [${r.decision}]`));

  console.log(`\n  DROPPED (never reaches the model — each with a reason, no silent drops):`);
  out.dropped.forEach((d) => console.log(`    - ${label(d.item)}  [${d.item.decision}]  reason: ${d.reason}`));
}

main().catch((e) => {
  console.error("demo failed:", e.message);
  process.exit(1);
});

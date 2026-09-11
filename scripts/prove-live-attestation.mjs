#!/usr/bin/env node
// Prove, against the LIVE Worker, that a FreshContext verdict is independently verifiable.
//
//   node scripts/prove-live-attestation.mjs --base https://freshcontext-mcp.example.workers.dev
//
// This is E-2's acceptance test executed rather than described. It does the part a third
// party cannot be asked to do by hand — obtain a real production verdict and lay out its
// bytes — and then deliberately STOPS. It performs no cryptography of its own. The actual
// check is left to scripts/verify-offline.mjs and scripts/verify_offline.py, the two
// artifacts a sceptic would run, because a proof that verified using its own private copy
// of the algorithm would only prove the algorithm agrees with itself.
//
// What it writes to --out:
//
//   keys.json        the published key document, exactly as served
//   verdict.payload  the exact signed bytes, JSON-decoded out of the V4 block
//   verdict.sig      the base64url signature
//   verdict.json     verdict_id / result_id / key_id, for the Mode 2 ledger round-trip
//
// Exit 0 = every invariant held. Exit 1 = something is wrong and the message says what.
// Exit 2 = the Worker has no active signing key yet, so there is nothing to verify. That
// is a distinct code on purpose: "not configured" is not "broken", and conflating the two
// is how a pipeline learns to ignore its own red.
//
// evaluate_context never fetches, crawls or browses — it evaluates caller-supplied
// signals — so this costs one cheap request and, with a fixed `now`, is deterministic.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const V4_OPEN = "[FRESHCONTEXT_SIG_V4]";
const V4_CLOSE = "[/FRESHCONTEXT_SIG_V4]";
const V3_OPEN = "[FRESHCONTEXT_SIG_V3]";
const V3_CLOSE = "[/FRESHCONTEXT_SIG_V3]";
const V4_HEADER = "FRESHCONTEXT_HA_PRI_V4";
const V3_HEADER = "FRESHCONTEXT_HA_PRI_V3";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};

const fail = (message) => {
  console.error(`FAIL  ${message}`);
  process.exit(1);
};
const pass = (message) => console.log(`ok    ${message}`);
const note = (message) => console.log(`      ${message}`);

const base = (arg("base") ?? process.env.WORKER_BASE_URL ?? "").replace(/\/+$/, "");
if (!base) fail("--base (or WORKER_BASE_URL) is required, e.g. https://host.workers.dev");
const outDir = arg("out", ".attestation-proof");
mkdirSync(outDir, { recursive: true });

// A fixed `now` makes the evaluation deterministic, so a failure here is always about
// signing and never about the clock moving between runs. The signals are the same mixed
// set the wrapper's live demo uses: one fresh, one mid-age, one stale.
const NOW = "2026-07-17T18:00:00Z";
const REQUEST = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: {
    name: "evaluate_context",
    arguments: {
      profile: "academic_research",
      intent: "citation_check",
      now: NOW,
      signals: [
        {
          id: "attestation-proof-fresh",
          source: "https://arxiv.org/abs/2507.01234",
          source_type: "arxiv",
          title: "Recent transformer scaling result",
          content: "A 2026 result on scaling laws with fresh experimental data.",
          published_at: "2026-07-10",
          semantic_score: 0.95,
          date_confidence: "high",
          status: "success",
        },
        {
          id: "attestation-proof-midage",
          source: "https://arxiv.org/abs/2603.09999",
          source_type: "arxiv",
          title: "Earlier related method",
          content: "A related method from a few months back, still relevant.",
          published_at: "2026-04-05",
          semantic_score: 0.72,
          date_confidence: "high",
          status: "success",
        },
      ],
    },
  },
};

// The MCP Streamable HTTP transport answers as Server-Sent Events; one `data:` line
// carries the whole JSON-RPC response.
function parseSse(body) {
  const line = body.split("\n").find((l) => l.startsWith("data:"));
  if (!line) fail(`no SSE data line in the /mcp response. First 300 bytes:\n${body.slice(0, 300)}`);
  try {
    return JSON.parse(line.slice(5));
  } catch (err) {
    fail(`the /mcp SSE data line is not JSON: ${err.message}`);
  }
}

function blockBetween(text, open, close) {
  const start = text.indexOf(open);
  if (start < 0) return null;
  const end = text.indexOf(close, start);
  if (end < 0) return null;
  return text.slice(start + open.length, end).trim();
}

// `item=N result_id=… verdict_id=… sig=… payload="…"` — payload is JSON-encoded so its
// newlines survive on one line. Parsed from the RIGHT (sig=, then payload=) because the
// free-text fields before them may themselves contain "=".
function parseSigLine(line) {
  const payloadAt = line.indexOf(" payload=");
  if (payloadAt < 0) return null;
  const head = line.slice(0, payloadAt);
  const payloadRaw = line.slice(payloadAt + " payload=".length);
  const field = (name) => head.match(new RegExp(`(?:^|\\s)${name}=(\\S+)`))?.[1];
  let payload;
  try {
    payload = JSON.parse(payloadRaw);
  } catch {
    return null;
  }
  if (typeof payload !== "string") return null;
  return {
    item: field("item"),
    result_id: field("result_id"),
    verdict_id: field("verdict_id"),
    sig: field("sig"),
    payload,
  };
}

async function main() {
  // ── 1. the published key document ────────────────────────────────────────────────
  const keysUrl = `${base}/.well-known/freshcontext-signing-keys.json`;
  const keysRes = await fetch(keysUrl);
  if (!keysRes.ok) fail(`GET ${keysUrl} returned ${keysRes.status}`);
  const keysText = await keysRes.text();
  let keyDoc;
  try {
    keyDoc = JSON.parse(keysText);
  } catch (err) {
    fail(`the key document is not JSON: ${err.message}`);
  }
  writeFileSync(join(outDir, "keys.json"), keysText);

  if (keyDoc.schema !== "freshcontext.signing-keys.v1") {
    fail(`key document schema is ${JSON.stringify(keyDoc.schema)}, expected freshcontext.signing-keys.v1`);
  }
  if (keyDoc.algorithm !== "Ed25519") {
    fail(`key document algorithm is ${JSON.stringify(keyDoc.algorithm)}, expected Ed25519`);
  }
  const keys = Array.isArray(keyDoc.keys) ? keyDoc.keys : [];
  const active = keys.filter((k) => k?.status === "active");
  pass(`key document served: ${keys.length} key(s), ${active.length} active`);
  for (const k of keys) note(`${k.key_id}  ${k.status}`);

  if (active.length > 1) {
    fail(`${active.length} keys are marked active. Exactly one key signs at a time; more than one means a rotation left the outgoing key unretired.`);
  }

  // ── 2. a real verdict from the live Worker ───────────────────────────────────────
  const mcpUrl = `${base}/mcp`;
  const mcpRes = await fetch(mcpUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify(REQUEST),
  });
  if (!mcpRes.ok) {
    fail(`POST ${mcpUrl} returned ${mcpRes.status}: ${(await mcpRes.text()).slice(0, 300)}`);
  }
  const rpc = parseSse(await mcpRes.text());
  if (rpc.error) fail(`/mcp returned a JSON-RPC error: ${JSON.stringify(rpc.error)}`);
  const text = (rpc.result?.content ?? []).map((c) => c.text).join("\n");
  if (!text) fail("the tool result carried no text content");
  pass("live evaluate_context returned a verdict");

  const v3Block = blockBetween(text, V3_OPEN, V3_CLOSE);
  if (!v3Block) fail(`the verdict carries no ${V3_OPEN} block — FC_HMAC_SECRET is not configured, so nothing is signed at all`);
  const v4Block = blockBetween(text, V4_OPEN, V4_CLOSE);

  // ── 3. the invariant that holds before AND after a key is published ──────────────
  //
  // No flag day, no environment switch: the published key document decides what must be
  // true of the verdict. Either there is an active key and every verdict must carry a
  // verifiable V4 block under it, or there is not and a verdict must carry no V4 block
  // at all. The state this refuses to let pass silently is the dangerous middle — a V4
  // block signed under a key nobody can fetch, which is indistinguishable from a forgery
  // to anyone checking.
  if (active.length === 0) {
    if (v4Block) {
      fail(
        `the Worker emitted a ${V4_OPEN} block but publishes NO active key. ` +
        `Those verdicts cannot be verified by anyone — to a third party that is ` +
        `indistinguishable from a forgery. Publish the public key or stop signing.`
      );
    }
    pass("no active key published, and the verdict correctly carries no V4 block");
    note("This Worker is signing V3/HMAC only — honest, but issuer-attested, not independently verifiable.");
    note("Merge the public-key PR to close this. Re-run then; the exit code flips from 2 to 0.");
    process.exit(2);
  }

  const activeKey = active[0];
  if (!v4Block) {
    fail(
      `key ${activeKey.key_id} is published as active, but the verdict carries no ${V4_OPEN} block. ` +
      `Either the private key secret is missing on the Worker or signing threw — check the ` +
      `snapshot_write_error events in Workers observability.`
    );
  }

  // ── 4. structural checks on the block, before any crypto ─────────────────────────
  const blockLines = v4Block.split("\n").map((l) => l.trim()).filter(Boolean);
  const algoLine = blockLines.find((l) => l.startsWith("algo="));
  const keyIdLine = blockLines.find((l) => l.startsWith("key_id="));
  if (algoLine !== "algo=Ed25519") fail(`V4 block declares ${JSON.stringify(algoLine)}, expected algo=Ed25519`);
  const blockKeyId = keyIdLine?.slice("key_id=".length);
  if (blockKeyId !== activeKey.key_id) {
    fail(`V4 block is signed under key_id=${blockKeyId}, but the published active key is ${activeKey.key_id}`);
  }
  pass(`V4 block present, signed under the published active key ${activeKey.key_id}`);

  const items = blockLines.filter((l) => l.startsWith("item=")).map(parseSigLine);
  if (items.length === 0 || items.some((i) => i === null)) {
    fail("could not parse the item= lines out of the V4 block");
  }
  const v3Items = v3Block.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("item=")).map(parseSigLine);

  for (const item of items) {
    const lines = item.payload.split("\n");
    if (lines[0] !== V4_HEADER) fail(`item ${item.item}: payload does not begin ${V4_HEADER}`);
    if (!lines.includes(`key_id=${activeKey.key_id}`)) {
      fail(`item ${item.item}: key_id is not inside the signed payload — it would then be a hint, not a commitment`);
    }
    if (!lines.includes("signature_algorithm=Ed25519")) {
      fail(`item ${item.item}: payload does not declare signature_algorithm=Ed25519`);
    }
    if (!lines.includes(`verdict_id=${item.verdict_id}`)) {
      fail(`item ${item.item}: the signed payload does not bind verdict_id=${item.verdict_id}`);
    }

    // V4 must be the SAME verdict fields as V3 plus the two key lines. If V4 were signing
    // a different set of facts, both blocks could be individually valid while describing
    // different verdicts — and the Ed25519 one would be attesting to something the ledger
    // and every earlier consumer never saw.
    const v3 = v3Items.find((c) => c && c.result_id === item.result_id);
    if (!v3) fail(`item ${item.item}: no matching V3 line for result_id=${item.result_id}`);
    const expected = [
      V4_HEADER,
      ...v3.payload.split("\n").slice(1),
      `key_id=${activeKey.key_id}`,
      "signature_algorithm=Ed25519",
    ].join("\n");
    if (v3.payload.split("\n")[0] !== V3_HEADER) fail(`item ${item.item}: V3 payload does not begin ${V3_HEADER}`);
    if (item.payload !== expected) {
      fail(`item ${item.item}: the V4 payload is not the V3 payload plus key_id and signature_algorithm. Ed25519 is attesting to different facts than HMAC did.`);
    }
  }
  pass(`${items.length} signed item(s); each binds its verdict_id and matches the V3 payload it extends`);

  // ── 5. lay the bytes out for the shipped verifiers ───────────────────────────────
  const subject = items[0];
  writeFileSync(join(outDir, "verdict.payload"), subject.payload, "utf8");
  writeFileSync(join(outDir, "verdict.sig"), subject.sig, "utf8");
  writeFileSync(
    join(outDir, "verdict.json"),
    JSON.stringify(
      {
        base,
        key_id: activeKey.key_id,
        verdict_id: subject.verdict_id,
        result_id: subject.result_id,
        evaluated_with_now: NOW,
        items: items.length,
      },
      null,
      2
    ) + "\n"
  );
  pass(`wrote ${outDir}/verdict.payload, verdict.sig, keys.json, verdict.json`);
  note(`verdict_id=${subject.verdict_id}`);
  note("No cryptography was performed here on purpose — run the two shipped verifiers next.");
}

main().catch((err) => fail(err?.stack ?? String(err)));

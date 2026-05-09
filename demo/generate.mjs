/**
 * generate.mjs — regenerate the demo's two answers from a real Claude call,
 * then write them back into data.json so the HTML picks them up automatically.
 *
 * The demo works WITHOUT this script. The baked_answers in data.json are
 * displayed by default — no API key required to view the page. This script
 * exists so anyone who wants to verify the math actually changes Claude's
 * answer can plug in their own key and prove it.
 *
 * Run:
 *   PowerShell:  $env:ANTHROPIC_API_KEY="sk-ant-..."; node generate.mjs
 *   bash/zsh:    ANTHROPIC_API_KEY=sk-ant-... node generate.mjs
 *
 * Optional env:
 *   MODEL          — model string, defaults to claude-sonnet-4-5-20250929
 *   DRY_RUN=1      — print the prompts and exit, don't call the API
 *   NO_SAVE=1      — call the API and print, but don't write data.json
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, 'data.json');

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL ?? 'claude-sonnet-4-5-20250929';
const DRY_RUN = process.env.DRY_RUN === '1';
const NO_SAVE = process.env.NO_SAVE === '1';

if (!API_KEY && !DRY_RUN) {
  console.error('ERROR: Set ANTHROPIC_API_KEY env var, or run with DRY_RUN=1 to print prompts only.\n');
  console.error('  PowerShell:  $env:ANTHROPIC_API_KEY="sk-ant-..."');
  console.error('  bash/zsh:    export ANTHROPIC_API_KEY=sk-ant-...');
  process.exit(1);
}

// ─── Load data and compute R_t ──────────────────────────────────────────────

const raw = await fs.readFile(DATA_PATH, 'utf8');
const data = JSON.parse(raw);
const now = new Date(data.now).getTime();
const lambda = data.decay.lambda_per_hour;

const docs = data.documents.map(d => {
  const published = new Date(d.published_at).getTime();
  const age_hours = (now - published) / (1000 * 60 * 60);
  const r_t = d.base_score * Math.exp(-lambda * age_hours);
  return { ...d, age_hours, r_t };
});

const baselineTop3 = [...docs].sort((a, b) => b.base_score - a.base_score).slice(0, 3);
const freshTop3    = [...docs].sort((a, b) => b.r_t - a.r_t).slice(0, 3);

// ─── Build prompts ──────────────────────────────────────────────────────────

function buildPrompt(label, contextDocs) {
  const formatted = contextDocs.map((d, i) =>
    `[Document ${i + 1}]\nSource: ${d.source}\nPublished: ${d.published_at.slice(0, 10)}\nTitle: ${d.title}\nContent: ${d.content}`
  ).join('\n\n');
  return `You are answering a developer's technical question using the retrieved documents below. Be concrete and cite specific recommendations from the context. Format your answer as:

1. A one-line lede starting with "For RAG pipelines..." or "In 2026..." that names the recommended approach in bold-able terms.
2. A short bullet list (3-5 bullets) of specific recommendations with code spans where relevant.
3. A one-line closing note.

Keep total length under 120 words. Output plain text — the demo's renderer will format the bullets.

QUERY: ${data.query}

RETRIEVED CONTEXT (top 3 by ${label}):

${formatted}

Answer the query using these documents.`;
}

// ─── Call the API ───────────────────────────────────────────────────────────

async function ask(prompt) {
  if (DRY_RUN) {
    console.log('--- DRY RUN: would have sent the following prompt ---');
    console.log(prompt);
    console.log('--- end prompt ---');
    return '[DRY_RUN: no API call made]';
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`Anthropic API error (${res.status}):`, err);
    process.exit(1);
  }
  const json = await res.json();
  return json.content[0].text;
}

// ─── Convert raw model output → structured answer object ───────────────────
// The model is asked for a lede + bullets + closing. Parse what came back into
// the shape data.json's baked_answers expects. If parsing fails on a real run,
// the script falls back to dumping the raw text into the `intro` field so the
// page still renders something readable.

function parseAnswer(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const bullets = [];
  const otherLines = [];
  for (const line of lines) {
    const m = line.match(/^[-*•]\s+(.+)$/) || line.match(/^\d+\.\s+(.+)$/);
    if (m) bullets.push(m[1].trim());
    else otherLines.push(line);
  }
  const intro = otherLines[0] ?? text;
  const outro = otherLines.length > 1 ? otherLines[otherLines.length - 1] : '';
  if (bullets.length === 0) {
    return { intro: text, bullets: [], outro: '' };
  }
  return { intro, bullets, outro };
}

// ─── Run both, print side-by-side ──────────────────────────────────────────

console.log(`Model: ${MODEL}`);
console.log(`Query: "${data.query}"`);
console.log(`Now:   ${data.now}`);
if (DRY_RUN) console.log('Mode:  DRY_RUN — no API calls');
if (NO_SAVE) console.log('Mode:  NO_SAVE — won\'t write data.json');
console.log();

console.log('━'.repeat(72));
console.log('  WITHOUT FreshContext  —  top 3 by semantic similarity (R₀)');
console.log('━'.repeat(72));
baselineTop3.forEach((d, i) =>
  console.log(`  ${i + 1}. ${d.source.padEnd(28)}  ${d.published_at.slice(0,10)}  R₀=${d.base_score}`)
);
console.log();
const baselineRaw = await ask(buildPrompt('semantic similarity (R₀)', baselineTop3));
console.log(baselineRaw);

console.log('\n' + '━'.repeat(72));
console.log('  WITH FreshContext  —  top 3 by decay-adjusted relevancy (Rₜ)');
console.log('━'.repeat(72));
freshTop3.forEach((d, i) =>
  console.log(`  ${i + 1}. ${d.source.padEnd(28)}  ${d.published_at.slice(0,10)}  Rₜ=${d.r_t.toFixed(1)}`)
);
console.log();
const freshRaw = await ask(buildPrompt('decay-adjusted relevancy (Rₜ)', freshTop3));
console.log(freshRaw);

console.log('\n' + '━'.repeat(72));
console.log('  Same model. Same retrieval set. Same query.');
console.log('  Only the temporal layer changed.');
console.log('━'.repeat(72));

// ─── Persist to data.json (unless suppressed) ──────────────────────────────

if (DRY_RUN || NO_SAVE) {
  console.log('\n(skipped writing data.json)');
  process.exit(0);
}

const baselineParsed = parseAnswer(baselineRaw);
const freshParsed = parseAnswer(freshRaw);

data.baked_answers.stale = {
  context_label: baselineTop3.map(d => `${d.published_at.slice(0,4)} ${d.source.split('.')[0]}`).join(' · '),
  intro: baselineParsed.intro,
  bullets: baselineParsed.bullets,
  outro: baselineParsed.outro,
  verdict_class: 'bad',
  verdict_text: data.baked_answers.stale.verdict_text, // preserve human-curated verdict
};
data.baked_answers.fresh = {
  context_label: freshTop3.map(d => `${d.published_at.slice(0,4)} ${d.source.split('.')[0]}`).join(' · '),
  intro: freshParsed.intro,
  bullets: freshParsed.bullets,
  outro: freshParsed.outro,
  verdict_class: 'good',
  verdict_text: data.baked_answers.fresh.verdict_text, // preserve human-curated verdict
};
data.baked_answers._last_regenerated = new Date().toISOString();
data.baked_answers._last_model = MODEL;
data.baked_answers._note = `Live-regenerated answers from ${MODEL}. Same model, same retrieval set, same query — only the temporal layer changed. Re-run \`node generate.mjs\` any time to refresh.`;

await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(`\n✓ Wrote ${DATA_PATH}`);
console.log('  Open index.html — the answers in the page now reflect this run.');

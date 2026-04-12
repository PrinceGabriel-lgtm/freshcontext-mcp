#!/usr/bin/env node

/**
 * freshcontext-validate
 * CLI validator for FreshContext-compatible responses
 * Spec: https://github.com/PrinceGabriel-lgtm/freshcontext-mcp/blob/main/FRESHCONTEXT_SPEC.md
 *
 * Usage:
 *   node freshcontext-validate.js '<json_string>'
 *   node freshcontext-validate.js --stdin
 *   node freshcontext-validate.js --file <path>
 *   node freshcontext-validate.js --help
 *
 * Compliance levels:
 *   FreshContext-scored ★★★   — JSON form + numeric freshness_score
 *   FreshContext-compatible ★★ — JSON/envelope with retrieved_at + confidence
 *   FreshContext-aware ★       — retrieved_at only, no confidence
 *   FAIL                       — missing required fields
 */

const REQUIRED_JSON_FIELDS = ['source_url', 'retrieved_at', 'freshness_confidence', 'adapter'];
const VALID_CONFIDENCE = ['high', 'medium', 'low'];
const ENVELOPE_START = '[FRESHCONTEXT]';
const ENVELOPE_END = '[/FRESHCONTEXT]';
const REQUIRED_ENVELOPE_FIELDS = ['Source:', 'Published:', 'Retrieved:', 'Confidence:'];

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const y = s => `\x1b[33m${s}\x1b[0m`;
const b = s => `\x1b[34m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const bold = s => `\x1b[1m${s}\x1b[0m`;

const pass = msg => ({ ok: true, warn: false, msg: `  ${g('✓')} ${msg}` });
const fail = msg => ({ ok: false, warn: false, msg: `  ${r('✕')} ${msg}` });
const warn = msg => ({ ok: true, warn: true, msg: `  ${y('!')} ${msg}` });

function validateJSON(obj) {
  const results = [];
  const fc = obj.freshcontext;
  if (!fc) return [fail('No "freshcontext" key found in JSON response')];

  for (const field of REQUIRED_JSON_FIELDS) {
    if (fc[field] === undefined || fc[field] === null) {
      results.push(fail(`Missing required field: freshcontext.${field}`));
    } else {
      results.push(pass(`freshcontext.${field} = ${d(String(fc[field]).slice(0, 80))}`));
    }
  }

  if (fc.retrieved_at) {
    const dt = new Date(fc.retrieved_at);
    if (isNaN(dt.getTime())) {
      results.push(fail(`retrieved_at is not valid ISO 8601: "${fc.retrieved_at}"`));
    } else {
      results.push(pass(`retrieved_at is valid ISO 8601`));
    }
  }

  if (fc.freshness_confidence && !VALID_CONFIDENCE.includes(fc.freshness_confidence)) {
    results.push(fail(`freshness_confidence must be high, medium, or low. Got: "${fc.freshness_confidence}"`));
  }

  if (fc.freshness_score !== undefined && fc.freshness_score !== null) {
    if (typeof fc.freshness_score !== 'number' || fc.freshness_score < 0 || fc.freshness_score > 100) {
      results.push(fail(`freshness_score must be 0-100. Got: ${fc.freshness_score}`));
    } else {
      const col = fc.freshness_score >= 70 ? g : fc.freshness_score >= 50 ? y : r;
      results.push(pass(`freshness_score: ${col(fc.freshness_score + '/100')}`));
    }
  } else {
    results.push(warn('freshness_score not present (optional — required for ★★★ level)'));
  }

  return results;
}

function validateEnvelope(text) {
  const results = [];
  if (!text.includes(ENVELOPE_START)) return [fail(`Missing opening tag: ${ENVELOPE_START}`)];
  if (!text.includes(ENVELOPE_END)) return [fail(`Missing closing tag: ${ENVELOPE_END}`)];
  results.push(pass('Envelope tags present'));

  const start = text.indexOf(ENVELOPE_START) + ENVELOPE_START.length;
  const end = text.indexOf(ENVELOPE_END);
  const envelope = text.slice(start, end);

  for (const field of REQUIRED_ENVELOPE_FIELDS) {
    if (!envelope.includes(field)) {
      results.push(fail(`Missing field: ${field}`));
    } else {
      const line = envelope.split('\n').find(l => l.trim().startsWith(field));
      results.push(pass(`${field.replace(':', '')} — ${d((line || '').trim().slice(0, 70))}`));
    }
  }

  const confLine = envelope.split('\n').find(l => l.trim().startsWith('Confidence:'));
  if (confLine) {
    const confVal = confLine.split(':')[1]?.trim().toLowerCase();
    if (!VALID_CONFIDENCE.includes(confVal)) {
      results.push(fail(`Confidence must be high, medium, or low. Got: "${confVal}"`));
    }
  }

  return results;
}

function complianceLevel(results, hasScore, mode) {
  const failed = results.filter(res => !res.ok).length;
  if (failed > 0) return { level: 'FAIL', colour: r };
  if (mode === 'json' && hasScore) return { level: 'FreshContext-scored \u2605\u2605\u2605', colour: g };
  return { level: 'FreshContext-compatible \u2605\u2605', colour: g };
}

function validateString(input, label) {
  console.log(`\n${bold('freshcontext-validate')} ${d('v1.0.0')}`);
  console.log(d('\u2500'.repeat(52)));
  console.log(`${b('Input:')} ${d(label)}\n`);

  let results = [];
  let hasScore = false;
  let mode = 'envelope';

  try {
    const parsed = JSON.parse(input);
    mode = 'json';
    console.log(`${d('Mode:')} ${b('JSON structured form')}\n`);
    results = validateJSON(parsed);
    hasScore = parsed?.freshcontext?.freshness_score !== undefined
              && parsed?.freshcontext?.freshness_score !== null;
  } catch {
    if (input.includes(ENVELOPE_START)) {
      console.log(`${d('Mode:')} ${b('Text envelope')}\n`);
      results = validateEnvelope(input);
    } else {
      console.log(r('✕ Input is neither valid JSON nor a FreshContext text envelope.\n'));
      console.log(d('Expected:'));
      console.log(`  ${d('JSON:')} {"freshcontext": {"source_url": "...", "retrieved_at": "...", ...}}`);
      console.log(`  ${d('Envelope:')} [FRESHCONTEXT]\\nSource: ...\\n[/FRESHCONTEXT]`);
      process.exit(1);
    }
  }

  results.forEach(res => console.log(res.msg));

  const passed = results.filter(res => res.ok && !res.warn).length;
  const failed = results.filter(res => !res.ok).length;
  const warned = results.filter(res => res.warn).length;

  const { level, colour } = complianceLevel(results, hasScore, mode);

  console.log(`\n${d('\u2500'.repeat(52))}`);
  console.log(`${d('Checks:')} ${g(passed + ' passed')}${warned ? ', ' + y(warned + ' warnings') : ''}${failed ? ', ' + r(failed + ' failed') : ''}`);
  console.log(`${d('Result:')} ${colour(bold(level))}\n`);

  if (failed > 0) process.exit(1);
}

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
${bold('freshcontext-validate')} ${d('v1.0.0')}
Validates FreshContext-compatible responses against the spec.

${bold('USAGE')}
  node freshcontext-validate.js ${d('<json_or_envelope_string>')}
  node freshcontext-validate.js --file ${d('<path>')}
  node freshcontext-validate.js --stdin
  echo '...' | node freshcontext-validate.js --stdin

${bold('COMPLIANCE LEVELS')}
  ${g('FreshContext-scored \u2605\u2605\u2605')}      Full JSON form + numeric freshness_score
  ${g('FreshContext-compatible \u2605\u2605')}   JSON/envelope with retrieved_at + confidence
  ${r('FAIL')}                         Missing required fields

${bold('SPEC')}
  https://freshcontext-site.pages.dev/spec.html
  https://github.com/PrinceGabriel-lgtm/freshcontext-mcp/blob/main/FRESHCONTEXT_SPEC.md
`);
  process.exit(0);
}

if (args[0] === '--stdin') {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => data += chunk);
  process.stdin.on('end', () => validateString(data.trim(), 'stdin'));
} else if (args[0] === '--file') {
  const path = args[1];
  if (!path) { console.error(r('--file requires a path argument')); process.exit(1); }
  const fs = require('fs');
  validateString(fs.readFileSync(path, 'utf8').trim(), path);
} else {
  validateString(args[0], 'inline input');
}

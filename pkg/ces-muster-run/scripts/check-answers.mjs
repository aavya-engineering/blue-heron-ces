#!/usr/bin/env node
// Answers-file check (synthetic-customer W0): customers/<slug>/interview-answers.json, the InterviewFact[] the synthetic
// interviewee gives Muster (PLAN section 2.3; injected through MX_ANSWERS in W1).
//   node scripts/check-answers.mjs --scenario <slug> [--root <WS>] [--file <answers.json>]
// Rules (each failure printed; exit 0 only when all hold):
//   schema      a JSON array of InterviewFact: question_id, question_text, answer (non-empty strings), provenance,
//               confidence (high|medium|low|unknown), recorded_at (ISO 8601), optional source; no other keys; no
//               duplicate question_id
//   register    every question_id is a row of ces-muster's question register (src/features/interview/questionRegister.json),
//               except the bank-defaulted Policy Inputs ids (PI.ODP.001-015, PI.GOV.002/003), which the register does not
//               carry: those must be questions of the Policy Inputs bank (public/knowledge/primed Policy Inputs Question
//               Bank.yaml) and their answers must fit the bank's type (number parses; single_select is one of its options)
//   provenance  provenance = operator_interview and source = synthetic-interview:<slug> on every fact
//   identity    identity-scan.ps1 over the file with nb-tools/scan-tokens.txt + "Blue Heron" + "BHD" + the user name
//               (file and count only), and every mail address is on <slug>.simtenant.onmicrosoft.us
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { v49Tokens } from './v49-scope.mjs';

const a = {};
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
if (!a.scenario) { console.error('usage: node scripts/check-answers.mjs --scenario <slug> [--root <WS>] [--file <answers.json>]'); process.exit(2); }
const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(scriptsDir, '..');
const root = path.resolve(a.root ?? path.join(pkg, '..', '..'));
const slug = a.scenario;
const file = path.resolve(a.file ?? path.join(pkg, 'customers', slug, 'interview-answers.json'));
const mu = path.join(root, 'ces', 'ces-muster');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));

const results = [];
const report = (id, title, problems, detail) => {
  results.push(problems.length === 0);
  console.log(`${problems.length ? 'FAIL' : 'PASS'} ${id} ${title}: ${problems.length ? problems.slice(0, 8).join('; ') : detail}`);
};

let facts = null;
try { facts = readJson(file); } catch (e) { console.log(`FAIL schema: ${path.basename(file)} is not readable JSON (${e instanceof Error ? e.message : e})`); process.exit(1); }

// schema
{
  const problems = [];
  const KEYS = new Set(['question_id', 'question_text', 'answer', 'provenance', 'confidence', 'recorded_at', 'source', 'attestation']);
  if (!Array.isArray(facts)) problems.push('not an array');
  else {
    const seen = new Set();
    facts.forEach((f, i) => {
      const at = `[${i}] ${f?.question_id ?? '?'}`;
      if (!f || typeof f !== 'object') { problems.push(`${at}: not an object`); return; }
      for (const k of ['question_id', 'question_text', 'answer', 'provenance']) if (typeof f[k] !== 'string' || !f[k].trim()) problems.push(`${at}: ${k} missing or empty`);
      if (!['high', 'medium', 'low', 'unknown'].includes(f.confidence)) problems.push(`${at}: confidence ${f.confidence}`);
      if (typeof f.recorded_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(f.recorded_at) || Number.isNaN(Date.parse(f.recorded_at))) problems.push(`${at}: recorded_at ${f.recorded_at}`);
      if (f.source !== undefined && typeof f.source !== 'string') problems.push(`${at}: source not a string`);
      const extra = Object.keys(f).filter((k) => !KEYS.has(k));
      if (extra.length) problems.push(`${at}: unknown keys ${extra.join(', ')}`);
      if (seen.has(f.question_id)) problems.push(`${at}: duplicate question_id`);
      seen.add(f.question_id);
    });
  }
  report('schema', 'InterviewFact[] shape', problems, `${facts.length} facts, all InterviewFact-shaped, no duplicate ids`);
}
if (!Array.isArray(facts)) process.exit(1);

// register
{
  const problems = [];
  const regPath = path.join(mu, 'src', 'features', 'interview', 'questionRegister.json');
  const bankPath = path.join(mu, 'public', 'knowledge', 'primed Policy Inputs Question Bank.yaml');
  const reg = fs.existsSync(regPath) ? readJson(regPath) : null;
  const rows = new Map((reg?.rows ?? []).map((r) => [r.id, r]));
  if (!reg) problems.push(`no question register at ${path.relative(root, regPath)}`);
  let bank = new Map();
  try {
    const yaml = createRequire(path.join(mu, 'package.json'))('js-yaml');
    bank = new Map((yaml.load(fs.readFileSync(bankPath, 'utf8')).sections ?? []).flatMap((s) => s.questions ?? []).map((q) => [q.id, q]));
  } catch (e) { problems.push(`Policy Inputs bank unreadable (${e instanceof Error ? e.message : e})`); }
  const BANK_ONLY = /^PI\.(ODP\.0(0[1-9]|1[0-5])|GOV\.00[23])$/; // PI.ODP.016 and later are Muster-only ODPs (W5 cycle 7)
  const byKind = {};
  let bankIds = 0;
  for (const f of facts) {
    if (BANK_ONLY.test(f.question_id)) {
      const q = bank.get(f.question_id);
      if (!q) { problems.push(`${f.question_id}: not a Policy Inputs bank question`); continue; }
      bankIds++;
      if (q.answer_type === 'number' && !/^-?\d+(\.\d+)?$/.test(String(f.answer).trim())) problems.push(`${f.question_id}: "${f.answer}" is not a number`);
      if (q.answer_type === 'single_select' && !(q.options ?? []).includes(f.answer)) problems.push(`${f.question_id}: "${f.answer}" is not one of ${JSON.stringify(q.options)}`);
      continue;
    }
    const r = rows.get(f.question_id);
    if (!r) { problems.push(`${f.question_id}: no question-register row`); continue; }
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  }
  const regCount = facts.length - bankIds;
  report('register', 'every answer names a register row (bank-defaulted PI.ODP/PI.GOV ids: a bank question of the right type)', problems,
    `${regCount} register ids ${JSON.stringify(byKind)} of ${rows.size} register rows; ${bankIds} Policy Inputs bank ids (not register rows: bank-defaulted today, policyInputsProfile.ts)`);
}

// provenance
{
  const want = `synthetic-interview:${slug}`;
  const bad = facts.filter((f) => f.provenance !== 'operator_interview' || f.source !== want).map((f) => `${f.question_id} (${f.provenance}, ${f.source ?? 'no source'})`);
  report('provenance', `provenance operator_interview, source ${want}`, bad, `all ${facts.length} facts`);
}

// identity
{
  const problems = [];
  const { tokens, tokenFile } = v49Tokens(root);
  const q = (x) => `'${String(x).replace(/'/g, "''")}'`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `& ${q(path.join(scriptsDir, 'identity-scan.ps1'))} -Path ${q(file)} -Extra @(${tokens.map(q).join(',')}) -NoContext -Root ${q(root)}; exit $LASTEXITCODE`], { encoding: 'utf8' });
  if (r.status !== 0) problems.push(`identity scan exit ${r.status}: ${((r.stdout ?? '').match(/^identity scan: .*$/m) ?? ['no summary'])[0]}`);
  const domain = `${slug}.simtenant.onmicrosoft.us`;
  const foreign = facts.flatMap((f) => (f.answer.match(/@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).filter((d) => d.slice(1).toLowerCase() !== domain).map((d) => `${f.question_id} ${d.slice(1)}`));
  if (foreign.length) problems.push(`${foreign.length} mail addresses off ${domain} (e.g. ${foreign.slice(0, 3).join(', ')})`);
  report('identity', 'no identity tokens; mail addresses on the fictional domain', problems, `identity scan clean (${tokens.length} extra tokens, token file ${tokenFile ? 'present' : 'absent'}); every mail address on ${domain}`);
}

const ok = results.every(Boolean);
console.log(`check-answers ${slug}: ${ok ? 'PASS' : 'FAIL'}`);
process.exit(ok ? 0 : 1);

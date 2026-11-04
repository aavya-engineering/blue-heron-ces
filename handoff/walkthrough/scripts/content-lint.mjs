// Content lint of content\steps.json (PLAN.md 13.2 item 5; DONE 14 in scripts\verify.mjs).
//
//   node scripts/content-lint.mjs        prints every problem; exits 0 when there is none
//
// The rules, all mechanical:
// - Budgets (words = whitespace-separated tokens): purpose <= 14, what <= 45, why <= 30, value <= 25, expect <= 40
//   (optional), manual <= 60. title, purpose, what, why, value, outputs and manual must not be empty.
// - Banned anywhere in the page text (every step field, about, module names and blurbs, terms, outOfScope), whole
//   word, any case: shape A, shape B, engine, op, driver, harness, fixture, runDir, junction, flow7, E5,
//   tenant_identity, backstage, and "your" / "my" (profile-neutral wording).
// - No file path: a drive letter (C:\ or C:/), a backslash or slash between word characters, a path starting with
//   "/" after a space or "(", or a file name with a code or document extension (.json .mjs .js .ts .md .txt .ps1
//   .png .pem .docx). The one name allowed is KNOWN-ISSUES.md, in the phrase below.
// - Known issues: the first "KI-nn" of each number (step order, then outOfScope) reads "a known issue, listed in
//   KNOWN-ISSUES.md as KI-nn"; every later one reads "known issue KI-nn".
// - Glossed at first use: for each entry of `terms`, the first text field, in step order and field order purpose,
//   what, expect, why, value, outputs, manual, that contains the term (whole word, any case) must contain the
//   entry's `gloss` verbatim. Titles are rail labels and are not counted as first use. Every term has a gloss and a
//   meaning, and every term is used in at least one step.
import * as fs from 'node:fs';
import * as path from 'node:path';

const BUDGET = { purpose: 14, what: 45, why: 30, value: 25, expect: 40, manual: 60 };
const REQUIRED = ['title', 'purpose', 'what', 'why', 'value', 'outputs', 'manual'];
const GLOSS_FIELDS = ['purpose', 'what', 'expect', 'why', 'value', 'outputs', 'manual'];
const ALL_FIELDS = ['title', ...GLOSS_FIELDS];
const BANNED = ['shape A', 'shape B', 'engine', 'op', 'driver', 'harness', 'fixture', 'runDir', 'junction', 'flow7', 'E5', 'tenant_identity', 'backstage', 'your', 'my'];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (t, flags = 'i') => new RegExp(`(?<![A-Za-z0-9_-])${esc(t)}(?![A-Za-z0-9_-])`, flags);
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
const PATHS = [
  [/[A-Za-z]:[\\/]/, 'a drive path'],
  [/\w\\\w/, 'a backslash path'],
  [/\w\/\w/, 'a slash path'],
  [/(^|[\s(])\/\w/, 'a path starting with /'],
  [/\b[\w.-]+\.(json|mjs|js|ts|md|txt|ps1|png|pem|docx)\b/i, 'a file name'],
];

export function lintContent(content, order) {
  const problems = [];
  const steps = order.map((id) => content.steps.find((s) => s.id === id));
  order.forEach((id, i) => { if (!steps[i]) problems.push(`step ${id}: missing from steps.json`); });
  const texts = []; // [where, text] in page order: steps (field order), then about, modules, terms, outOfScope
  steps.forEach((s) => { if (s) for (const f of ALL_FIELDS) if (typeof s[f] === 'string') texts.push([`${s.id}.${f}`, s[f]]); });
  texts.push(['about', content.about ?? '']);
  for (const m of content.modules ?? []) texts.push([`module ${m.id}.name`, m.name], [`module ${m.id}.blurb`, m.blurb]);
  for (const t of content.terms ?? []) texts.push([`term ${t.term}.meaning`, t.meaning ?? '']);
  (content.outOfScope ?? []).forEach((t, i) => texts.push([`outOfScope[${i}]`, t]));

  for (const s of steps.filter(Boolean)) {
    for (const f of REQUIRED) if (typeof s[f] !== 'string' || !s[f].trim()) problems.push(`${s.id}.${f}: empty`);
    if ('expect' in s && (typeof s.expect !== 'string' || !s.expect.trim())) problems.push(`${s.id}.expect: present but empty`);
    for (const [f, max] of Object.entries(BUDGET)) {
      if (typeof s[f] === 'string' && words(s[f]) > max) problems.push(`${s.id}.${f}: ${words(s[f])} words (budget ${max})`);
    }
  }
  if (!String(content.about ?? '').trim()) problems.push('about: empty');
  for (const m of content.modules ?? []) {
    if (!String(m.blurb ?? '').trim()) problems.push(`module ${m.id}: empty blurb`);
    if ((String(m.blurb).match(/[.!?](\s|$)/g) ?? []).length > 1) problems.push(`module ${m.id}: blurb is more than one sentence`);
  }
  if ((String(content.about).match(/[.!?](\s|$)/g) ?? []).length > 1) problems.push('about: more than one sentence');

  for (const [where, text] of texts) {
    for (const b of BANNED) if (word(b).test(text)) problems.push(`${where}: banned word "${b}"`);
    const scrubbed = text.replace(/KNOWN-ISSUES\.md/g, 'KNOWN_ISSUES');
    for (const [re, what] of PATHS) if (re.test(scrubbed)) problems.push(`${where}: ${what} (${(scrubbed.match(re) ?? [''])[0].trim()})`);
  }

  // Known issues in page order.
  const seen = new Set();
  for (const [where, text] of texts) {
    for (const m of text.matchAll(/KI-\d+/g)) {
      const before = text.slice(0, m.index);
      if (!seen.has(m[0])) {
        if (!before.endsWith('a known issue, listed in KNOWN-ISSUES.md as ')) problems.push(`${where}: first ${m[0]} must read "a known issue, listed in KNOWN-ISSUES.md as ${m[0]}"`);
        seen.add(m[0]);
      } else if (!/known issue $/.test(before)) problems.push(`${where}: later ${m[0]} must read "known issue ${m[0]}"`);
    }
  }

  // Glossed at first use.
  const terms = content.terms ?? [];
  if (!terms.length) problems.push('terms: empty');
  for (const t of terms) {
    if (!t.term || !t.gloss || !t.meaning) { problems.push(`term ${t.term ?? '?'}: needs term, gloss and meaning`); continue; }
    if (!t.gloss.includes(t.term)) problems.push(`term ${t.term}: the gloss does not contain the term`);
    let first = null;
    for (const s of steps.filter(Boolean)) {
      for (const f of GLOSS_FIELDS) {
        if (typeof s[f] === 'string' && word(t.term).test(s[f])) { first = [`${s.id}.${f}`, s[f]]; break; }
      }
      if (first) break;
    }
    if (!first) problems.push(`term ${t.term}: not used in any step`);
    else if (!first[1].includes(t.gloss)) problems.push(`term ${t.term}: first used in ${first[0]} without its gloss "${t.gloss}"`);
  }
  return { problems, checked: { steps: steps.filter(Boolean).length, texts: texts.length, terms: terms.length } };
}

const self = path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const WT = path.resolve(path.dirname(self), '..');
  const content = JSON.parse(fs.readFileSync(path.join(WT, 'content', 'steps.json'), 'utf8'));
  const { STEP_ORDER } = await import(new URL('../steps/index.mjs', import.meta.url).href);
  const { problems, checked } = lintContent(content, STEP_ORDER);
  for (const p of problems) console.log(p);
  console.log(`content lint: ${checked.steps} steps, ${checked.texts} texts, ${checked.terms} terms; ${problems.length} problem(s)`);
  process.exit(problems.length ? 1 : 0);
}

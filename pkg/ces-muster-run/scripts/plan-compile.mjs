#!/usr/bin/env node
// plan-compile.mjs (Blue Heron Defense, CES team). Gap closure API-3a: E3's client for muster-api's
// POST /api/plan/compile. Both harnesses call it (mx-e2e.ps1 E3; ces-tester src/flow/muster-e2e-run.ts E3).
//   MUSTER_API_TOKEN=<bearer> node plan-compile.mjs --api <url> --slug <slug> --disc <discovery-result.json> --out <plan dir>
//        --record <out/plan-compile.json> [--org-content <file>] [--answers <file>] [--stacks a,b]
// FIN-29 (SP-11 R6): the bearer travels in the child's environment (MUSTER_API_TOKEN), never on the command line, where
// same-user processes and process-audit logs can read it. --token <bearer> is kept only as a deprecated developer path
// and prints a warning; the environment wins when both are given.
// Sends the discovery result (and the customer's org content and interview answers, when given) as text, writes
// every returned file into --out (text as utf8, binary from base64), and writes the record (schema
// mx-e2e/plan-compile@1: status, summary, the muster-api-issued initial-password reference, and each file's name,
// size and SHA-256; never a secret value). --stacks defaults to MX_STACKS; MX_TENANT_HARVEST=off is passed on.
// Prints the runner's MX_SUMMARY line, as E3 printed it before. Exit 0 only on HTTP 200 with files written.
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLAN_COMPILE_SCHEMA = 'mx-e2e/plan-compile@1';

/** The request body (pure: file texts in, body out). */
// FIN-17 SP-7: muster-api's initial-password reference allows 1 read by default. The harness needs exactly 2 (Stamper's
// execute primes secrets at E6 and again at E8F; translate and the GUI run do not), so every harness compile asks for 2.
export const PLAN_COMPILE_MAX_READS = 2;
export function compileBody({ slug, discoveryText, orgContentText, answersText, stacks, tenantHarvest, maxReads = PLAN_COMPILE_MAX_READS }) {
  return {
    tenant_slug: slug,
    max_reads: maxReads,
    discovery: discoveryText,
    ...(orgContentText !== undefined ? { org_content: orgContentText } : {}),
    ...(answersText !== undefined ? { interview_answers: answersText } : {}),
    ...(stacks && stacks.length ? { stacks } : {}),
    ...(tenantHarvest === 'off' ? { tenant_harvest: 'off' } : {}),
  };
}

/** Writes the returned files under outDir; returns [{name, bytes, sha256}]. Refuses names that leave outDir. */
export function writeCompiledFiles(outDir, files) {
  const root = path.resolve(outDir);
  const written = [];
  for (const f of files ?? []) {
    const dest = path.resolve(root, f.name);
    if (dest !== root && !dest.startsWith(root + path.sep)) throw new Error(`refused file name outside the plan folder: ${f.name}`);
    const buf = Buffer.from(f.content ?? '', f.encoding === 'base64' ? 'base64' : 'utf8');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    written.push({ name: f.name, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') });
  }
  return written;
}

export async function runCompile(o, fetchImpl = fetch) {
  const read = (p) => (p && fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined);
  const stacks = (o.stacks ?? process.env.MX_STACKS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const body = compileBody({
    slug: o.slug, discoveryText: read(o.disc), orgContentText: read(o['org-content']), answersText: read(o.answers),
    stacks, tenantHarvest: process.env.MX_TENANT_HARVEST,
  });
  const rec = { schema: PLAN_COMPILE_SCHEMA, taken: new Date().toISOString(), api_url: o.api, tenant_slug: o.slug, http_status: null, summary: null, initial_password_ref: null, files: [] };
  let rc = 1;
  try {
    const res = await fetchImpl(`${o.api}/api/plan/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${o.token}` },
      body: JSON.stringify(body),
    });
    rec.http_status = res.status;
    const text = await res.text();
    const j = (() => { try { return JSON.parse(text); } catch { return null; } })();
    if (res.status === 200 && j) {
      fs.rmSync(o.out, { recursive: true, force: true });
      rec.files = writeCompiledFiles(o.out, j.files);
      rec.summary = j.summary ?? null;
      rec.initial_password_ref = j.initial_password_ref ?? null;
      // PKG-2 (cost gate CG-8, V104): the 200 body's recurring-cost notice, compared with the Mission Plan's.
      rec.recurring_cost_notice = j.recurring_cost_notice ?? null;
      // FIN-19 (V114): muster-api's own interview-record send to EO at compile (FIN-17 exposes it in the 200 body).
      rec.eo_interviews = j.eo_interviews ?? null;
      // FIN-17 (V104): the runner's MX_COST_NOTICE lines and the reference's terms (budget, expiry; never a value).
      rec.cost_notice_lines = j.cost_notice_lines ?? null;
      rec.initial_password_terms = j.initial_password_terms ?? null;
      rc =rec.files.length > 0 ? 0 : 1;
      if (rec.summary) console.log(`MX_SUMMARY ${rec.summary}`);
      console.log(`plan-compile: HTTP 200, ${rec.files.length} files -> ${o.out}; initial password ${rec.initial_password_ref ? `reference ${rec.initial_password_ref} (issued by muster-api)` : 'reference: none'}`);
    } else {
      rec.error = j?.error ? `${j.error}${j.detail ? `: ${j.detail}` : ''}` : text.slice(0, 2000);
      console.error(`plan-compile failed: HTTP ${res.status}: ${rec.error}`);
    }
  } catch (e) {
    rec.error = e instanceof Error ? e.message : String(e);
    console.error(`plan-compile failed: ${rec.error}`);
  }
  if (o.record) fs.writeFileSync(o.record, JSON.stringify(rec, null, 2));
  return rc;
}

/** FIN-29 (SP-11 R6): the env variable that carries the muster-api bearer to this client. */
export const TOKEN_ENV = 'MUSTER_API_TOKEN';

/** The bearer: the environment first; --token only as the deprecated path (with a warning on stderr). */
export function resolveToken(o, env = process.env, warn = (m) => console.error(m)) {
  if (env[TOKEN_ENV]) return env[TOKEN_ENV];
  if (o.token) {
    warn(`plan-compile.mjs: --token on the command line is deprecated (SP-11 R6); set ${TOKEN_ENV} in the environment instead`);
    return o.token;
  }
  return undefined;
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { o[argv[i].slice(2)] = argv[i + 1]; i++; }
  return o;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = args(process.argv.slice(2));
  o.token = resolveToken(o);
  if (!o.api || !o.token || !o.slug || !o.disc || !o.out) {
    console.error(`usage: ${TOKEN_ENV}=<bearer> node plan-compile.mjs --api <url> --slug <slug> --disc <file> --out <dir> [--record <file>] [--org-content <file>] [--answers <file>] [--stacks a,b]`);
    process.exit(2);
  }
  runCompile(o).then((rc) => process.exit(rc), (e) => { console.error(String(e)); process.exit(1); });
}

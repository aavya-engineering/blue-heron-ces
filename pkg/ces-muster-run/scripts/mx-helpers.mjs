#!/usr/bin/env node
// MX helpers (Blue Heron Defense, CES team). Small Node pieces mx-e2e.ps1 needs
// that Windows PowerShell 5.1 does badly: the ces-tenant sim registration and
// launch env, and reading a Server-Sent Events stream.
//
//   node mx-helpers.mjs sim-env --ces <ces-root> --slug <slug> --out <env.json>
//       Registers an ephemeral sim tenant through ces-tenant (honours
//       CES_TENANT_ROOT) and writes the sim launch env {PSModulePath, Path,
//       STACKSIM_SERVER_URL}. Same calls as ces-tester's run-scenario-command.ts
//       (createEphemeralSimTenant + StacksimEnvironment.getSimLaunchEnv).
//   node mx-helpers.mjs sse --url <url> --stop <eventType> --out <file> [--timeout <ms>]
//       Reads an SSE stream into a JSON array of events. Exit 0 only when the
//       stop event arrived and no event type ends in "_error".
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1], i++;
  }
  return o;
}

async function simEnv(o) {
  const tenant = await import(pathToFileURL(path.join(o.ces, 'ces-tenant', 'dist', 'index.js')).href);
  const stacksimRoot = path.join(o.ces, 'tenant-stacksim');
  const scenarioFile = path.join(stacksimRoot, 'scenarios', `${o.slug}.json`);
  const stance = fs.existsSync(scenarioFile) ? JSON.parse(fs.readFileSync(scenarioFile, 'utf8')).stance : 'm365_azure';
  const registry = new tenant.FileTenantRegistry({});
  await registry.createEphemeralSimTenant(o.slug, { scenario: o.slug, stance });
  const consumer = { module: 'mx-e2e', purpose: 'MX run: Stamper launch-context on the sim' };
  const provider = new tenant.StacksimEnvironment({ registry, stacksimRoot, consumer });
  const env = await provider.getSimLaunchEnv(o.slug, 'sim', consumer);
  const out = { PSModulePath: env.psModulePath, Path: env.path, STACKSIM_SERVER_URL: env.stacksimServerUrl };
  fs.writeFileSync(o.out, JSON.stringify(out, null, 2));
  console.log(`sim tenant "${o.slug}" registered under ${tenant.getRegistryRoot()}; launch env -> ${o.out}`);
}

async function sse(o) {
  const timeoutMs = Number(o.timeout ?? 600000);
  // --stop is an event type, or type:phase (EO /api/connect ends on connection_log phase "done").
  const [stopType, stopPhase] = String(o.stop).split(':');
  const events = [];
  let stopped = false;
  let reader;
  const timer = setTimeout(() => { reader?.cancel().catch(() => {}); }, timeoutMs);
  try {
    const res = await fetch(o.url);
    reader = res.body.getReader();
    let buf = '';
    outer: for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += Buffer.from(value).toString('utf8');
      let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        try {
          const obj = JSON.parse(line.slice(5).trim());
          events.push(obj);
          if (obj.type === stopType && (!stopPhase || obj.phase === stopPhase)) { stopped = true; break outer; }
        } catch { /* keepalive */ }
      }
    }
    await reader.cancel().catch(() => {});
  } catch (e) {
    events.push({ type: 'mx_stream_error', message: String(e) });
  }
  clearTimeout(timer);
  fs.writeFileSync(o.out, JSON.stringify(events, null, 2));
  const errors = events.filter((e) => typeof e.type === 'string' && e.type.endsWith('_error'));
  const types = {};
  for (const e of events) types[e.type] = (types[e.type] ?? 0) + 1;
  console.log(`sse ${o.url}: ${events.length} events, stop "${o.stop}" ${stopped ? 'reached' : 'NOT reached'}, types ${JSON.stringify(types)}`);
  return stopped && errors.length === 0 ? 0 : 1;
}

// push --api <base> --plans <dir> --slug <slug> --out <response.json>   (bearer: MUSTER_API_TOKEN in the env)
// FIN-29 (SP-11 R6): the muster-api bearer comes from the environment (MUSTER_API_TOKEN), never argv; --token <jwt>
// is kept only as a deprecated developer path.
// POST /api/plan/push with the MP, TM and (when present) IM that plan-from-discovery wrote, plus (MG-12) the
// SI Baseline, TCP and Readiness Posture hand-off envelopes, sent as written; muster-api checks their hashes.
// W3.3c (B9): plus the policy-inputs profile and policy-set manifest envelopes (pick('policy-inputs-profile-'),
// pick('policy-set-manifest-')), sent as policy_inputs_profile / policy_set_manifest.
// W7-PKG: plus the CUI Boundary envelope (W7-MX2, pick('cui-boundary-')), sent as cui_boundary; a skipped boundary
// writes no file, so nothing is sent.
async function push(o) {
  const files = fs.readdirSync(o.plans);
  const pick = (prefix) => files.filter((f) => f.startsWith(prefix) && f.endsWith('.json')).sort().pop();
  const read = (f) => (f ? JSON.parse(fs.readFileSync(path.join(o.plans, f), 'utf8')) : undefined);
  const handoff = {
    si_baseline: 'si-baseline-', tcp: 'tcp-', readiness_posture: 'readiness-posture-',
    policy_inputs_profile: 'policy-inputs-profile-', policy_set_manifest: 'policy-set-manifest-',
    cui_boundary: 'cui-boundary-',
  };
  const body = {
    tenant_slug: o.slug,
    missionPlan: read(pick('manual-mission-plan-')),
    tenantManifest: read(pick('tenant-manifest-')),
    ...(pick('infrastructure-manifest-') ? { infraManifest: read(pick('infrastructure-manifest-')) } : {}),
    ...Object.fromEntries(Object.entries(handoff).filter(([, p]) => pick(p)).map(([k, p]) => [k, read(pick(p))])),
  };
  const res = await fetch(`${o.api}/api/plan/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MUSTER_API_TOKEN || o.token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  fs.writeFileSync(o.out, text);
  console.log(`push: HTTP ${res.status} (sent: ${Object.keys(body).filter((k) => k !== 'tenant_slug').join(', ')}) ${text.slice(0, 400)}`);
  if (res.status !== 201) console.error(`push failed: HTTP ${res.status}: ${text}`);   // e.g. a 400 naming a malformed envelope or a hash mismatch
  return res.status === 201 ? 0 : 1;
}

// ledger --out <file>: full sim ledger snapshot (POST /ledger {}).
async function ledger(o) {
  const res = await fetch('http://127.0.0.1:4390/ledger', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  const j = await res.json();
  fs.writeFileSync(o.out, JSON.stringify(j));
  console.log(`ledger: ${(j.data ?? []).length} entries -> ${o.out}`);
  return res.ok ? 0 : 1;
}

const [cmd, ...rest] = process.argv.slice(2);
const o = args(rest);
const run = { 'sim-env': simEnv, sse, push, ledger }[cmd];
if (!run) {
  console.error('usage: mx-helpers.mjs sim-env|sse|push|ledger ...');
  process.exit(2);
}
run(o).then((code) => { process.exitCode = code ?? 0; }, (e) => { console.error(e?.stack ?? String(e)); process.exitCode = 1; });

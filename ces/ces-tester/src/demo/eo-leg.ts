// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-1 — Beat 3 (EO) leg for the CES-wide demo (closes critique P1-6).
 *
 * Drives ces-eo's REAL server against the demo-dib-small sim tenant that Beats
 * 0-2 just seeded + remediated, so the assessment reflects THIS run — not the
 * static `gen-assessor-demo.mts` golden (which is pinned to a different tenant
 * and would misrepresent the demo). Stage 1 = connect + assess (the rehearsed,
 * live-sim-smoke-covered path); SSP/POA&M/Evidence.zip generation is Stage 2.
 *
 * P1-9 (EO env fragility) is handled head-on: EVERY inherited casing of
 * `PSModulePath`/`Path` is stripped before the sim shims are set, or the real
 * Microsoft.Graph modules shadow the sim shims and assessment crashes to 0/110.
 *
 * The pure helpers (env scrub, SSE parse, summary extraction) are unit-tested;
 * the live `runEoLeg` self-gates (returns `available:false` off-Windows or when
 * the sim psmodules aren't present) and degrades gracefully — a demo must show
 * "EO detail pending" rather than a crash or, worse, a wrong tenant's data.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as net from 'node:net';
import * as path from 'node:path';
import { eoTenantUrl } from './eo-tenant-url.js';

export interface EoAssessSummary {
  readonly snapshotId?: string;
  readonly sprsScore?: number; // EO DETAIL sprs — never the headline (one-SPRS rule; Muster owns headline)
  readonly controlsMet?: number;
  readonly controlsNotMet?: number;
  readonly controlsPartial?: number;
  readonly controlsNotAssessed?: number;
  readonly liveAssessmentCount?: number; // 0 ⇒ the live signal leg crashed — DO NOT trust the numbers
}

export interface EoLegResult {
  readonly available: boolean; // false ⇒ self-gated (env can't run EO); caller shows "EO detail pending"
  readonly connected: boolean;
  readonly summary?: EoAssessSummary;
  readonly error?: string;
  /** Per-control detail for `EoLegOptions.controlIds`, fetched via
   * `GET /api/controls/:controlId` after a successful live assess. Absent
   * when no controlIds were requested or the fetch failed (best-effort). */
  readonly controls?: readonly EoControlDetail[];
}

export interface EoControlDetail {
  readonly controlId: string;
  readonly status: 'met' | 'not_met' | 'partial' | 'not_assessed';
  readonly nistRef?: string;
}

/** Maps a `GET /api/controls/:controlId` JSON body (ces-eo's `ControlAssessment`
 * shape) into `EoControlDetail`, or undefined if the shape doesn't match —
 * pure, unit-tested. */
export function mapControlDetail(json: unknown): EoControlDetail | undefined {
  const c = json as { control_id?: unknown; status?: unknown; nist_ref?: unknown } | null | undefined;
  if (!c || typeof c.control_id !== 'string' || typeof c.status !== 'string') return undefined;
  if (c.status !== 'met' && c.status !== 'not_met' && c.status !== 'partial' && c.status !== 'not_assessed') {
    return undefined;
  }
  return {
    controlId: c.control_id,
    status: c.status,
    nistRef: typeof c.nist_ref === 'string' ? c.nist_ref : undefined,
  };
}

/**
 * Build the EO child env. Strips EVERY casing of PSModulePath/Path (Windows env
 * keys are case-insensitive) BEFORE setting the sim shims. Pure — takes the base
 * env and the resolved paths, returns a new env object.
 */
export function buildEoChildEnv(
  baseEnv: NodeJS.ProcessEnv,
  cfg: {
    simRoot: string;
    psModules: string;
    psHomeModules: string;
    tenantRoot: string;
    stamperRegistry: string;
    storageRoot: string;
    slug: string;
    simUrl: string;
    port: number;
  },
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    const lk = k.toLowerCase();
    if (lk === 'psmodulepath' || lk === 'path') continue; // drop ALL casings
    env[k] = v;
  }
  const priorPath = baseEnv.Path ?? baseEnv.PATH ?? '';
  env.PSModulePath = cfg.psHomeModules ? `${cfg.psModules};${cfg.psHomeModules}` : cfg.psModules;
  env.Path = `${path.join(cfg.simRoot, 'azshim')};${priorPath}`;
  env.STACKSIM_SERVER_URL = cfg.simUrl;
  env.CES_TENANT_ROOT = cfg.tenantRoot;
  env.REGISTRY_PATH = cfg.stamperRegistry;
  env.STORAGE_ROOT = cfg.storageRoot;
  env.TENANT_SLUG = cfg.slug;
  env.EO_PORT = String(cfg.port);
  return env;
}

/** Parse one SSE `data:` frame into an object, or undefined for keepalives. */
export function parseSseData(frame: string): Record<string, unknown> | undefined {
  const line = frame.split('\n').find((l) => l.startsWith('data:'));
  if (!line) return undefined;
  try {
    return JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Extract the EO assess summary from the collected SSE events. Pure — maps the
 * `assess_summary` event's snake_case wire fields to EoAssessSummary. Returns
 * `{}` if no summary event is present.
 */
export function summarizeEoAssess(events: ReadonlyArray<Record<string, unknown>>): EoAssessSummary {
  const s = [...events].reverse().find((e) => e.type === 'assess_summary');
  if (!s) return {};
  const n = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
  return {
    snapshotId: typeof s.snapshotId === 'string' ? s.snapshotId : undefined,
    sprsScore: n(s.sprs_score),
    controlsMet: n(s.controls_met),
    controlsNotMet: n(s.controls_not_met),
    controlsPartial: n(s.controls_partial),
    controlsNotAssessed: n(s.controls_not_assessed),
    liveAssessmentCount: n(s.liveAssessmentCount),
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });
}

function psHomeModules(): Promise<string> {
  return new Promise((resolve) => {
    const c = spawn('powershell.exe', ['-NoProfile', '-Command', 'Write-Output (Join-Path $PSHOME Modules)']);
    let o = '';
    c.stdout.on('data', (d: Buffer) => (o += d.toString('utf8')));
    c.on('close', () => resolve(o.trim()));
    c.on('error', () => resolve(''));
  });
}

async function drainSse(port: number, url: string, stopType: string, timeoutMs: number): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += Buffer.from(value).toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const obj = parseSseData(frame);
        if (!obj) continue;
        events.push(obj);
        if (obj.type === stopType) {
          clearTimeout(timer);
          return events;
        }
      }
    }
  } catch {
    /* aborted / stream error — return what we have */
  }
  clearTimeout(timer);
  return events;
}

export interface EoLegOptions {
  readonly eoRoot: string; // ces-eo
  readonly simRoot: string; // tenant-stacksim
  readonly stamperRegistry: string; // ces-stamper registry json
  readonly slug: string; // demo-dib-small
  readonly simUrl?: string; // default http://127.0.0.1:4390
  /** A CES_TENANT_ROOT that already resolves `sim/<slug>.json`. If absent, a
   * throwaway one is created and seeded (ces-tester's own dir — allowed). */
  readonly tenantRoot?: string;
  readonly simTenantJson?: unknown; // seed body when we create the tenant root
  /** Control IDs to fetch per-control detail for after a successful live
   * assess (e.g. `['IA.L2-3.5.3']`) — best-effort, populates `EoLegResult.controls`. */
  readonly controlIds?: readonly string[];
}

/**
 * `GET /api/controls/:controlId?tenant=<slug>` — best-effort, never throws.
 * FX-TE5: the tenant is the slug this leg just assessed (ces-eo FX-EO8 400s a
 * tenantless read); exported so the tenant contract is unit-testable.
 */
export async function fetchControl(port: number, controlId: string, slug: string): Promise<EoControlDetail | undefined> {
  try {
    const r = await fetch(eoTenantUrl(`http://127.0.0.1:${port}`, `/api/controls/${encodeURIComponent(controlId)}`, slug), {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return undefined;
    return mapControlDetail(await r.json());
  } catch {
    return undefined;
  }
}

/**
 * Run Beat 3 (Stage 1: connect + assess). Boots EO out-of-process against the
 * live sim, drives connect→assess, returns the summary. Self-gating + graceful:
 * never throws; returns `available:false` when the env can't host EO, and
 * `connected:false` with an error string on any live failure.
 */
export async function runEoLeg(opts: EoLegOptions): Promise<EoLegResult> {
  const simUrl = opts.simUrl ?? 'http://127.0.0.1:4390';
  const psModules = path.join(opts.simRoot, 'psmodules');
  const gated =
    process.platform !== 'win32' ||
    !fs.existsSync(path.join(psModules, 'Microsoft.Graph.Authentication')) ||
    !fs.existsSync(path.join(opts.simRoot, 'bin', 'stacksim.mjs')) ||
    !fs.existsSync(opts.stamperRegistry);
  if (gated) {
    return { available: false, connected: false, error: 'EO env not available (off-Windows or sim psmodules/registry absent)' };
  }

  let eo: ChildProcess | undefined;
  let ownTenantRoot: string | undefined;
  let storageRoot: string | undefined;
  try {
    let tenantRoot = opts.tenantRoot;
    if (!tenantRoot) {
      ownTenantRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-eo-tenants-'));
      fs.mkdirSync(path.join(ownTenantRoot, 'sim'), { recursive: true });
      fs.writeFileSync(path.join(ownTenantRoot, 'sim', `${opts.slug}.json`), JSON.stringify(opts.simTenantJson ?? {}, null, 2));
      tenantRoot = ownTenantRoot;
    }
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-eo-storage-'));

    const port = await freePort();
    const childEnv = buildEoChildEnv(process.env, {
      simRoot: opts.simRoot,
      psModules,
      psHomeModules: await psHomeModules(),
      tenantRoot,
      stamperRegistry: opts.stamperRegistry,
      storageRoot,
      slug: opts.slug,
      simUrl,
      port,
    });

    eo = spawn('npx tsx src/eo/index.ts', { cwd: opts.eoRoot, env: childEnv, shell: true, stdio: 'ignore' });

    const healthy = async (): Promise<boolean> => {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
        return r.ok;
      } catch {
        return false;
      }
    };
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline && !(await healthy())) await new Promise((r) => setTimeout(r, 1000));
    if (!(await healthy())) return { available: true, connected: false, error: 'EO server did not become healthy within 60s' };

    const connectEvents = await drainSse(port, `/api/connect?tenant=${opts.slug}`, 'done', 40000);
    const phases = connectEvents.filter((e) => e.type === 'connection_log').map((e) => e.phase);
    const connected = phases.includes('connected_graph') && !phases.includes('error_graph');
    if (!connected) return { available: true, connected: false, error: 'EO connect did not reach connected_graph' };

    const assessEvents = await drainSse(port, `/api/assess?tenant=${opts.slug}`, 'assess_done', 180000);
    const summary = summarizeEoAssess(assessEvents);
    if (!summary.liveAssessmentCount || summary.liveAssessmentCount === 0) {
      return { available: true, connected: true, summary, error: 'assessment completed but liveAssessmentCount=0 (signal leg crashed) — numbers not trustworthy' };
    }
    let controls: EoControlDetail[] | undefined;
    if (opts.controlIds && opts.controlIds.length > 0) {
      const fetched = await Promise.all(opts.controlIds.map((id) => fetchControl(port, id, opts.slug)));
      controls = fetched.filter((c): c is EoControlDetail => c !== undefined);
    }
    return { available: true, connected: true, summary, controls };
  } catch (err) {
    return { available: true, connected: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (eo?.pid) {
      try {
        spawnSync('taskkill', ['/pid', String(eo.pid), '/T', '/F']); // no shell — taskkill is on PATH (avoids DEP0190)
      } catch {
        /* ignore */
      }
    }
    for (const dir of [ownTenantRoot, storageRoot]) {
      if (dir) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    }
  }
}

// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// parityHarness.ts — MG-04: content parity between Muster's outputs and
// Planner's golden outputs for the same synthetic fixture customer.
//
// Fixture layout (src/features/plan/__fixtures__/customers/):
//   <x>/planner-inputs.json   the answers Planner's wizards hold for customer x
//   <x>/muster-session.json   the matching Muster engagement/party/session (discovery + interview facts)
//   <x>/planner-golden/*.json Planner's outputs (ces-planner/scripts/generate-goldens.ts), + golden-meta.json
//   parity-allowlist.json     the reviewed allow-list: every tolerated diff, with an MG item and a reason
//
// Two Muster producers are compared with the goldens:
//   'session' (end to end): the real compilePlanForSession over the session
//      (fake IndexedDB + /knowledge served from public/), plus the readiness
//      posture from scoreFacts — what Muster produces for this customer today.
//   'chain' (equal inputs): Muster's vendored compile (buildPlanArtifacts) fed
//      Planner's own SIT answers, posture results, TCP and plan mode. Diffs here
//      are in the generator chain itself, not in what Muster collects.
//
// Diffs are computed after normalisation (generated ids, content hashes and
// cesId removed; both sides run with the same frozen clock) and keyed by
// natural ids so one moved element is one diff, not a cascade.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';
import { FROZEN_TIME, freezeEntropy } from './fixtureInputs';
import { loadBanks } from './planTestSupport';
import { applyReferenceText } from '@/features/plan/engine/shared/services/practiceReference';
import { compileReportIntermediates, generatePlanReports } from '../reports/planReports';

// cwd-relative like planTestSupport (the repo root under `npm test` and the scripts).
export const CUSTOMERS_DIR = path.resolve(process.cwd(), 'src/features/plan/__fixtures__/customers');
export const ALLOWLIST_PATH = path.join(CUSTOMERS_DIR, 'parity-allowlist.json');

export type Producer = 'session' | 'chain';

/** Artifacts compared, by golden file name. Tasks are compared as MP steps (one step per compiled task). */
export const ARTIFACTS = [
  'si-baseline',
  'tenant-config-profile',
  'cui-boundary',
  'rr-question-set',
  'readiness-posture',
  'manual-mission-plan',
  'tenant-manifest',
  'infrastructure-manifest',
  'policy-documents',
  // MG-11 / MG-18: the assessor reports and the tech-ref guide. Planner's golden
  // generator does not emit them yet; their goldens are derived in memory
  // (reportGoldens below) from the on-disk goldens.
  'exclusions-report',
  'traceability-report',
  'control-assessment-report',
  'tech-ref-implementation-guide',
] as const;
export type ArtifactName = (typeof ARTIFACTS)[number];

export function fixtureKeys(): string[] {
  return fs
    .readdirSync(CUSTOMERS_DIR)
    .filter((d) => fs.existsSync(path.join(CUSTOMERS_DIR, d, 'planner-inputs.json')))
    .sort();
}

function readJson(p: string): any {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function loadCustomer(key: string) {
  const dir = path.join(CUSTOMERS_DIR, key);
  const goldenDir = path.join(dir, 'planner-golden');
  const meta = readJson(path.join(goldenDir, 'golden-meta.json'));
  const goldens: Partial<Record<ArtifactName, unknown>> = {};
  for (const name of meta.artifacts as ArtifactName[]) goldens[name] = readJson(path.join(goldenDir, `${name}.json`));
  // MG-11 / MG-18: derived report goldens, computed on first read only.
  for (const name of REPORT_ARTIFACTS) {
    if (name in goldens) continue;
    Object.defineProperty(goldens, name, {
      enumerable: true,
      configurable: true,
      get: () => reportGoldens(key, goldens)[name],
    });
  }
  return {
    dir,
    goldenDir,
    inputsText: fs.readFileSync(path.join(dir, 'planner-inputs.json'), 'utf8'),
    inputs: readJson(path.join(dir, 'planner-inputs.json')),
    musterSession: readJson(path.join(dir, 'muster-session.json')),
    meta,
    goldens,
  };
}

// ── MG-11 / MG-18: report goldens ───────────────────────────────────────────

export const REPORT_ARTIFACTS = [
  'exclusions-report',
  'traceability-report',
  'control-assessment-report',
  'tech-ref-implementation-guide',
] as const satisfies readonly ArtifactName[];

/** The report objects keyed by artifact name. */
export function reportArtifacts(r: import('../reports/planReports').PlanReports): Partial<Record<ArtifactName, unknown>> {
  const out: Partial<Record<ArtifactName, unknown>> = {
    'traceability-report': r.traceability,
    'control-assessment-report': r.controlAssessment,
    'tech-ref-implementation-guide': r.techRef,
  };
  if (r.exclusions) out['exclusions-report'] = r.exclusions;
  return out;
}

/** The report banks: the compiler banks + the RR Question Bank (Muster's byte copies of Planner's stores). */
export function reportBanks(): import('../reports/planReports').ReportBanks {
  return {
    ...loadBanks(),
    rrQuestionBank: load(fs.readFileSync(path.resolve(process.cwd(), 'public/knowledge/primed RR Question Bank.yaml'), 'utf8')),
  };
}

const reportGoldenCache = new Map<string, Partial<Record<ArtifactName, unknown>>>();

/**
 * What Planner's generate-goldens.ts would emit for the reports, derived from
 * the goldens on disk: useMissionPlanGenerator steps 5, 6, 6B and 9 over the
 * golden SI Baseline, RR Question Set, readiness posture, CUI boundary and TCP,
 * with the gap set and task catalog compiled as plannerGoldens.ts does
 * (requirement store with the reference text). The generators are Muster's
 * verbatim copies of Planner's (check:drift --against-sibling), so this checks
 * Muster's inputs and wiring, not the generators.
 */
export function reportGoldens(key: string, goldens: Partial<Record<ArtifactName, unknown>>): Partial<Record<ArtifactName, unknown>> {
  const hit = reportGoldenCache.get(key);
  if (hit) return hit;
  const raw = reportBanks();
  const banks = { ...raw, cmmcRequirements: applyReferenceText(raw.cmmcRequirements) };
  const entropy = freezeEntropy();
  try {
    // CG-1: Muster's generators now default an unanswered infrastructure model to m365_only; Planner's
    // (whose output these goldens stand for) defaulted to m365_azure. Planner's golden SI drops the
    // model (section 5 defect), so supply Planner's own default here to keep the golden Planner's.
    const si = goldens['si-baseline'] as { si_baseline?: { dependencies?: Record<string, unknown> } } | undefined;
    const plannerSi = si?.si_baseline && !si.si_baseline.dependencies?.infrastructure_model
      ? { ...si, si_baseline: { ...si.si_baseline, dependencies: { ...si.si_baseline.dependencies, infrastructure_model: 'm365_azure' } } }
      : si;
    const inputs = {
      siBaseline: plannerSi as never,
      posture: goldens['readiness-posture'] as never,
      cuiBoundary: (goldens['cui-boundary'] as never) ?? null,
      tenantConfig: (goldens['tenant-config-profile'] as never) ?? null,
      questionSet: (goldens['rr-question-set'] as never) ?? null,
    };
    const out = reportArtifacts(generatePlanReports(inputs, compileReportIntermediates(inputs, banks), banks));
    reportGoldenCache.set(key, out);
    return out;
  } finally {
    entropy.restore();
  }
}

// ── Muster producers ────────────────────────────────────────────────────────

/** Serve the SPA's static /knowledge/* assets from public/ on disk. */
function stubKnowledgeFetch(): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const rel = decodeURI(String(url)).replace(/^\//, '');
    const file = path.resolve(process.cwd(), 'public', rel);
    if (!fs.existsSync(file)) return { ok: false, status: 404, text: async () => '', json: async () => null } as unknown as Response;
    const text = fs.readFileSync(file, 'utf8');
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) } as unknown as Response;
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

/**
 * End to end: seed Dexie with the fixture's engagement/party/session and run
 * the production compilePlanForSession, plus the readiness posture Muster's
 * scoring path (scoreFacts) produces. Requires `fake-indexeddb/auto` loaded.
 */
export async function musterFromSession(key: string): Promise<Partial<Record<ArtifactName, unknown>>> {
  const { musterSession } = loadCustomer(key);
  const { freezeEntropy } = await import('./fixtureInputs');
  const { db } = await import('@/shared/db/schema');
  const restoreFetch = stubKnowledgeFetch();
  const entropy = freezeEntropy();
  try {
    await db.engagements.put(musterSession.engagement);
    await db.assessed_parties.put(musterSession.party);
    await db.interview_sessions.put(musterSession.session);
    const { compilePlanForSession } = await import('../planCompileService');
    const result = await compilePlanForSession(musterSession.session.id);
    const { scoreFacts } = await import('@/features/scoring/scoringService');
    const { loadQuestionGraph } = await import('@/features/interview/questionGraphService');
    const stacks: string[] = musterSession.session.selected_stacks ?? [];
    // MG-07: with the session's preamble snapshot when it holds one (Planner's preamble).
    const { posture } = await scoreFacts(musterSession.session.facts, await loadQuestionGraph(stacks), stacks, {
      preamble: musterSession.session.preamble ?? null,
    });
    // MG-07: the RR Question Set for the scenario Muster selects activities by.
    const { buildRRQuestionSet, scenarioSiBaseline } = await import('@/features/scoring/readinessScope');
    const { expandLegacyReadinessFacts } = await import('@/features/interview/questionGraph');
    const { scorableFacts } = await import('@/features/scoring/draftSemantics');
    const { load } = await import('js-yaml');
    // Planner's dataLoader replaces the Store's requirement_text with the ces-shared reference text (R-1).
    const { applyReferenceText } = await import('@/features/plan/engine/shared/services/practiceReference');
    const yaml = (f: string) => load(fs.readFileSync(path.resolve(process.cwd(), 'public/knowledge', f), 'utf8'));
    const rrQuestionSet = await buildRRQuestionSet(
      scenarioSiBaseline(expandLegacyReadinessFacts(scorableFacts(musterSession.session.facts)), stacks),
      yaml('primed RR Question Bank.yaml'),
      {
        cmmcRequirements: applyReferenceText(yaml('domain CES CMMC Fundamental Requirements Store.yaml')),
        assessorKB: yaml('domain Assessor Approach Knowledge Base.yaml'),
      } as never
    );
    const out: Partial<Record<ArtifactName, unknown>> = {
      'si-baseline': result.artifacts.siBaseline,
      'rr-question-set': rrQuestionSet,
      'readiness-posture': posture,
      'manual-mission-plan': result.artifacts.missionPlan,
      'tenant-manifest': result.artifacts.tenantManifest,
    };
    if (result.artifacts.tenantConfig) out['tenant-config-profile'] = result.artifacts.tenantConfig;
    // MG-08: the CUI boundary the compile used.
    if (result.artifacts.cuiBoundary) out['cui-boundary'] = result.artifacts.cuiBoundary;
    if (result.artifacts.infrastructureManifest) out['infrastructure-manifest'] = result.artifacts.infrastructureManifest;
    // MG-11 / MG-18: the reports from the compile (renderReports' objects),
    // over the compile's own gap set and task catalog (MG-16 hand-off (a)).
    Object.assign(
      out,
      reportArtifacts(
        generatePlanReports(
          {
            siBaseline: result.artifacts.siBaseline,
            posture: result.posture as never,
            cuiBoundary: result.artifacts.cuiBoundary,
            tenantConfig: result.artifacts.tenantConfig,
            questionSet: rrQuestionSet,
          },
          { gapSet: result.artifacts.gapSet, taskCatalog: result.artifacts.taskCatalog },
          reportBanks()
        )
      )
    );
    // MG-16: the 20 policy documents, when the session carries policy inputs
    // (Planner renders them only when policy inputs exist), in the golden's shape.
    if ((musterSession.session.facts as Array<{ question_id: string }>).some((f) => f.question_id.startsWith('PI.'))) {
      const { renderPolicySet } = await import('../policy/policyDocuments');
      const set = await renderPolicySet({
        compile: result,
        facts: musterSession.session.facts,
        party: musterSession.party,
        bank: yaml('primed Policy Inputs Question Bank.yaml'),
      });
      // The templates' line endings follow the checkout (RF-47 pins LF-normalised); compare LF.
      out['policy-documents'] = set.documents.map((d) => ({
        template_id: d.template_id,
        title: d.title,
        markdown: d.markdown.replace(/\r\n/g, '\n'),
        completeness: d.completeness,
      }));
    }
    return out;
  } finally {
    entropy.restore();
    restoreFetch();
  }
}

/**
 * Equal inputs: Muster's one compile (buildPlanArtifacts) fed Planner's SIT
 * answers, the golden posture's requirement results, the golden TCP and the
 * fixture's plan mode. Only MP/TM/IM/SI come out of this producer.
 */
export async function musterChainFromPlannerInputs(key: string): Promise<Partial<Record<ArtifactName, unknown>>> {
  const { inputs, goldens } = loadCustomer(key);
  const { freezeEntropy } = await import('./fixtureInputs');
  const { loadBanks } = await import('./planTestSupport');
  const { buildPlanArtifacts } = await import('../tenantManifestAdapter');
  const sitAnswers: Record<string, any> = {};
  for (const [id, raw] of Object.entries(inputs.sit as Record<string, unknown>)) {
    sitAnswers[id] = {
      question_id: id,
      answer_type: Array.isArray(raw) ? 'multi_select' : typeof raw === 'number' ? 'number' : raw && typeof raw === 'object' ? 'structured_object' : 'enum',
      raw_answer: raw,
      captured_at: '1970-01-01T00:00:00.000Z',
      provenance_class: 'client_assertion',
    };
  }
  const posture = goldens['readiness-posture'] as { ces: { requirement_results: Array<{ requirement_id: string; status: string }> } };
  const entropy = freezeEntropy();
  try {
    const a = buildPlanArtifacts(
      {
        sitAnswers,
        requirementResults: posture.ces.requirement_results.map((r) => ({ requirement_id: r.requirement_id, status: r.status as never })),
        tenantConfig: (goldens['tenant-config-profile'] as never) ?? null,
        planMode: inputs.planMode,
      },
      loadBanks()
    );
    const out: Partial<Record<ArtifactName, unknown>> = {
      'si-baseline': a.siBaseline,
      'manual-mission-plan': a.missionPlan,
      'tenant-manifest': a.tenantManifest,
    };
    if (a.infrastructureManifest) out['infrastructure-manifest'] = a.infrastructureManifest;
    return out;
  } finally {
    entropy.restore();
  }
}

/** The artifacts each producer can emit; the rest are out of its reach, not diffs. */
export const PRODUCER_ARTIFACTS: Record<Producer, ArtifactName[]> = {
  session: [...ARTIFACTS],
  chain: ['si-baseline', 'manual-mission-plan', 'tenant-manifest', 'infrastructure-manifest'],
};

// ── Normalisation and diff ──────────────────────────────────────────────────

/**
 * idGenerator.generateId: `<prefix>_<base36 Date.now()>_<base36 random>`. Both
 * sides run on the same frozen clock, so every generated id carries the same
 * time part; the random part is replaced wherever it appears (ids are embedded
 * in other ids, e.g. `step_task_AC.L1-3.1.1_<time>_<rand>`, and in id arrays).
 */
const TIME36 = FROZEN_TIME.toString(36);
const GENERATED_ID_RUN = new RegExp(`(^|_)${TIME36}_[0-9a-z]{1,9}`, 'g');
const DROP_KEYS = new Set(['cesId']);
const HASH_KEYS = new Set(['hash', 'hash_sha256', 'sha256', 'si_baseline_hash']);

export function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DROP_KEYS.has(k)) continue;
      out[k] = HASH_KEYS.has(k) && typeof v === 'string' ? '<hash>' : normalize(v);
    }
    return out;
  }
  if (typeof value === 'string') return value.replace(GENERATED_ID_RUN, '$1<id>');
  return value;
}

/**
 * Shape adapters applied before diffing, for differences that are intended
 * and documented: Muster emits the Infrastructure Manifest in the ces-shared
 * contract shape (W4-MU1: body under `infrastructure`, not Planner's
 * `infrastructure_manifest`). Renaming the key lets the content still be
 * compared; Muster's added contract fields remain visible as diffs.
 */
function adaptMuster(artifact: ArtifactName, value: unknown): unknown {
  if (artifact === 'infrastructure-manifest' && value && typeof value === 'object') {
    const { infrastructure, ...rest } = value as Record<string, unknown>;
    if (infrastructure !== undefined) return { ...rest, infrastructure_manifest: infrastructure };
  }
  return value;
}

export interface Diff {
  path: string;
  kind: 'changed' | 'missing' | 'extra';
  golden?: unknown;
  muster?: unknown;
}

const KEY_CANDIDATES = [
  'requirement_id', 'control_id', 'practice_id', 'activity_id', 'action_id', 'question_id', 'template_id',
  'entry_id', 'resource_id', 'zone_id', 'step_id', 'task_id', 'milestone_id', 'id', 'signal', 'name', 'title',
  'key', 'path',
];

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const esc = (s: string) => s.replace(/\//g, '%2F');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function arrayKey(a: unknown[], b: unknown[]): string | null {
  if (!a.every(isPlainObject) || !b.every(isPlainObject)) return null;
  for (const k of KEY_CANDIDATES) {
    const ok = (arr: Record<string, unknown>[]) => {
      const seen = new Set<string>();
      for (const e of arr) {
        const v = e[k];
        if (v === undefined || v === null || typeof v === 'object') return false;
        const s = String(v);
        if (seen.has(s)) return false;
        seen.add(s);
      }
      return true;
    };
    if (ok(a as Record<string, unknown>[]) && ok(b as Record<string, unknown>[])) return k;
  }
  return null;
}

function walk(g: unknown, m: unknown, p: string[], out: Diff[]): void {
  if (same(g, m)) return;
  const at = p.join('/');
  if (g === undefined) return void out.push({ path: at, kind: 'extra', muster: m });
  if (m === undefined) return void out.push({ path: at, kind: 'missing', golden: g });
  if (Array.isArray(g) && Array.isArray(m) && (g.length > 0 || m.length > 0)) {
    const key = arrayKey(g, m);
    if (key) {
      const gm = new Map(g.map((e) => [String((e as Record<string, unknown>)[key]), e]));
      const mm = new Map(m.map((e) => [String((e as Record<string, unknown>)[key]), e]));
      const keys = [...gm.keys(), ...[...mm.keys()].filter((k) => !gm.has(k))];
      for (const k of keys) walk(gm.get(k), mm.get(k), [...p, `[${key}=${esc(k)}]`], out);
      return;
    }
    if (g.every(isPlainObject) && m.every(isPlainObject)) {
      const n = Math.max(g.length, m.length);
      for (let i = 0; i < n; i++) walk(g[i], m[i], [...p, `[${i}]`], out);
      return;
    }
    // Scalar lists (step text lines, id lists): report only the elements that
    // differ, so a diff can be attributed by its content (valuePattern).
    if (!g.some((x) => x && typeof x === 'object') && !m.some((x) => x && typeof x === 'object')) {
      const gs = new Set(g.map((x) => JSON.stringify(x)));
      const ms = new Set(m.map((x) => JSON.stringify(x)));
      const onlyG = g.filter((x) => !ms.has(JSON.stringify(x)));
      const onlyM = m.filter((x) => !gs.has(JSON.stringify(x)));
      if (onlyG.length || onlyM.length) return void out.push({ path: at, kind: 'changed', golden: onlyG, muster: onlyM });
      return void out.push({ path: at, kind: 'changed', golden: g, muster: m }); // same elements, different order
    }
    return void out.push({ path: at, kind: 'changed', golden: g, muster: m });
  }
  if (isPlainObject(g) && isPlainObject(m)) {
    const keys = [...Object.keys(g), ...Object.keys(m).filter((k) => !(k in g))];
    for (const k of keys) walk(g[k], m[k], [...p, esc(k)], out);
    return;
  }
  out.push({ path: at, kind: 'changed', golden: g, muster: m });
}

/** Diff one artifact. A whole artifact absent on one side is a single diff at path ''. */
export function diffArtifact(artifact: ArtifactName, golden: unknown, muster: unknown): Diff[] {
  const out: Diff[] = [];
  walk(
    golden === undefined ? undefined : normalize(golden),
    muster === undefined ? undefined : normalize(adaptMuster(artifact, muster)),
    [],
    out
  );
  return out;
}

// ── Allow-list ──────────────────────────────────────────────────────────────

export interface AllowEntry {
  id: string;
  /** The backlog item (MG-xx), decision (D1) or section-5 defect that owns this diff. */
  mg: string;
  /** Fixtures this entry was reviewed for. */
  fixtures: string[] | '*';
  producer: Producer | '*';
  artifact: ArtifactName | ArtifactName[] | '*';
  /** Glob(s) over the diff path: '/' separates segments, '*' = one segment (or a run inside one), '**' = any number. */
  path: string | string[];
  kind?: Diff['kind'];
  /**
   * Optional content test: every scalar on both sides of the diff (list
   * elements included) must match this regex. Used where one field mixes
   * causes (e.g. the `[TCP Context]` lines of a step are MG-14, the rest MG-07).
   */
  valuePattern?: string;
  /** Other items that also have to land before this entry can be removed. */
  also?: string[];
  reason: string;
  /** Exact number of diffs this entry absorbs per fixture (both producers together); absent = 0. */
  count: Record<string, number>;
}

export function loadAllowList(): AllowEntry[] {
  return readJson(ALLOWLIST_PATH).entries as AllowEntry[];
}

const segRe = new Map<string, RegExp>();
function segMatches(pattern: string, seg: string): boolean {
  if (!pattern.includes('*')) return pattern === seg;
  let re = segRe.get(pattern);
  if (!re) {
    const escaped = pattern.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
    re = new RegExp(`^${escaped.join('.*')}$`);
    segRe.set(pattern, re);
  }
  return re.test(seg);
}
/** Segment-wise glob: '**' = zero or more segments, '*' inside a segment = any run of characters. */
function globMatches(glob: string[], segs: string[]): boolean {
  if (glob.length === 0) return segs.length === 0;
  if (glob[0] === '**') {
    for (let i = 0; i <= segs.length; i++) if (globMatches(glob.slice(1), segs.slice(i))) return true;
    return false;
  }
  return segs.length > 0 && segMatches(glob[0], segs[0]) && globMatches(glob.slice(1), segs.slice(1));
}

export function entryMatches(e: AllowEntry, producer: Producer, artifact: ArtifactName, d: Diff): boolean {
  if (e.producer !== '*' && e.producer !== producer) return false;
  if (e.artifact !== '*' && !(Array.isArray(e.artifact) ? e.artifact.includes(artifact) : e.artifact === artifact)) return false;
  if (e.kind && e.kind !== d.kind) return false;
  const segs = d.path === '' ? [] : d.path.split('/');
  const globs = Array.isArray(e.path) ? e.path : [e.path];
  if (!globs.some((g) => globMatches(g === '' ? [] : g.split('/'), segs))) return false;
  if (e.valuePattern) {
    const re = new RegExp(e.valuePattern);
    const scalars = [d.golden, d.muster].flatMap((v) => (Array.isArray(v) ? v : v === undefined ? [] : [v]));
    if (scalars.length === 0 || !scalars.every((v) => (v === null || typeof v !== 'object') && re.test(String(v)))) return false;
  }
  return true;
}

export interface ParityResult {
  /** Diffs no allow-list entry absorbs — each one fails the suite. */
  unallowed: Array<Diff & { artifact: ArtifactName }>;
  /** entry id -> number of diffs it absorbed for this fixture + producer. */
  absorbed: Record<string, number>;
  /** entry id -> the diffs it absorbed (for the review report). */
  absorbedDiffs: Record<string, Array<Diff & { artifact: ArtifactName }>>;
  total: number;
}

/** Match every diff of every artifact against the allow-list (first matching entry wins). */
export function checkParity(
  fixture: string,
  producer: Producer,
  goldens: Partial<Record<ArtifactName, unknown>>,
  muster: Partial<Record<ArtifactName, unknown>>,
  entries: AllowEntry[]
): ParityResult {
  const unallowed: ParityResult['unallowed'] = [];
  const absorbed: Record<string, number> = {};
  const absorbedDiffs: ParityResult['absorbedDiffs'] = {};
  let total = 0;
  for (const artifact of PRODUCER_ARTIFACTS[producer]) {
    for (const d of diffArtifact(artifact, goldens[artifact], muster[artifact])) {
      total++;
      // First matching entry in file order, among those scoped to this fixture.
      const e = entries.find((x) => (x.fixtures === '*' || x.fixtures.includes(fixture)) && entryMatches(x, producer, artifact, d));
      if (e) {
        absorbed[e.id] = (absorbed[e.id] ?? 0) + 1;
        (absorbedDiffs[e.id] ??= []).push({ ...d, artifact });
      } else unallowed.push({ ...d, artifact });
    }
  }
  return { unallowed, absorbed, absorbedDiffs, total };
}

/** Short, readable rendering of a diff for failure messages. */
export function describeDiff(d: Diff & { artifact?: string }): string {
  const v = (x: unknown) => {
    const s = JSON.stringify(x);
    return s === undefined ? 'undefined' : s.length > 120 ? `${s.slice(0, 117)}...` : s;
  };
  return `${d.artifact ?? ''}:${d.path || '<whole artifact>'} ${d.kind} golden=${v(d.golden)} muster=${v(d.muster)}`;
}

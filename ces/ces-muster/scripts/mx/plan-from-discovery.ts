// MX overlay (Blue Heron Defense, CES team): headless discovery -> plan runner.
// Closes gap N-03 (no headless path from a discovery file to plan files).
// Gap closure API-3a: muster-api's POST /api/plan/compile runs this script as its compile worker
// (muster-api/src/services/planCompileService.ts), and the e2e harness's E3 calls that route. Run on its
// own it behaves as before (V88 compares the two).
//
// It drives the SAME Muster functions the browser app uses, in the same order:
//   sessionDriver.createSession           (src/driver/sessionDriver.ts)
//   parseReadinessResultFile              (src/features/discovery/importReadinessResult.ts)
//   stageHeadlessFacts                     (src/features/plan/headless/headlessImport.ts:
//     BoundaryConfirmPanel.tsx handleContinue, AssessmentPage.tsx mount effects, finishInterview)
//   compilePlanForSession                  (src/features/plan/planCompileService.ts)
//   buildReadinessResult                   (src/features/export/readinessResultService.ts)
// MG-03 (2C-0): plan-trace requirement_results and the readiness result's
// derived.requirement_results are the compile's one posture (sessionPosture.ts),
// so they equal the MP's embedded control_status_summary (runbook check V4).
// Dexie runs on fake-indexeddb (as muster-api's full-session tests do). The
// banks the SPA fetches from /knowledge are served from public/ by a fetch shim.
//
// Run from ces-muster/ (nested layout only: @types/node resolves from the parent):
//   npx vite-node scripts/mx/plan-from-discovery.ts
// Inputs (env):
//   MX_DISCOVERY  path to a readiness-result file from `mu discovery --sim`
//   MX_OUT        output folder
//   MX_SLUG       tenant slug used in the file names
//   MX_STACKS     optional, comma-separated stack tiles (default m365_e5_gcc,microsoft_intune,microsoft_sentinel)
//   MX_TENANT_HARVEST  optional; 'off' skips the harvest reads (readiness probes and tenant-fact reads; offline dry run)
//   MX_ORG_CONTENT optional; a synthetic customer's organisation content (customers/<slug>/org-content.json). Its
//                  `simulation` block (V58) rides on the policy-inputs profile, and every policy document and report
//                  carries "SIMULATED CUSTOMER (FICTIONAL): <legal name>". Unset (muster-partial): no block, no marker.
//                  W1: its operator_values_without_register_row become answered OPV.<stamperVar> facts.
//                  operatorUPN / breakGlassUPN / breakGlassUserId there are fallbacks only: a discovered value wins
//                  (trace operator_value_sources says which won).
//                  W5: its `roles` and `approvers` name every policy's owner (default ISSM) and approver.
//                  W5c4 (P-1): on a sim tenant its touFileName / touFileBase64 are stored through storeTouFile
//                  as the TCP.MU.002 upload (headless/simProvisioning.ts simTouFileFact).
//   MX_INITIAL_PASSWORD_REF optional (gap closure FLOW-5 a); a one-time secret reference issued by muster-api
//                  (POST /api/plan/compile, which runs this script). A sim-only plan records it as the TCP.MU.003 answer
//                  instead of a runner-generated reference; muster-api holds the value and Stamper resolves it at execute.
//                  Unset (run standalone): the runner generates its own reference, as before.
//   MX_ANSWERS     optional (W1); a synthetic customer's interview answers (customers/<slug>/interview-answers.json,
//                  InterviewFact[], provenance operator_interview, source synthetic-interview:<slug>). Merged at
//                  the facts seam (headless/answersImport.ts: never over a decisive discovery verdict; fills
//                  'unsure' and unanswered) and replaces SIM_BOUNDARY_DECISION. Unset: behaviour unchanged.
// Output: one `MX_RESULT <json>` line on stdout.
//
// MG-08 (sim only): discovery leaves the bnd-* boundary drafts unconfirmed, so
// CUI presence is never established and Muster builds no boundary. The runner
// adds ONE scripted decision — SIM_BOUNDARY_DECISION below, a G-02
// 'cui_present' fact with provenance 'defaulted' — so the e2e Tenant Manifest
// carries boundary_zones (orchestrator check V12). It is recorded in the trace.
// MG-15: the push gate's blocking errors make the runner fail loudly (exit 1,
// errors on stderr) instead of writing a plan that a push would refuse.
// FX-11 / MG-13 / MG-14: the harvest's readiness probes and tenant-fact reads
// (muster-api runHarvest + runTenantHarvest) run against the sim's Graph,
// exactly as the harvest route's sim path does, and land as harvest pre-fills (AssessmentPage order: a harvest
// pre-fill wins over a discovery one). Operator values nothing supplies stay
// defaulted; the discovery file names a sim tenant, so the plan is sim-only and
// the gate lists them instead of blocking.
// P2C.1: the same run also writes, next to the plan files, the 20 MG-16 policy
// documents (policies/<base>.md + .docx, renderPolicySet over the compile and
// the session) and the MG-11 / MG-18 reports (reports/, renderReports over the
// compile's own gap set and task catalog), then prints one MX_SUMMARY line of
// counts before MX_RESULT. A blocked plan still exits 1 before anything is written.
// MG-12: the SI Baseline, TCP and posture are written as hash-referenced hand-off
// envelopes (si-baseline-, tcp-, readiness-posture-<slug>-<ts>.json), counted in
// plan_files; the former bare tenant-config-profile-<slug>-<ts>.json is retired.
// W3.3b (B9): the policy set is rendered before the MP is written, and its two
// MG-12 envelopes (policy-inputs-profile-, policy-set-manifest-<slug>-<ts>.json)
// are written first, so the MP carries their refs; both are counted in plan_files.
// W7-MX2: the CUI Boundary is the sixth MG-12 envelope (cui-boundary-<slug>-<ts>.json,
// written by writeHandoffOutputs; the bare boundary file is retired); the MP's
// inputs.cui_boundary_ref carries its artifact_id, hash_sha256 and schema_id (no
// file_name: a push stores it under another <ts>, and Stamper finds it by
// artifact_id). A skipped boundary writes no file and no reference fields; the
// trace's boundary block names the reason. The BTC Confirmation (the vendored
// BTCConfirmationOutput) is written bare as btc-confirmation-<slug>-<ts>.json.
import 'fake-indexeddb/auto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { InterviewFact } from '@/shared/types/engagement';
import { noticeLines, noticeSummaryFields } from '../../src/features/plan/headless/runnerCostLines';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MUSTER_ROOT = path.resolve(HERE, '..', '..');
const CES_ROOT = path.resolve(MUSTER_ROOT, '..');
const PUBLIC_DIR = path.join(MUSTER_ROOT, 'public');

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('/')) {
    const file = path.join(PUBLIC_DIR, decodeURIComponent(url.split('?')[0]));
    return new Response(fs.readFileSync(file));
  }
  return realFetch(input, init);
}) as typeof fetch;

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

/** MG-08: the scripted, sim-only boundary decision (never used outside this runner). */
const SIM_BOUNDARY_DECISION = {
  question_id: 'G-02',
  question_text: 'SIM-ONLY DEFAULT (plan-from-discovery): CUI presence assumed so the sim plan carries a CUI boundary',
  answer: 'cui_present',
  provenance: 'defaulted',
  confidence: 'high' as const,
};

async function main(): Promise<void> {
  const discoveryPath = path.resolve(need('MX_DISCOVERY'));
  const outDir = path.resolve(need('MX_OUT'));
  const slug = need('MX_SLUG');
  const stacks = (process.env.MX_STACKS ?? 'm365_e5_gcc,microsoft_intune,microsoft_sentinel')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const { db } = await import('@/shared/db/schema');
  const { createSession, completeInterview } = await import('@/driver/sessionDriver');
  const { parseReadinessResultFile, consentsFromPayload } = await import('@/features/discovery/importReadinessResult');
  const { stageHeadlessFacts } = await import('@/features/plan/headless/headlessImport');
  const { parseInterviewAnswers, mergeInterviewAnswers, operatorValueFactsFromOrgContent, partyFromOrgContent } = await import('@/features/plan/headless/answersImport');
  const { OPERATOR_VALUE_FACT_PREFIX } = await import('@/features/plan/derive/operatorValues');
  const { runHarvest, runTenantHarvest } = await import('../../muster-api/src/services/harvestService');
  const { realGraphClient } = await import('../../muster-api/src/lib/graphClient');
  const { SIM_URL } = await import('../../muster-api/src/services/liveSimSession');
  const { compilePlanForSession } = await import('@/features/plan/planCompileService');
  const { operatorValuesFor } = await import('@/features/plan/tcpAdapter');
  const { buildReadinessResult } = await import('@/features/export/readinessResultService');
  const { postureRequirementRows, postureCounts } = await import('@/features/plan/sessionPosture');
  const { renderPolicySet, loadPolicyBank } = await import('@/features/plan/policy/policyDocuments');
  const { renderReports } = await import('@/features/plan/reports/planReports');
  const { loadReportBanks, buildSessionQuestionSet } = await import('@/features/plan/reports/sessionReports');
  const { writePolicyOutputs, writeReportOutputs, writeHandoffOutputs, writePolicyHandoffOutputs } = await import('@/features/plan/headless/planOutputFiles');

  // 1. Import the discovery file exactly as the Discovery tab does.
  const payload = parseReadinessResultFile(fs.readFileSync(discoveryPath, 'utf8'));

  // 2. A session for the engagement the discovery run names.
  const handle = await createSession(payload.manifest.engagement_kind, {
    stacks,
    party: { name: `Sim tenant ${slug}`, on_prem_ot: 'no' },
  });

  // 3. The harvest route's facts (routes/harvest.ts, sim client): the readiness
  // probes (RR-ACT-* activities), then the tenant-fact reads.
  const harvestOff = process.env.MX_TENANT_HARVEST === 'off';
  const client = harvestOff ? null : realGraphClient('stacksim', `${SIM_URL}/v1.0`);
  const readinessFacts = client ? await runHarvest(client) : [];
  const tenantFacts = client ? await runTenantHarvest(client) : [];

  // 4. BoundaryConfirmPanel.handleContinue with no decisions (drafts stay drafts),
  // then the AssessmentPage pre-fills and the saved facts (headlessImport.ts).
  const { results, facts } = stageHeadlessFacts(payload, [...readinessFacts, ...tenantFacts], stacks);
  // W1: harvest facts on OPV.<stamperVar> ids (no graph node) are kept for the TM.
  const operatorHarvestFacts = tenantFacts
    .filter((f) => f.question_id.startsWith(OPERATOR_VALUE_FACT_PREFIX))
    .map(({ captured_at, ...f }) => ({ ...f, question_text: `Operator value ${f.question_id.slice(OPERATOR_VALUE_FACT_PREFIX.length)} (${f.source})`, recorded_at: captured_at }));
  const orgContentPath = process.env.MX_ORG_CONTENT;
  const orgContent = orgContentPath
    ? (JSON.parse(fs.readFileSync(path.resolve(orgContentPath), 'utf8')) as { simulation?: unknown })
    : undefined;
  // W1: MX_ANSWERS replaces the scripted boundary decision; unset, the runner is unchanged.
  const answersPath = process.env.MX_ANSWERS;
  let sessionFacts: InterviewFact[];
  let answersTrace: Record<string, unknown> | null = null;
  let simBoundaryFact: (typeof SIM_BOUNDARY_DECISION & { recorded_at: string }) | null = null;
  const answers = answersPath ? parseInterviewAnswers(fs.readFileSync(path.resolve(answersPath), 'utf8'), slug) : [];
  const orgFacts = orgContent ? operatorValueFactsFromOrgContent(orgContent, slug, answers[0]?.recorded_at ?? new Date().toISOString()) : [];
  // W5c2 (SC-5): the org-content profile block is the synthetic customer's engagement profile (legal
  // name, CAGE, UEI; PI.ORG.001/006/007). Absent (muster-partial), the party stays the slug stub.
  const orgParty = orgContent ? partyFromOrgContent(orgContent) : null;
  if (orgParty) await db.assessed_parties.update(handle.partyId, orgParty);
  if (answersPath) {
    const merged = mergeInterviewAnswers([...facts, ...operatorHarvestFacts], [...answers, ...orgFacts]);
    sessionFacts = merged.facts;
    answersTrace = {
      file: path.basename(answersPath),
      answers: answers.length,
      org_content_operator_values: orgFacts.length,
      added: merged.added.length,
      replaced: merged.replaced,
      kept_discovery: merged.keptDiscovery,
    };
  } else {
    simBoundaryFact = { ...SIM_BOUNDARY_DECISION, recorded_at: new Date().toISOString() };
    sessionFacts = [...mergeInterviewAnswers([...facts, ...operatorHarvestFacts], orgFacts).facts, simBoundaryFact];
  }
  // W5c3 (ruling R-4): a sim-only plan gets the one-time initial-password reference
  // the operator would generate on the Plan tab (the value is never kept).
  const { simInitialPasswordFact, simTouFileFact } = await import('@/features/plan/headless/simProvisioning');
  // FLOW-5 (a): under POST /api/plan/compile the reference is muster-api's (same fact, its answer replaced).
  const issuedPasswordRef = process.env.MX_INITIAL_PASSWORD_REF;
  const generatedPasswordFact = simInitialPasswordFact(sessionFacts, payload.manifest.tenant.kind, slug, new Date().toISOString());
  const initialPasswordFact = generatedPasswordFact && issuedPasswordRef ? { ...generatedPasswordFact, answer: issuedPasswordRef } : generatedPasswordFact;
  if (initialPasswordFact) sessionFacts = [...sessionFacts, initialPasswordFact];
  // W5c4 (P-1): a sim-only plan stores the org-content terms-of-use PDF through the
  // production storeTouFile (the operator's TCP.MU.002 upload) and records its reference.
  const touFileFact = await simTouFileFact(handle.sessionId, sessionFacts, payload.manifest.tenant.kind, orgContent, slug, new Date().toISOString());
  if (touFileFact) sessionFacts = [...sessionFacts, touFileFact];
  await db.interview_sessions.update(handle.sessionId, {
    facts: sessionFacts,
    discovery_results: results,
    discovery_observations: payload.observations,
    readiness_manifest: {
      mode: payload.manifest.mode,
      auth_tier: payload.manifest.auth_tier,
      tenant_slug: slug,
      tenant_kind: payload.manifest.tenant.kind,
      operator_name: payload.manifest.operator.name,
      operator_role: payload.manifest.operator.role,
    },
    ...(consentsFromPayload(payload).length > 0 ? { live_consents: consentsFromPayload(payload) } : {}),
  });
  await completeInterview(handle);

  // 5. The Plan tab compile, and the readiness export.
  const compiled = await compilePlanForSession(handle.sessionId);
  const session = (await db.interview_sessions.get(handle.sessionId))!;
  const party = (await db.assessed_parties.get(session.party_id))!;
  const engagement = (await db.engagements.get(party.engagement_id))!;
  // MG-03 (2C-0): one posture. The readiness result and the trace read the
  // posture the compile read and the MP embeds (compiled.posture).
  const readiness = buildReadinessResult(engagement, party, session, compiled.posture);
  const reqRows = postureRequirementRows(compiled.posture);

  // MG-15: the push gate. A blocked plan is reported, never written as if pushable.
  if (compiled.validation.blocking.length > 0) {
    throw new Error(
      `plan validation blocks this plan (a push would be refused): ${compiled.validation.blocking.join(' | ')}`
    );
  }

  // 6. Boundary schema check (ces-shared), as the tester shim does.
  const shared = await import(
    pathToFileURL(path.join(CES_ROOT, 'ces-shared', 'dist', 'types', 'mission-plan.contract.js')).href
  );
  const a = compiled.artifacts;
  const mp = shared.ManualMissionPlanSchema.safeParse(a.missionPlan);
  const tm = shared.TenantManifestSchema.safeParse(a.tenantManifest);
  if (!mp.success) throw new Error(`ces-shared rejects the MP: ${JSON.stringify(mp.error.issues.slice(0, 5))}`);
  if (!tm.success) throw new Error(`ces-shared rejects the TM: ${JSON.stringify(tm.error.issues.slice(0, 5))}`);

  // 7. Write with muster-api's push names (muster-api/src/routes/plan.ts).
  fs.mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const write = (name: string, obj: unknown): string => {
    const p = path.join(outDir, name);
    fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
    return p;
  };
  // W3.3b (B9): render the policy set first; its envelopes' refs go into the MP before the MP is written.
  const simulation = orgContent?.simulation;
  const policySet = await renderPolicySet({ compile: compiled, facts: session.facts, party, bank: await loadPolicyBank(), simulation, orgContent });
  const policyHandoffFiles = await writePolicyHandoffOutputs(outDir, slug, ts, policySet, a.missionPlan, compiled.handoff.si_baseline?.cesId ?? engagement.id);
  const mpWithRefs = shared.ManualMissionPlanSchema.safeParse(a.missionPlan);
  if (!mpWithRefs.success) throw new Error(`ces-shared rejects the MP with policy refs: ${JSON.stringify(mpWithRefs.error.issues.slice(0, 5))}`);
  const files: Record<string, string> = {
    missionPlan: write(`manual-mission-plan-${slug}-${ts}.json`, a.missionPlan),
    tenantManifest: write(`tenant-manifest-${slug}-${ts}.json`, a.tenantManifest),
    readinessResult: write(`readiness-result-${slug}.json`, readiness),
  };
  if (a.infrastructureManifest) {
    files.infrastructureManifest = write(`infrastructure-manifest-${slug}-${ts}.json`, a.infrastructureManifest);
  }
  // MG-12: the SI Baseline, TCP and Readiness Posture as hash-referenced
  // hand-off envelopes (si-baseline-/tcp-/readiness-posture-<slug>-<ts>.json),
  // the objects the MP's inputs.*_ref point at.
  const handoffFiles = writeHandoffOutputs(outDir, slug, ts, compiled.handoff);
  if (handoffFiles.si_baseline) files.siBaseline = handoffFiles.si_baseline;
  if (handoffFiles.tcp) files.tcp = handoffFiles.tcp;
  if (handoffFiles.readiness_posture) files.readinessPosture = handoffFiles.readiness_posture;
  // W7-MX2: the CUI Boundary envelope (writeHandoffOutputs) and the bare BTC Confirmation.
  if (handoffFiles.cui_boundary) files.cuiBoundary = handoffFiles.cui_boundary;
  if (a.btcConfirmation) files.btcConfirmation = write(`btc-confirmation-${slug}-${ts}.json`, a.btcConfirmation);
  if (policyHandoffFiles.policy_inputs_profile) files.policyInputsProfile = policyHandoffFiles.policy_inputs_profile;
  if (policyHandoffFiles.policy_set_manifest) files.policySetManifest = policyHandoffFiles.policy_set_manifest;

  // P2C.1: the policy documents and the assessor reports.
  const policies = await writePolicyOutputs(outDir, policySet);
  const reportBanks = await loadReportBanks();
  const questionSet = await buildSessionQuestionSet(session.facts, session.selected_stacks ?? stacks, reportBanks.rrQuestionBank, reportBanks);
  const reportFileNames = writeReportOutputs(outDir, renderReports(compiled, reportBanks, questionSet, policySet.profile.output.simulation ?? null));

  const trace = {
    discovery_file: path.basename(discoveryPath),
    stacks,
    observations: payload.observations.length,
    discovered_facts: facts.filter((f) => f.provenance === 'auto_detected').length,
    readiness_harvest_facts: readinessFacts.length,
    tenant_harvest_facts: tenantFacts.length,
    facts_total: session.facts.length,
    requirement_results: postureCounts(reqRows),
    defaulted_inputs: compiled.defaultedInputs,
    answers: answersTrace,
    boundary: {
      sim_decision: simBoundaryFact
        ? { question_id: simBoundaryFact.question_id, answer: simBoundaryFact.answer, provenance: simBoundaryFact.provenance }
        : null,
      skipped: compiled.cuiBoundaryBuild.skipped,
      // W7-MX2: the MP's hash reference to the pushed CUI Boundary, or why there is none.
      cui_boundary_ref: compiled.handoff.cui_boundary
        ? {
            artifact_id: compiled.handoff.cui_boundary.artifact_id,
            hash_sha256: compiled.handoff.cui_boundary.hash_sha256,
            schema_id: compiled.handoff.cui_boundary.schema_id,
          }
        : null,
      no_reference_reason: compiled.handoff.cui_boundary
        ? null
        : (compiled.cuiBoundaryBuild.skipped ?? 'no CUI Boundary built (no CUI question bank)'),
      boundary_zones: (
        (a.tenantManifest as { tenant_manifest?: { boundary_zones?: { definitions?: unknown[] } } }).tenant_manifest
          ?.boundary_zones?.definitions ?? []
      ).length,
    },
    plan_mode: compiled.planModeDecision,
    // W5c3: Non-Stack controls promoted manual -> implement (a configuring registry entry exists).
    directive_promotions: a.directivePromotions,
    // W5c3 (R-4): whether the runner generated the sim-only initial-password reference (never the value).
    // FLOW-5 (a): 'issued by muster-api ...' when the reference came from MX_INITIAL_PASSWORD_REF (planCompileService ISSUED_REF_TRACE).
    initial_password_ref: initialPasswordFact
      ? (issuedPasswordRef ? 'issued by muster-api (sim-only; muster-api holds the value)' : 'generated (sim-only, headless runner)')
      : null,
    // W5c4 (P-1): the terms-of-use reference stored from org-content (file name and sha256, never the bytes).
    tou_file_ref: touFileFact ? touFileFact.answer : null,
    operator_values: compiled.validation.operatorValues,
    // W1: where each FX-11 operator value came from, incl. which won when an answered OPV fallback also existed.
    operator_value_sources: Object.fromEntries(
      Object.values(operatorValuesFor(a.tenantConfig) ?? {}).map((v) => [v.stamperVar, { provenance: v.provenance, from: v.from }])
    ),
    validation: {
      blocking: compiled.validation.blocking,
      warnings: compiled.validation.warnings,
      schema_warnings: compiled.validation.schema.warnings,
      schema_accepted: compiled.validation.schema.accepted.length,
    },
    files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, path.basename(v)])),
    policies: {
      documents: policies.documents,
      files: policies.files,
      unresolved_tokens: policies.unresolved,
      convention_patterns: policies.conventionPatterns,
      personnel_drafts_unconfirmed: policies.personnelDrafts,
      input_sources: policies.sources,
      context_completeness: policySet.contextCompleteness,
    },
    reports: { files: reportFileNames },
    // CG-8 / FIN-17: the Mission Plan's recurring-cost notice (the same object the MP carries). Informational.
    recurring_cost_notice: compiled.recurringCostNotice ?? null,
  };
  files.trace = write('plan-trace.json', trace);
  const unresolvedCount = Object.values(policies.unresolved).reduce((n, t) => n + t.length, 0);
  process.stdout.write(
    `MX_SUMMARY plan_files=${Object.keys(files).length} policies=${policies.documents} policy_files=${policies.files.length} reports=${reportFileNames.length} unresolved_tokens=${unresolvedCount} personnel_drafts=${policies.personnelDrafts.length} blocking=${compiled.validation.blocking.length} warnings=${compiled.validation.warnings.length} ${noticeSummaryFields(compiled.recurringCostNotice)}\n`
  );
  // CG-8 / FIN-17: one line per recurring-cost item, before MX_RESULT (COST-GATE-SPEC §5.2). Never blocks.
  for (const line of noticeLines(compiled.recurringCostNotice)) process.stdout.write(`${line}\n`);
  process.stdout.write(`MX_RESULT ${JSON.stringify({ files, trace })}\n`);
}

main().then(
  () => process.exit(0),
  (e) => {
    process.stderr.write(`plan-from-discovery failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    process.exit(1);
  }
);

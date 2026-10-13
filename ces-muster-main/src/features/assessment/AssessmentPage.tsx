// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import { useState, useEffect, useRef } from 'react';
import { db } from '@/shared/db/schema';
import { nanoid } from '@/shared/utils/nanoid';
import { loadQuestionGraph, stackFilteredGraph, declaredStacksFor, type QuestionNode } from '@/features/interview/questionGraphService';
import { QUESTION_GRAPH } from '@/features/interview/questionGraph';
import { useTimingContext } from '@/features/timer/timingCore';
import { createEngagement } from '@/features/intake/engagementService';
import { computeStoppedSegments } from '@/features/quick/quickSessionHelpers';
import TimerBar from '@/features/timer/TimerBar';
import type { EngagementKind, AssessedParty, InterviewSession, InterviewFact, FactAttestation, ReadinessManifestCapture } from '@/shared/types/engagement';
import type { DiscoveryResult } from '@/shared/types/discovery';
import type { ReadinessConsent } from '@/shared/types/readinessResult';
import { DRAFT_PROVENANCES, attestationRecord, scorableFacts } from '@/features/scoring/draftSemantics';
import { ARCHETYPES_FIXTURE } from '@/__fixtures__/archetypes';
import { applyArchetypeDefaults } from './archetypePrefill';
import CoachPanel from '@/features/coach/CoachPanel';
import PlanInputField from './PlanInputField';
import { InitialPasswordField, TouFileField } from './ProvisioningFields';
import { AdaptiveEngine, type AdaptiveMode } from './adaptiveEngine';
import { deriveSitFacts } from '@/features/plan/siDerivation';
import {
  groupByCluster,
  answeredCount,
  allAnswered,
  factsFromAnswers,
  answersFromFacts,
  loadHarvestFacts,
  applyHarvestFacts,
  clearHarvestFacts,
  loadDiscoveryFacts,
  applyDiscoveryFacts,
  clearDiscoveryFacts,
  loadDiscoveryResults,
  clearDiscoveryResults,
  loadDiscoveryConsents,
  clearDiscoveryConsents,
} from './assessmentHelpers';

export const SERVICE_OPTIONS = [
  { id: 'm365_e3', label: 'Microsoft 365 E3' },
  { id: 'm365_e5_gcc', label: 'Microsoft 365 E5 / GCC' },
  { id: 'microsoft_intune', label: 'Microsoft Intune' },
  { id: 'microsoft_sentinel', label: 'Microsoft Sentinel' },
  { id: 'on_prem_ad', label: 'On-Premises Active Directory' },
  { id: 'sharepoint', label: 'SharePoint' },
  { id: 'none', label: 'None of the above' },
] as const;

/** Map provenance value to a display badge class. */
function provenanceBadgeClass(provenance: string): string {
  if (provenance === 'ai_adaptive') return 'badge badge-review';
  if (provenance === 'auto_detected') return 'badge badge-compliant';
  return 'badge';
}

/** Map provenance to a short display label. */
function provenanceLabel(provenance: string): string {
  if (provenance === 'ai_adaptive') return 'AI';
  if (provenance === 'auto_detected') return 'AUTO';
  return 'OP';
}

/** Map confidence to a badge class. */
function confidenceBadgeClass(confidence: InterviewFact['confidence']): string {
  if (confidence === 'high') return 'badge badge-compliant';
  if (confidence === 'medium') return 'badge badge-review';
  if (confidence === 'low') return 'badge badge-risk';
  return 'badge badge-violation';
}

interface AssessmentPageProps {
  /** Provide to resume an in-progress session from Dexie. */
  existingSessionId?: string;
  /**
   * Fired when the engagement record is created (Begin Interview) or restored on
   * resume. G-MUSTER-PL-1 C2: carries the real party_id so a contract created
   * mid-new-session attaches to the party (previously null except on resume).
   */
  onEngagementReady: (kind: EngagementKind, engagementId: string, partyId: string) => void;
  onComplete: (sessionId: string) => void;
}

export default function AssessmentPage({
  existingSessionId,
  onEngagementReady,
  onComplete,
}: AssessmentPageProps) {
  // Profile fields (locked once the interview begins — party/engagement are written then)
  const [kind, setKind] = useState<EngagementKind>('individual_contractor');
  const [orgName, setOrgName] = useState('');
  const [uei, setUei] = useState('');
  const [cage, setCage] = useState('');
  const [coversM365, setCoversM365] = useState<'' | 'yes' | 'no'>('');
  const [onPremOt, setOnPremOt] = useState<'' | 'yes' | 'no' | 'unsure'>('');
  const [employeeCount, setEmployeeCount] = useState('');
  const [hasSsp, setHasSsp] = useState<'' | 'yes' | 'no' | 'unsure'>('');

  // AI-adaptive toggle — defaults OFF so the static graph path (DW#5) is unchanged.
  const [adaptiveEnabled, setAdaptiveEnabled] = useState(false);
  // Current mode reported by the engine (only relevant when engine exists)
  const [adaptiveMode, setAdaptiveMode] = useState<AdaptiveMode>('adaptive');
  // True when queued answers exist and have not been synced
  const [pendingSync, setPendingSync] = useState(false);
  // Question the engine currently suggests (highlighted in the UI)
  const [suggestedQuestionId, setSuggestedQuestionId] = useState<string | null>(null);
  // Adaptive engine instance — non-null only after adaptive begin
  const engineRef = useRef<AdaptiveEngine | null>(null);

  // Services stay editable throughout — they derive the question tabs.
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [questions, setQuestions] = useState<QuestionNode[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // Per-question provenance and confidence (supports harvest prefill + adaptive)
  const [provenances, setProvenances] = useState<Record<string, string>>({});
  const [confidences, setConfidences] = useState<Record<string, InterviewFact['confidence']>>({});
  // Source string for harvest-prefilled answers (for AUTO-DETECTED badge display)
  const [harvestSources, setHarvestSources] = useState<Record<string, string>>({});
  // GO-2 M4: named-human attestations for confirmed drafts (question_id keyed).
  // Absent for a draft-provenance answer = unconfirmed draft (renders as one,
  // never scores). Must ride every factsFromAnswers call or confirmations are
  // silently demoted back to drafts on the next answer write.
  const [attestations, setAttestations] = useState<Record<string, FactAttestation>>({});
  // GO-2 M2: the selected archetype (mechanism only; fixture content).
  const [selectedArchetype, setSelectedArchetype] = useState<string | null>(null);
  // READINESS-1 M2: raw discovery rows (staged by the confirm step) — persisted
  // on the session for the readiness exporter's observations[].
  const [discoveryResults, setDiscoveryResults] = useState<DiscoveryResult[]>([]);
  // FC-MU-3: live device-code consents of the record this session came from —
  // persisted on the session so the readiness export keeps them.
  const [liveConsents, setLiveConsents] = useState<ReadinessConsent[]>([]);
  // READINESS-1 M2: Situation-tab manifest capture.
  const [rmMode, setRmMode] = useState<ReadinessManifestCapture['mode']>('independent');
  const [rmAuthTier, setRmAuthTier] = useState<ReadinessManifestCapture['auth_tier']>('lite');
  const [rmTenantSlug, setRmTenantSlug] = useState('local-fixture');
  const [rmTenantKind, setRmTenantKind] = useState<ReadinessManifestCapture['tenant_kind']>('sim');
  const [rmOperatorName, setRmOperatorName] = useState('');
  const [rmOperatorRole, setRmOperatorRole] = useState('assessor');
  const [rmBhdName, setRmBhdName] = useState('');

  const readinessManifest = (): ReadinessManifestCapture | undefined => {
    // Only persisted when the operator identified themselves — the exporter
    // refuses to build without a manifest, and the schema requires non-empty
    // operator/tenant fields (an anonymous manifest is not provenance).
    if (rmOperatorName.trim() === '' || rmTenantSlug.trim() === '') return undefined;
    return {
      mode: rmMode,
      auth_tier: rmAuthTier,
      tenant_slug: rmTenantSlug.trim(),
      tenant_kind: rmTenantKind,
      operator_name: rmOperatorName.trim(),
      operator_role: rmOperatorRole.trim() || 'assessor',
      ...(rmMode === 'collaborative-bhd' && rmBhdName.trim() ? { bhd_name: rmBhdName.trim() } : {}),
    };
  };

  const applyArchetype = (archetypeId: string) => {
    const archetype = ARCHETYPES_FIXTURE.find((a) => a.id === archetypeId);
    if (!archetype) return;
    setSelectedArchetype(archetypeId);
    const prefill = applyArchetypeDefaults(archetype, QUESTION_GRAPH, answers);
    // Existing answers win inside the helper; the spreads below keep any state
    // that raced in since (same discipline as the harvest/discovery prefills).
    setAnswers((prev) => ({ ...prefill.answers, ...prev }));
    setProvenances((prev) => ({ ...prefill.provenances, ...prev }));
    setConfidences((prev) => ({ ...prefill.confidences, ...prev }));
  };

  const [sessionId, setSessionId] = useState<string | null>(existingSessionId ?? null);
  // C3: the party id for this session — held so post-begin edits to the three
  // profile answers persist to the party record. Set at begin and on resume.
  const [partyId, setPartyId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('profile');
  const [error, setError] = useState('');
  // Resume gate: question tabs render only after Dexie state is restored.
  const [ready, setReady] = useState(!existingSessionId);
  const resumeStarted = useRef(false);

  // Coach panel open/closed state
  const [coachOpen, setCoachOpen] = useState(false);

  const { segments, startSegment, stopSegment } = useTimingContext();

  // Apply harvest prefill from localStorage on mount (before questions are loaded).
  // This runs once; any existing answers from a resumed session take priority.
  // FC-MU (MU-06): consumed once and cleared (like the discovery handoff below)
  // so a later fresh assessment does not silently re-apply this harvest.
  useEffect(() => {
    const harvestFacts = loadHarvestFacts();
    if (harvestFacts.length === 0) return;
    clearHarvestFacts();
    const prefill = applyHarvestFacts(harvestFacts, answers);
    if (Object.keys(prefill.answers).length === 0) return;
    setAnswers((prev) => ({ ...prefill.answers, ...prev }));
    setProvenances((prev) => ({ ...prefill.provenances, ...prev }));
    setConfidences((prev) => ({ ...prefill.confidences, ...prev }));
    setHarvestSources((prev) => ({ ...prefill.sources, ...prev }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally mount-only

  // Apply discovery prefill from localStorage on mount — same seam as the
  // harvest prefill above, populated by DiscoverySubTab's "Continue to
  // Interview" action (synthesizeFactsFromDiscovery). Consumed once and
  // cleared so a later fresh assessment does not silently re-apply a stale
  // discovery run. These facts carry provenance 'auto_detected', so they are
  // exactly what the pruning call-site below is designed to admit.
  useEffect(() => {
    const discoveryFacts = loadDiscoveryFacts();
    if (discoveryFacts.length === 0) return;
    const prefill = applyDiscoveryFacts(discoveryFacts, answers);
    clearDiscoveryFacts();
    if (Object.keys(prefill.answers).length === 0) return;
    setAnswers((prev) => ({ ...prefill.answers, ...prev }));
    setProvenances((prev) => ({ ...prefill.provenances, ...prev }));
    setConfidences((prev) => ({ ...prefill.confidences, ...prev }));
    setAttestations((prev) => ({ ...prefill.attestations, ...prev }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally mount-only

  // READINESS-1 M2: consume the staged raw discovery rows (same once-only
  // discipline as the facts above).
  useEffect(() => {
    const rows = loadDiscoveryResults();
    if (rows.length === 0) return;
    clearDiscoveryResults();
    setDiscoveryResults(rows);
  }, []); // intentionally mount-only (only stable setters referenced)

  // FC-MU-3: consume the staged live consents (same once-only discipline). A
  // consented record came from a live device-code run, so the manifest capture
  // defaults to live / device-code (the operator can still edit both).
  useEffect(() => {
    const consents = loadDiscoveryConsents();
    clearDiscoveryConsents();
    if (consents.length === 0) return;
    setLiveConsents(consents);
    setRmTenantKind('live');
    setRmAuthTier('device-code');
  }, []); // intentionally mount-only (only stable setters referenced)

  // Resume: restore session facts/services + party/engagement profile fields.
  useEffect(() => {
    if (!existingSessionId || resumeStarted.current) return;
    resumeStarted.current = true;
    void (async () => {
      const session = await db.interview_sessions.get(existingSessionId);
      if (!session) {
        setReady(true);
        return;
      }
      const restoredAnswers = answersFromFacts(session.facts);
      setAnswers(restoredAnswers);
      // Restore provenances from facts
      const restoredProvs: Record<string, string> = {};
      const restoredConfs: Record<string, InterviewFact['confidence']> = {};
      const restoredAtts: Record<string, FactAttestation> = {};
      // FC-MU-3: an auto-detected fact's source survives a resume (else the
      // next write would re-save the fact without it).
      const restoredSources: Record<string, string> = {};
      for (const f of session.facts) {
        restoredProvs[f.question_id] = f.provenance;
        restoredConfs[f.question_id] = f.confidence;
        if (f.attestation) restoredAtts[f.question_id] = f.attestation;
        if (f.source) restoredSources[f.question_id] = f.source;
      }
      setProvenances(restoredProvs);
      setConfidences(restoredConfs);
      setAttestations(restoredAtts);
      setHarvestSources(restoredSources);
      // READINESS-1 M2: restore discovery rows + manifest capture on resume.
      if (session.discovery_results) setDiscoveryResults(session.discovery_results);
      if (session.live_consents) setLiveConsents(session.live_consents);
      if (session.readiness_manifest) {
        const m = session.readiness_manifest;
        setRmMode(m.mode);
        setRmAuthTier(m.auth_tier);
        setRmTenantSlug(m.tenant_slug);
        setRmTenantKind(m.tenant_kind);
        setRmOperatorName(m.operator_name);
        setRmOperatorRole(m.operator_role);
        if (m.bhd_name) setRmBhdName(m.bhd_name);
      }
      if (session.selected_stacks) setSelectedServices(session.selected_stacks);
      const party = await db.assessed_parties.get(session.party_id);
      if (party) {
        setPartyId(party.id);
        setOrgName(party.name);
        setUei(party.uei ?? '');
        setCage(party.cage ?? '');
        setOnPremOt(party.on_prem_ot);
        // C3: restore the three profile answers so they survive reload.
        if (party.employee_count) setEmployeeCount(party.employee_count);
        if (party.has_ssp) setHasSsp(party.has_ssp);
        if (party.covers_m365) setCoversM365(party.covers_m365);
        const engagement = await db.engagements.get(party.engagement_id);
        if (engagement) {
          setKind(engagement.engagement_kind);
          onEngagementReady(engagement.engagement_kind, engagement.id, party.id);
        }
      }
      startSegment('interview');
      setReady(true);
    })();
  }, [existingSessionId, onEngagementReady, startSegment]);

  // Destroy engine on unmount
  useEffect(() => {
    return () => {
      engineRef.current?.destroy();
    };
  }, []);

  // Derive the visible question set from the service inventory.
  // Facts are derived against the full QUESTION_GRAPH (not the currently
  // filtered `questions` state) so a question pruned out on one pass does
  // not lose its backing fact and reappear on the next (Finding 1 seam).
  // Only non-operator_interview facts (discovery/harvest auto_detected) are
  // passed to pruning — a question the user answered directly in THIS
  // session must stay visible so their own answer keeps showing, never
  // silently pruned out from under them. Re-runs on `provenances` too (not
  // just `selectedServices`) so a discovery/harvest prefill that lands after
  // mount (see the discovery-prefill effect above) actually re-prunes —
  // otherwise this effect's one mount-time run would compute `questions`
  // from an empty answers/provenances snapshot and never revisit it.
  //
  // 2026-07-11 (ADAPTIVE_VERIFY divergence #2 resolution): the Situation
  // tab's on_prem_ot answer now joins the same declaredStacks/stack-filter
  // dimension loadQuestionGraph already uses for applicable_stacks, rather
  // than staying inert. FCA: 'unsure' (and the unanswered '' pre-Begin
  // state) must prune NOTHING, so the 'on_prem_ot' stack tag is included
  // whenever the answer is anything other than the affirmative-exclusion
  // value 'no' — only an explicit "no on-prem/OT" narrows the stack set.
  // Re-runs on `onPremOt` too so flipping the Situation answer re-prunes.
  useEffect(() => {
    const declaredStacks = declaredStacksFor(selectedServices, onPremOt);
    // GO-2: drafts PRUNE (they ride this non-operator pruning set with their
    // real confidence) — pass/fail exclusion happens in scoring, never here.
    const allFacts = factsFromAnswers(QUESTION_GRAPH, answers, provenances, confidences, attestations);
    const pruningFacts = allFacts.filter((f) => f.provenance !== 'operator_interview');
    // G-MUSTER-PLAN-3 M1 (F8): prune the SIT plan-input residue the SAME way the
    // compile derives it — deriveSitFacts over selectedServices (NOT
    // declaredStacks; on_prem_ot is a pruning pseudo-tag, not inventory, and the
    // compile reads session.selected_stacks — the two contexts must match or
    // interview-pruning and compile disagree). Derived SIT questions are not
    // asked; the un-derived enum residue is.
    // FC-MU (MU-10) precedence: a SIT question the operator answered is never
    // pruned by its derivation — their answer wins in the compile, so it must
    // stay on screen (same rule as the operator_interview exclusion above).
    // FC-MU (MU-10): derivations also read interview/TCP answers — the same
    // scorable facts the compile passes (derivationContextFor), so interview
    // pruning and the compile agree.
    const sitDerived = deriveSitFacts({ selectedStacks: selectedServices, facts: scorableFacts(allFacts) }).facts.filter(
      (f) => answers[f.question_id] === undefined
    );
    void loadQuestionGraph(declaredStacks, [...pruningFacts, ...sitDerived]).then(setQuestions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServices, provenances, onPremOt]);

  // FC-MU-3 (P1, REQ-muster-prefill-fact-persistence): the facts a session
  // SAVES are built against the stack-filtered graph, not the visible
  // (coverage-pruned) `questions`. A question a harvest/discovery prefill hid
  // keeps its answer in session.facts and so counts toward readiness; a
  // question a service change hid still drops out. The finish gate and
  // current_question_index stay on the visible `questions`.
  const persistable = stackFilteredGraph(declaredStacksFor(selectedServices, onPremOt));

  const begun = sessionId !== null;
  const groups = groupByCluster(questions);
  const totalAnswered = answeredCount(questions, answers);
  // G-MUSTER-PLAN-3 M1 (F8): plan-input residue is OPTIONAL for finishing a
  // readiness assessment — it sharpens the generated plan but readiness never
  // requires it. The finish gate counts only readiness (non-plan_input) nodes.
  const complete = allAnswered(questions.filter((q) => !q.plan_input), answers);

  // If a service change removed the cluster the user was viewing, fall back to profile.
  useEffect(() => {
    if (activeTab !== 'profile' && !groups.some((g) => g.cluster === activeTab)) {
      setActiveTab('profile');
    }
  }, [activeTab, groups]);

  // C3: persist a profile-answer edit to the party record once the party exists
  // (after Begin Interview). Pre-begin values are written into the party at
  // begin; this keeps a post-begin change durable through reload.
  const persistProfile = (
    patch: Partial<Pick<AssessedParty, 'employee_count' | 'has_ssp' | 'covers_m365'>>
  ) => {
    if (partyId) void db.assessed_parties.update(partyId, patch);
  };

  const toggleService = (id: string) => {
    const next = (() => {
      if (id === 'none') return ['none'];
      const without = selectedServices.filter((s) => s !== 'none');
      return without.includes(id) ? without.filter((s) => s !== id) : [...without, id];
    })();
    setSelectedServices(next);
    if (sessionId) void db.interview_sessions.update(sessionId, { selected_stacks: next });
  };

  const beginInterview = async () => {
    if (!orgName.trim()) {
      setError('Organization name is required.');
      return;
    }
    if (!onPremOt) {
      setError('On-premises / OT answer is required.');
      return;
    }
    setError('');

    const engagement = await createEngagement(kind);
    const party: AssessedParty = {
      id: nanoid(),
      engagement_id: engagement.id,
      name: orgName.trim(),
      uei: uei.trim() || undefined,
      cage: cage.trim() || undefined,
      on_prem_ot: onPremOt,
      created_at: new Date().toISOString(),
      // C3: persist the three profile answers with the party (only when answered).
      ...(employeeCount ? { employee_count: employeeCount as AssessedParty['employee_count'] } : {}),
      ...(hasSsp ? { has_ssp: hasSsp } : {}),
      ...(coversM365 ? { covers_m365: coversM365 } : {}),
    };
    await db.assessed_parties.add(party);
    setPartyId(party.id);

    const newSessionId = nanoid();
    const session: InterviewSession = {
      id: newSessionId,
      party_id: party.id,
      facts: [],
      timing_segments: [],
      status: 'in_progress',
      created_at: new Date().toISOString(),
      selected_stacks: selectedServices,
      current_question_index: 0,
      // READINESS-1 M2: persist the discovery rows + manifest capture with the
      // session so the readiness exporter can build observations[] + manifest.
      ...(discoveryResults.length > 0 ? { discovery_results: discoveryResults } : {}),
      ...(readinessManifest() ? { readiness_manifest: readinessManifest() } : {}),
      ...(liveConsents.length > 0 ? { live_consents: liveConsents } : {}),
    };
    await db.interview_sessions.add(session);

    // Start adaptive engine if the user enabled the toggle
    if (adaptiveEnabled) {
      const engine = new AdaptiveEngine(newSessionId, {
        onModeChange: setAdaptiveMode,
        onPendingSyncChange: setPendingSync,
      });
      engineRef.current = engine;
      // Fetch first suggestion (fire-and-forget; failure just leaves suggestedQuestionId null)
      const remaining = questions
        .filter((q) => answers[q.id] === undefined)
        .map((q) => ({ id: q.id, text: q.text, cluster: q.cluster }));
      void engine.getNextQuestion([], selectedServices, remaining).then((res) => {
        setSuggestedQuestionId(res.question?.id ?? null);
      });
    }

    startSegment('interview');
    onEngagementReady(engagement.engagement_kind, engagement.id, party.id);
    setSessionId(newSessionId);
    if (groups.length > 0) setActiveTab(groups[0].cluster);
  };

  const recordAnswer = (questionId: string, value: string) => {
    const next = { ...answers, [questionId]: value };
    setAnswers(next);

    // Determine provenance for this answer
    const currentProvenance = provenances[questionId];
    let newProvenance: string;
    if (currentProvenance === 'auto_detected' || DRAFT_PROVENANCES.has(currentProvenance)) {
      // Editing a harvest-prefilled answer or a resolver draft — the operator
      // takes ownership (GO-2 M1: an edited field persists as CORRECTED, an
      // ordinary human answer, not an annotated draft).
      newProvenance = 'operator_interview';
    } else if (engineRef.current && adaptiveMode === 'adaptive') {
      newProvenance = 'ai_adaptive';
    } else {
      newProvenance = 'operator_interview';
    }

    setProvenances((prev) => ({ ...prev, [questionId]: newProvenance }));
    // Remove harvest source when the user edits the answer
    const nextSources = { ...harvestSources };
    delete nextSources[questionId];
    if (currentProvenance === 'auto_detected') {
      setHarvestSources((prev) => {
        const updated = { ...prev };
        delete updated[questionId];
        return updated;
      });
    }
    // GO-2: an edit invalidates any prior attestation — the human's new answer
    // stands on its own (operator_interview); the old confirmation record
    // described a different value.
    const nextAttestations = { ...attestations };
    delete nextAttestations[questionId];
    setAttestations(nextAttestations);

    if (sessionId) {
      const nextProvenances = { ...provenances, [questionId]: newProvenance };
      void db.interview_sessions.update(sessionId, {
        facts: factsFromAnswers(persistable, next, nextProvenances, confidences, nextAttestations, nextSources),
        current_question_index: answeredCount(questions, next),
      });
    }

    // Queue the answer and fetch next suggestion in adaptive mode
    if (engineRef.current) {
      void engineRef.current.queueAnswer(questionId, value).then(() => {
        const priorFacts = factsFromAnswers(
          questions,
          next,
          { ...provenances, [questionId]: newProvenance },
          confidences,
          nextAttestations
        );
        const remaining = questions
          .filter((q) => next[q.id] === undefined)
          .map((q) => ({ id: q.id, text: q.text, cluster: q.cluster }));
        return engineRef.current!.getNextQuestion(priorFacts, selectedServices, remaining);
      }).then((res) => {
        setSuggestedQuestionId(res.question?.id ?? null);
      });
    }
  };

  const finishInterview = async () => {
    if (!sessionId || !complete) return;
    // Gate: if the engine was ever active and has unsynced answers, block finish
    if (engineRef.current && !(await engineRef.current.canFinish())) {
      return;
    }
    const stoppedSegments = computeStoppedSegments(segments, 'interview');
    stopSegment('interview');
    await db.interview_sessions.update(sessionId, {
      facts: factsFromAnswers(persistable, answers, provenances, confidences, attestations, harvestSources),
      timing_segments: stoppedSegments,
      selected_stacks: selectedServices,
      status: 'complete',
      completed_at: new Date().toISOString(),
      current_question_index: totalAnswered,
      // READINESS-1 M2: manifest fields may have been filled/edited after begin.
      ...(discoveryResults.length > 0 ? { discovery_results: discoveryResults } : {}),
      ...(readinessManifest() ? { readiness_manifest: readinessManifest() } : {}),
      ...(liveConsents.length > 0 ? { live_consents: liveConsents } : {}),
    });
    onComplete(sessionId);
  };

  const handleResync = () => {
    if (engineRef.current) void engineRef.current.resync();
  };

  // Collect requirements from the currently active tab for the coach panel
  const activeCluster = groups.find((g) => g.cluster === activeTab);
  const currentRequirements = activeCluster
    ? [...new Set(activeCluster.questions.flatMap((q) => q.mapped_requirements))]
    : [];

  if (!ready) {
    return (
      <div className="page">
        <p>Loading session…</p>
      </div>
    );
  }

  const radioRow = (
    name: string,
    value: string,
    onChange: (v: string) => void,
    opts: Array<{ label: string; value: string }>,
    disabled = false
  ) => (
    <div className="radio-row">
      {opts.map((opt) => (
        <label key={opt.value} className="radio-option">
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            disabled={disabled}
          />
          {opt.label}
        </label>
      ))}
    </div>
  );

  const adaptiveEverOn = engineRef.current !== null;
  const finishGated = adaptiveEverOn && pendingSync;

  return (
    <div className="page">
      {begun && <TimerBar />}

      <div className="ces-titleblock" style={{ marginBottom: 16 }}>
        <span className="tb-title">Readiness Assessment</span>
        <span className="tb-designator">
          {begun ? `SESSION ${sessionId!.slice(0, 8).toUpperCase()}` : 'NOT STARTED'}
        </span>
      </div>

      {/* Adaptive mode status banner */}
      {begun && adaptiveEnabled && (
        <div
          className={`callout-warning`}
          style={{
            background: adaptiveMode === 'degraded'
              ? 'var(--co-risk-bg)'
              : 'var(--co-compliant-bg)',
            borderColor: adaptiveMode === 'degraded'
              ? 'var(--co-risk)'
              : 'var(--co-compliant)',
            color: adaptiveMode === 'degraded'
              ? 'var(--co-risk)'
              : 'var(--co-compliant)',
            marginBottom: 12,
          }}
          data-testid="adaptive-mode-banner"
        >
          {adaptiveMode === 'adaptive'
            ? 'AI-adaptive mode active'
            : 'AI-adaptive degraded — using static interview (offline mode)'}
        </div>
      )}

      {/* Tab rail — Profile plus one tab per cluster present in the derived graph */}
      <div className="tab-rail" role="tablist">
        <button
          className="tab"
          role="tab"
          aria-selected={activeTab === 'profile'}
          data-testid="tab-profile"
          onClick={() => setActiveTab('profile')}
        >
          Profile
        </button>
        {groups.map((g) => {
          const done = answeredCount(g.questions, answers);
          return (
            <button
              key={g.cluster}
              className="tab"
              role="tab"
              aria-selected={activeTab === g.cluster}
              data-testid={`tab-${g.cluster}`}
              disabled={!begun}
              title={begun ? undefined : 'Begin the interview to unlock question tabs'}
              onClick={() => setActiveTab(g.cluster)}
            >
              {g.label}
              <span className={`tab-count${done === g.questions.length ? ' complete' : ''}`}>
                {done}/{g.questions.length}
              </span>
            </button>
          );
        })}
      </div>

      {activeTab === 'profile' && (
        <section>
          <div className="field">
            <span className="field-label">Assessment Type</span>
            {radioRow(
              'engagement_kind',
              kind,
              (v) => setKind(v as EngagementKind),
              [
                { label: 'Single contractor assessing own readiness', value: 'individual_contractor' },
                { label: 'Prime assessing subcontractor tier', value: 'prime_and_subs' },
              ],
              begun
            )}
          </div>

          <div className="field">
            <label className="field-label">
              Organization Name <span className="req">*</span>
              <input
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Acme Defense LLC"
                disabled={begun}
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 16 }}>
            <div className="field" style={{ flex: 1 }}>
              <label className="field-label">
                UEI
                <input
                  type="text"
                  value={uei}
                  onChange={(e) => setUei(e.target.value)}
                  placeholder="12-char UEI"
                  disabled={begun}
                />
              </label>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label className="field-label">
                CAGE
                <input
                  type="text"
                  value={cage}
                  onChange={(e) => setCage(e.target.value)}
                  placeholder="5-char CAGE"
                  disabled={begun}
                />
              </label>
            </div>
          </div>

          <div className="field">
            <span className="field-label">Does this assessment cover M365/cloud services?</span>
            {radioRow('covers_m365', coversM365, (v) => {
              setCoversM365(v as 'yes' | 'no');
              persistProfile({ covers_m365: v as 'yes' | 'no' });
            }, [
              { label: 'Yes', value: 'yes' },
              { label: 'No', value: 'no' },
            ])}
          </div>

          <div className="field">
            <span className="field-label">
              Does CUI touch on-premises servers or OT/manufacturing systems?{' '}
              <span className="req">*</span>
            </span>
            {radioRow(
              'on_prem_ot',
              onPremOt,
              (v) => setOnPremOt(v as 'yes' | 'no' | 'unsure'),
              [
                { label: 'Yes', value: 'yes' },
                { label: 'No', value: 'no' },
                { label: 'Unsure', value: 'unsure' },
              ],
              begun
            )}
          </div>

          <div className="field">
            <label className="field-label">
              Approximate employee count
              <select
                value={employeeCount}
                onChange={(e) => {
                  setEmployeeCount(e.target.value);
                  persistProfile({
                    employee_count: (e.target.value || undefined) as AssessedParty['employee_count'],
                  });
                }}
              >
                <option value="">Select…</option>
                <option value="<50">Fewer than 50</option>
                <option value="50-250">50 – 250</option>
                <option value="250+">More than 250</option>
              </select>
            </label>
          </div>

          <div className="field">
            <span className="field-label">Does the organization have a System Security Plan (SSP)?</span>
            {radioRow('has_ssp', hasSsp, (v) => {
              setHasSsp(v as 'yes' | 'no' | 'unsure');
              persistProfile({ has_ssp: v as 'yes' | 'no' | 'unsure' });
            }, [
              { label: 'Yes', value: 'yes' },
              { label: 'No', value: 'no' },
              { label: 'Unsure', value: 'unsure' },
            ])}
          </div>

          <div className="field">
            <span className="field-label">
              Service Inventory — which services does this organization use?
            </span>
            <p className="eyebrow" style={{ margin: '4px 0 6px' }}>
              Selections derive the question tabs above
            </p>
            <div className="option-stack">
              {SERVICE_OPTIONS.map(({ id, label }) => (
                <label key={id} className="check-option">
                  <input
                    type="checkbox"
                    checked={selectedServices.includes(id)}
                    onChange={() => toggleService(id)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {/* READINESS-1 M2: readiness session manifest capture. The exporter
              refuses to build without it; "the auth tier achieved is itself
              provenance". Anonymous manifests are not provenance: operator
              name gates persistence. */}
          <div className="field" data-testid="readiness-manifest-capture">
            <span className="field-label">Readiness session manifest</span>
            <p className="eyebrow" style={{ margin: '4px 0 6px' }}>
              Recorded into the readiness-result export — session kind, auth tier, operator
            </p>
            <div style={{ display: 'grid', gap: 8 }}>
              <label>
                Session kind:{' '}
                <select
                  data-testid="rm-mode"
                  value={rmMode}
                  onChange={(e) => setRmMode(e.target.value as ReadinessManifestCapture['mode'])}
                >
                  <option value="self-hosted">Self-hosted</option>
                  <option value="independent">Independent</option>
                  <option value="collaborative-bhd">Collaborative (with BHD)</option>
                </select>
              </label>
              {rmMode === 'collaborative-bhd' && (
                <label>
                  BHD presence (name):{' '}
                  <input
                    data-testid="rm-bhd-name"
                    type="text"
                    value={rmBhdName}
                    onChange={(e) => setRmBhdName(e.target.value)}
                  />
                </label>
              )}
              <label>
                Auth tier achieved:{' '}
                <select
                  data-testid="rm-auth-tier"
                  value={rmAuthTier}
                  onChange={(e) =>
                    setRmAuthTier(e.target.value as ReadinessManifestCapture['auth_tier'])
                  }
                >
                  <option value="lite">Lite (no tenant access)</option>
                  <option value="script-upload">Script upload (admin-run results file)</option>
                  <option value="device-code">Device code sign-in</option>
                  <option value="cert-app-only">Certificate app-only</option>
                </select>
              </label>
              <label>
                Tenant:{' '}
                <input
                  data-testid="rm-tenant-slug"
                  type="text"
                  value={rmTenantSlug}
                  onChange={(e) => setRmTenantSlug(e.target.value)}
                  placeholder="tenant slug"
                  style={{ width: 160 }}
                />{' '}
                <select
                  data-testid="rm-tenant-kind"
                  value={rmTenantKind}
                  onChange={(e) =>
                    setRmTenantKind(e.target.value as ReadinessManifestCapture['tenant_kind'])
                  }
                >
                  <option value="sim">sim</option>
                  <option value="live">live</option>
                </select>
              </label>
              <label>
                Operator:{' '}
                <input
                  data-testid="rm-operator-name"
                  type="text"
                  value={rmOperatorName}
                  onChange={(e) => setRmOperatorName(e.target.value)}
                  placeholder="name (required for readiness export)"
                  style={{ width: 200 }}
                />{' '}
                <input
                  data-testid="rm-operator-role"
                  type="text"
                  value={rmOperatorRole}
                  onChange={(e) => setRmOperatorRole(e.target.value)}
                  placeholder="role"
                  style={{ width: 120 }}
                />
              </label>
            </div>
          </div>

          {/* GO-2 M2 (rung 3 mechanism): archetype selection — "which of these
              looks most like you?" Prefills archetype-default PRIORS over
              unanswered questions only; every prefill is an unconfirmed draft
              (prunes, never scores) and individually overridable. */}
          <div className="field">
            <span className="field-label">Which of these looks most like your organization? (optional)</span>
            <p className="eyebrow" style={{ margin: '4px 0 6px' }}>
              Prefills likely defaults as unconfirmed drafts — every one is overridable and
              none counts toward your score until confirmed
            </p>
            <div className="option-stack">
              {ARCHETYPES_FIXTURE.map((a) => (
                <label key={a.id} className="check-option" title={a.description}>
                  <input
                    type="radio"
                    name="archetype"
                    checked={selectedArchetype === a.id}
                    data-testid={`archetype-${a.id}`}
                    onChange={() => applyArchetype(a.id)}
                  />
                  {a.label}
                </label>
              ))}
            </div>
          </div>

          {/* AI-adaptive toggle — default OFF; does not affect e2e (static path) */}
          <div className="field">
            <label className="check-option" style={{ fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={adaptiveEnabled}
                onChange={(e) => setAdaptiveEnabled(e.target.checked)}
                disabled={begun}
                data-testid="adaptive-toggle"
              />
              AI-adaptive interview (requires connection)
            </label>
            <p style={{ fontSize: 12, color: 'var(--co-text-muted)', margin: '4px 0 0 24px' }}>
              When enabled, question order is guided by AI based on prior answers.
              Falls back to static interview on connection loss. Default OFF.
            </p>
          </div>

          {error && <p className="form-error">{error}</p>}

          {!begun && (
            <button
              className="btn btn-primary"
              data-testid="begin-interview"
              onClick={() => void beginInterview()}
            >
              Begin Interview →
            </button>
          )}
        </section>
      )}

      {activeTab !== 'profile' &&
        groups
          .filter((g) => g.cluster === activeTab)
          .map((g) => (
            <section key={g.cluster} data-testid={`cluster-section-${g.cluster}`}>
              {g.questions.map((q) => {
                const isSuggested = suggestedQuestionId === q.id;
                const prov = provenances[q.id];
                const conf = confidences[q.id];
                const harvestSource = harvestSources[q.id];
                const hasAnswer = answers[q.id] !== undefined;

                return (
                  <div
                    key={q.id}
                    className={`question-card${isSuggested ? ' question-card--suggested' : ''}`}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                      <p className="q-text" style={{ margin: 0, flex: 1 }}>{q.text}</p>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0, flexWrap: 'wrap' }}>
                        {isSuggested && (
                          <span className="badge badge-review" title="AI-suggested next question">
                            NEXT
                          </span>
                        )}
                        {hasAnswer && prov && prov !== 'operator_interview' && (
                          <span
                            className={provenanceBadgeClass(prov)}
                            title={`Provenance: ${prov}`}
                          >
                            {provenanceLabel(prov)}
                          </span>
                        )}
                        {hasAnswer && prov && DRAFT_PROVENANCES.has(prov) && (
                          attestations[q.id] ? (
                            <span
                              className="badge badge-compliant"
                              title={attestationRecord(attestations[q.id])}
                              data-testid={`attested-badge-${q.id}`}
                            >
                              CONFIRMED
                            </span>
                          ) : (
                            <span
                              className="badge badge-risk"
                              title="Drafted by a resolver — does not count toward any score until a named person confirms it"
                              data-testid={`draft-badge-${q.id}`}
                            >
                              UNCONFIRMED DRAFT
                            </span>
                          )
                        )}
                        {hasAnswer && conf && conf !== 'high' && (
                          <span
                            className={confidenceBadgeClass(conf)}
                            title={`Confidence: ${conf}`}
                          >
                            {conf.toUpperCase()}
                          </span>
                        )}
                        {harvestSource && (
                          <span
                            className="badge badge-compliant"
                            title={`Auto-detected from ${harvestSource}`}
                            data-testid={`harvest-badge-${q.id}`}
                          >
                            AUTO-DETECTED
                          </span>
                        )}
                      </div>
                    </div>
                    {q.input === 'file' ? (
                      <TouFileField
                        id={q.id}
                        sessionId={sessionId}
                        value={answers[q.id] ?? ''}
                        onCommit={(v) => recordAnswer(q.id, v)}
                      />
                    ) : q.input === 'secret' ? (
                      <InitialPasswordField
                        id={q.id}
                        value={answers[q.id] ?? ''}
                        onCommit={(v) => recordAnswer(q.id, v)}
                      />
                    ) : q.input ? (
                      <PlanInputField
                        id={q.id}
                        kind={q.input}
                        value={answers[q.id] ?? ''}
                        onCommit={(v) => recordAnswer(q.id, v)}
                      />
                    ) : (
                      radioRow(q.id, answers[q.id] ?? '', (v) => recordAnswer(q.id, v), q.options)
                    )}
                    <div className="q-reqs">{q.mapped_requirements.join(' · ')}</div>
                  </div>
                );
              })}
            </section>
          ))}

      {begun && (
        <div className="action-bar">
          <span className="progress-note" data-testid="progress-note">
            {totalAnswered} of {questions.length} answered
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {finishGated && (
              <span
                className="badge badge-risk"
                style={{ fontSize: 12 }}
                data-testid="pending-sync-note"
              >
                Pending advisor review sync
              </span>
            )}

            {pendingSync && engineRef.current && (
              <button
                className="btn"
                data-testid="resync-btn"
                onClick={handleResync}
              >
                Resync
              </button>
            )}

            <button
              className="btn"
              data-testid="coach-btn"
              onClick={() => setCoachOpen((o) => !o)}
            >
              Coach
            </button>

            <button
              className="btn btn-primary"
              data-testid="finish-interview"
              disabled={!complete || finishGated}
              onClick={() => void finishInterview()}
            >
              Finish &amp; Score →
            </button>
          </div>
        </div>
      )}

      <CoachPanel
        isOpen={coachOpen}
        onClose={() => setCoachOpen(false)}
        sessionId={sessionId ?? ''}
        currentRequirements={currentRequirements}
      />
    </div>
  );
}

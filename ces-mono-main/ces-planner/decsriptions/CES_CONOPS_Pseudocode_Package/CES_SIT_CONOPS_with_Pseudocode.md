# CES Strategic Intent Tool (SIT) — CONOPS + Algorithmic Pseudocode

**Generated:** 2026-02-02T05:49:39Z

## 0. Glossary (operational)
- **SIT**: Strategic Intent Tool
- **SI Baseline**: Strategic Intent Baseline artifact (SIT primary output)
- **RR Q-Set**: Scenario-Specific RR Question Set artifact (SIT derived output)
- **SI QB**: Primed SI Question Bank (governed questions + gates + mappings)

---

## 1. Purpose and Role (CONOPS)
SIT qualifies the opportunity and produces the immutable **target/constraints contract** for downstream tools.
It does **not** perform readiness validation or evidence sufficiency assessment.

---

## 2. Inputs (CONOPS)
- `SI_QB` (Primed SI Question Bank): governed questions, gate logic, mappings
- `operator_session`: identity, org context, engagement metadata
- `client_responses`: interactive answers (may be incomplete)
- `domain_context`: read-only reference vocab (levels, scoping categories, etc.)

---

## 3. Outputs (CONOPS)
1. **Strategic Intent Baseline** (authoritative contract)
2. **Scenario-Specific RR Question Set** (tailored interrogatory for RRT)

---

## 4. Processing Overview (CONOPS)
SIT runs as a deterministic interview engine:
1) Select next question(s) from SI QB  
2) Capture answers with provenance  
3) Normalize into canonical SI fields  
4) Evaluate gates; if blocking, halt or request waiver  
5) When completion criteria satisfied, produce SI Baseline  
6) Derive RR Q-Set from SI Baseline + RR QB + domain refs  

---

# 5. Algorithmic Pseudocode (Implementation Blueprint)

> **Style note:** Comments beginning with `// CONOPS:` map each step back to the CONOPS section above.

## 5.1 Data Structures

```pseudo
// CONOPS: §2 Inputs
type ArtifactRef = {
  schema_id: string,
  artifact_id: string,
  version: string,
  hash_sha256: string
}

type AnswerRecord = {
  question_id: string,
  answer_type: string,
  raw_answer: any,
  captured_at: datetime,
  provenance_class: enum{client_assertion, operator_observation, operator_inference, assumption, system_observation},
  notes?: string
}

type GateResult = {
  gate_id: string,
  status: enum{pass, fail, waived},
  message?: string,
  waiver?: { approved_by: string, reason: string, approved_on?: datetime }
}

type StrategicIntentBaseline = {
  ces: {
    artifact: "si_baseline",
    version: string,
    generated_on: datetime,
    source_question_bank_ref: ArtifactRef,
    scenario_tags: string[],
    target: object,
    scope: object,
    operating_assumptions: object,
    constraints: object,
    risk_acceptance: object,
    dependencies: object,
    governance: object,
    notes?: string
  }
}

type ScenarioSpecificRRQuestionSet = {
  ces: {
    artifact: "rr_question_set",
    version: string,
    generated_on: datetime,
    inputs: {
      si_baseline_ref: ArtifactRef,
      rrt_bank_ref: ArtifactRef,
      cmmc_requirements_ref: ArtifactRef,
      assessor_evidence_matrix_ref: ArtifactRef,
      assessor_approach_ref: ArtifactRef,
      vendor_capabilities_ref?: ArtifactRef
    },
    scenario: object,
    selection: object,
    questions: Question[],
    coverage: object
  }
}
```

## 5.2 Core SIT Loop

```pseudo
function run_SIT(SI_QB, operator_session, initial_context) -> (StrategicIntentBaseline, ScenarioSpecificRRQuestionSet):
  // CONOPS: §4 Processing Overview
  state = init_state(operator_session, initial_context)
  answers = []
  gate_results = []

  while true:
    // CONOPS: §4.1 Select next question(s)
    next_q = select_next_question(SI_QB, state, answers)

    if next_q == NONE:
      break  // no more questions or completion criteria satisfied

    // CONOPS: §4.2 Capture answers
    ans = ask_and_capture(next_q, operator_session)
    answers.append(ans)

    // CONOPS: §4.3 Normalize into canonical SI fields
    state = apply_answer_mapping(SI_QB, state, ans)

    // CONOPS: §4.4 Evaluate gates
    gate_results = evaluate_gates(SI_QB.gates, state, answers)

    if exists_blocking_failure(gate_results):
      // CONOPS: §4.4 Halt or waiver
      if can_request_waiver(SI_QB.gates, gate_results):
        waiver = request_waiver_from_operator(operator_session, gate_results)
        gate_results = apply_waiver(gate_results, waiver)
        if exists_blocking_failure(gate_results):
          raise SITBlocked("Unwaived blocking gate failure", gate_results)
      else:
        raise SITBlocked("Blocking gate failure", gate_results)

  // CONOPS: §4.5 Produce SI Baseline
  si_baseline = emit_SI_baseline(SI_QB, state, answers, gate_results)

  // CONOPS: §4.6 Derive RR Q-Set
  rr_qset = derive_RR_question_set(si_baseline, operator_session)

  return (si_baseline, rr_qset)
```

## 5.3 Question Selection

```pseudo
function select_next_question(SI_QB, state, answers) -> Question?:
  // CONOPS: §4.1 Select next question(s)
  // Strategy:
  // 1) Ask unanswered required questions
  // 2) Ask questions needed to satisfy gates
  // 3) Ask optional questions that reduce downstream uncertainty

  required = SI_QB.question_bank.questions where q.required == true
  for q in required:
    if not answered(q.question_id, answers) and is_applicable(q, state):
      return q

  gate_needed = questions_required_by_unsatisfied_gates(SI_QB.gates, state, answers)
  if gate_needed not empty:
    return highest_priority(gate_needed)

  optional = SI_QB.question_bank.questions where q.required != true
  candidate = pick_best_information_gain(optional, state, answers)
  return candidate  // may be NONE if completion satisfied
```

## 5.4 Mapping Answers to SI Baseline Fields

```pseudo
function apply_answer_mapping(SI_QB, state, ans) -> state:
  // CONOPS: §4.3 Normalize into canonical SI fields
  mappings = SI_QB.mappings where mapping.question_id == ans.question_id

  for m in mappings:
    value = normalize(ans.raw_answer, m.normalization_rules, m.target_type)
    state.si_fields[m.target_path] = value

  // CONOPS: Constraint binding semantics
  if SI_QB.binding_strength[ans.question_id] == "hard":
    state.constraints.hard.addAll(m.target_paths)
  else if SI_QB.binding_strength[ans.question_id] == "soft":
    state.constraints.soft.addAll(m.target_paths)

  return state
```

## 5.5 Gate Evaluation

```pseudo
function evaluate_gates(gates, state, answers) -> GateResult[]:
  // CONOPS: §4.4 Evaluate gates
  results = []
  for g in gates.checks:
    ok, msg = eval_expression(g.expression, state, answers)
    if ok:
      results.append({gate_id: g.id, status: "pass"})
    else:
      results.append({gate_id: g.id, status: "fail", message: msg})
  return results
```

## 5.6 Emit SI Baseline

```pseudo
function emit_SI_baseline(SI_QB, state, answers, gate_results) -> StrategicIntentBaseline:
  // CONOPS: §3 Outputs / §4.5 Produce SI Baseline
  ensure_completion(SI_QB.sit_completion, state, answers, gate_results)

  return StrategicIntentBaseline{
    ces: {
      artifact: "si_baseline",
      version: SI_QB.target_output_version,
      generated_on: now(),
      source_question_bank_ref: SI_QB.ref,
      scenario_tags: derive_scenario_tags(state),
      target: state.si_fields.target,
      scope: state.si_fields.scope,
      operating_assumptions: state.si_fields.operating_assumptions,
      constraints: state.si_fields.constraints,
      risk_acceptance: state.si_fields.risk_acceptance,
      dependencies: state.si_fields.dependencies,
      governance: state.si_fields.governance,
      notes: state.si_fields.notes
    }
  }
```

## 5.7 Derive Scenario-Specific RR Question Set

```pseudo
function derive_RR_question_set(si_baseline, operator_session) -> ScenarioSpecificRRQuestionSet:
  // CONOPS: §3 Outputs / §4.6 Derive RR Q-Set
  rr_bank = load_primed_RR_bank(operator_session)
  cmmc_store = load_cmmc_requirements(operator_session)
  assessor_kb = load_assessor_kb(operator_session)
  evidence_matrix = load_assessor_evidence_matrix(operator_session)
  vendor_caps = load_vendor_caps(operator_session, si_baseline)

  selected_activities = select_rr_activities(rr_bank, si_baseline, cmmc_store)
  questions = []
  coverage = init_coverage(cmmc_store)

  for act in selected_activities:
    for q in rr_bank.activity[act].questions:
      q2 = specialize_question(q, si_baseline)
      q2.mapped_requirements = map_to_requirements(q2, cmmc_store, si_baseline)
      q2.assessor_methods = infer_methods(q2, assessor_kb, evidence_matrix)
      q2.expected_evidence = infer_expected_evidence(q2, evidence_matrix)
      questions.append(q2)
      coverage = update_coverage(coverage, q2.mapped_requirements)

  excluded = compute_excluded(rr_bank, selected_activities, si_baseline)

  return ScenarioSpecificRRQuestionSet{
    ces: {
      artifact: "rr_question_set",
      version: rr_bank.output_version,
      generated_on: now(),
      inputs: {
        si_baseline_ref: ref(si_baseline),
        rrt_bank_ref: rr_bank.ref,
        cmmc_requirements_ref: cmmc_store.ref,
        assessor_evidence_matrix_ref: evidence_matrix.ref,
        assessor_approach_ref: assessor_kb.ref,
        vendor_capabilities_ref: vendor_caps.ref
      },
      scenario: build_scenario(si_baseline),
      selection: { selected_activity_ids: selected_activities, excluded_activity_ids: excluded },
      questions: questions,
      coverage: coverage_report(coverage)
    }
  }
```

---

## 6. Determinism and Safety Notes
- SIT must be replayable: same SI QB + same answers → same baseline.
- Waivers are explicit and auditable.
- SIT does not invent requirements, methods, or evidence expectations.

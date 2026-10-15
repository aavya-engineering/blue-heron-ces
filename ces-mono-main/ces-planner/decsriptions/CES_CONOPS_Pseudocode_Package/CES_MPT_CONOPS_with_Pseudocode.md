# CES Mission Planning Tool (MPT) — CONOPS + Algorithmic Pseudocode

**Generated:** 2026-02-02T05:49:39Z

## 1. Purpose and Role (CONOPS)
MPT is the compiler stage that converts intent + readiness into **four deliverables**:
1) Human-readable mission plan,
2) Executable plan for Stamper,
3) Proposal (cost + SOW),
4) Tenant Manifest (definition of “RIGHT” + Evidence Ops + drift).

---

## 2. Inputs (CONOPS)
- `SI_Baseline` (authoritative target and constraints)
- `Readiness_Posture` (current state, gaps, and gate results)
- `Authoritative_Sources` (normative control intent)
- `Vendor_Capability_Packages` (stack-specific implementation methods)
- `Assessor_Knowledge` (evidence sufficiency + methods)

Preferred bindings:
- `inputs.si_baseline_ref` and `inputs.readiness_posture_ref` (artifact refs)

---

## 3. Outputs (CONOPS)
- Manual Mission Plan
- Executable Mission Plan
- Proposal (Cost + SOW)
- Tenant Manifest (canonical)

---

# 4. Algorithmic Pseudocode (Implementation Blueprint)

> Comments beginning with `// CONOPS:` map each step back to the CONOPS sections above.

## 4.1 Main MPT Orchestration

```pseudo
function run_MPT(SI_Baseline, Readiness_Posture, refs, vendor_caps, assessor_kb) -> (ManualPlan, ExecPlan, Proposal, TenantManifest):
  // CONOPS: §2 Inputs
  assert gates_ok(Readiness_Posture.rrt_execution.mpt_readiness_gate_results)

  // CONOPS: determine plan mode
  plan_mode = determine_plan_mode(SI_Baseline, Readiness_Posture)

  // CONOPS: compile gaps
  gap_set = compile_gap_set(SI_Baseline, Readiness_Posture, refs.cmmc_store, refs.evidence_matrix)

  // CONOPS: build control implementation tasks (stack-aware)
  task_catalog = compile_tasks(gap_set, vendor_caps, assessor_kb, SI_Baseline)

  // CONOPS: produce 1) manual plan
  manual_plan = emit_manual_plan(SI_Baseline, Readiness_Posture, plan_mode, task_catalog, refs)

  // CONOPS: produce 2) executable plan (stamper input)
  exec_plan = emit_executable_plan(SI_Baseline, Readiness_Posture, plan_mode, task_catalog, refs)

  // CONOPS: produce 3) proposal (mapped to plan)
  proposal = emit_proposal(SI_Baseline, plan_mode, manual_plan, exec_plan, task_catalog)

  // CONOPS: produce 4) tenant manifest (definition of RIGHT)
  tenant_manifest = emit_tenant_manifest(SI_Baseline, plan_mode, task_catalog, assessor_kb, refs)

  // CONOPS: cross-artifact validation
  validate_alignment(manual_plan, exec_plan, proposal, tenant_manifest)

  return (manual_plan, exec_plan, proposal, tenant_manifest)
```

## 4.2 Gap Compilation

```pseudo
function compile_gap_set(SI_Baseline, Readiness_Posture, cmmc_store, evidence_matrix) -> GapSet:
  // CONOPS: §1 compiler behavior
  gaps = []

  for rr in Readiness_Posture.requirement_results:
    if rr.status in {NOT_MET, PARTIAL, UNKNOWN}:
      req = cmmc_store.get(rr.requirement_id)
      expected = evidence_matrix.get_expected(req.requirement_id)

      gaps.append({
        requirement_id: req.requirement_id,
        severity: compute_severity(req, SI_Baseline),
        gap_reason: rr.notes,
        missing_evidence_archetypes: expected.archetypes - rr.evidence_archetypes_satisfied,
        methods_needed: expected.minimum_methods - rr.assessor_methods_satisfied
      })

  gaps = apply_scope_constraints(gaps, SI_Baseline.scope, SI_Baseline.constraints)
  return {gaps: gaps}
```

## 4.3 Compile Tasks (Vendor + Assessor Aware)

```pseudo
function compile_tasks(gap_set, vendor_caps, assessor_kb, SI_Baseline) -> TaskCatalog:
  // CONOPS: §2 vendor caps + assessor knowledge
  tasks = []
  for gap in gap_set.gaps:
    impl = select_vendor_implementation(vendor_caps, gap.requirement_id, SI_Baseline)
    verification = derive_verification(assessor_kb, gap.requirement_id, impl)
    evidence = derive_expected_artifacts(assessor_kb, gap.requirement_id, impl)

    tasks.append({
      task_id: stable_id(gap.requirement_id, impl),
      requirement_id: gap.requirement_id,
      impl_path: impl,
      what_to_do: impl.steps,
      how_to_verify: verification.steps,
      expected_artifacts: evidence.artifacts,
      dependencies: impl.dependencies,
      priority: prioritize(gap, SI_Baseline),
      owner_role: suggest_owner(impl),
      effort_estimate: estimate_effort(impl, SI_Baseline)
    })
  return {tasks: tasks}
```

## 4.4 Emit Manual Plan

```pseudo
function emit_manual_plan(SI_Baseline, Readiness_Posture, plan_mode, task_catalog, refs) -> ManualPlan:
  // CONOPS: §3 output 1
  milestones = derive_milestones(task_catalog, SI_Baseline)
  steps = []

  for t in order_by_dependencies(task_catalog.tasks):
    steps.append({
      id: "step_" + t.task_id,
      title: t.impl_path.title,
      task_type: classify_task(t),
      priority: t.priority,
      control_coverage: map_control_coverage(t, refs.tech_map),
      what_to_do: t.what_to_do,
      how_to_verify: t.how_to_verify,
      vendor_help_refs: t.impl_path.vendor_refs,
      expected_artifacts: t.expected_artifacts,
      manual_completion_criteria: derive_completion_criteria(t),
      dependencies: ["step_" + d for d in t.dependencies]
    })

  return build_manual_schema_object(SI_Baseline, Readiness_Posture, plan_mode, milestones, steps, refs)
```

## 4.5 Emit Executable Plan (Stamper)

```pseudo
function emit_executable_plan(SI_Baseline, Readiness_Posture, plan_mode, task_catalog, refs) -> ExecPlan:
  // CONOPS: §3 output 2
  exec_tasks = []
  for t in order_by_dependencies(task_catalog.tasks):
    engine = choose_action_engine(t.impl_path)
    exec_tasks.append({
      id: "task_" + t.task_id,
      title: t.impl_path.title,
      engine: engine,
      args: compile_engine_args(t, SI_Baseline),
      idempotency_key: compute_idempotency(t, SI_Baseline),
      rollback: derive_rollback(t, SI_Baseline),
      dependencies: ["task_" + d for d in t.dependencies],
      prechecks: compile_prechecks(t, SI_Baseline),
      postchecks: compile_postchecks(t, SI_Baseline),
      controls: [t.requirement_id],
      evidence_emit: compile_evidence_emit(t.expected_artifacts)
    })
  return build_exec_schema_object(SI_Baseline, Readiness_Posture, plan_mode, exec_tasks, refs)
```

## 4.6 Emit Proposal (Cost + SOW)

```pseudo
function emit_proposal(SI_Baseline, plan_mode, manual_plan, exec_plan, task_catalog) -> Proposal:
  // CONOPS: §3 output 3
  price_lines = []
  for ms in manual_plan.outputs.human_readable_mission_plan.milestones:
    related_steps = steps_for_milestone(ms, manual_plan)
    related_controls = unique(flatten([s.control_coverage.control_id for s in related_steps]))
    est = estimate_price(ms, related_steps, task_catalog)

    price_lines.append({
      line_id: "line_" + ms.milestone_id,
      description: ms.name,
      amount: est.amount,
      mapping: {milestones: [ms.milestone_id], step_ids: [s.id for s in related_steps], control_ids: related_controls}
    })

  sow = build_sow(SI_Baseline, plan_mode, manual_plan, assumptions_from(SI_Baseline), customer_dependencies_from(SI_Baseline))
  return build_proposal_object(price_lines, sow, SI_Baseline)
```

## 4.7 Emit Tenant Manifest (Definition of RIGHT)

```pseudo
function emit_tenant_manifest(SI_Baseline, plan_mode, task_catalog, assessor_kb, refs) -> TenantManifest:
  // CONOPS: §3 output 4
  normative_controls = []
  config_intents = []
  evidence_monitors = []
  drift_policies = []

  for t in task_catalog.tasks:
    normative_controls.append(derive_normative_control(t, SI_Baseline, assessor_kb))
    config_intents.extend(derive_config_intents(t, SI_Baseline, refs))
    evidence_monitors.extend(derive_evidence_monitors(t.expected_artifacts, SI_Baseline))
    drift_policies.extend(derive_drift_policies(t, SI_Baseline, assessor_kb))

  return build_tenant_manifest_object(SI_Baseline, normative_controls, config_intents, evidence_monitors, drift_policies)
```

## 4.8 Cross-Artifact Validation (Correctness Harness)

```pseudo
function validate_alignment(manual_plan, exec_plan, proposal, tenant_manifest):
  // CONOPS: §1 no ambiguity between plan/execution/commercial/runtime
  assert all proposal.price_lines.mapping.step_ids exist in manual_plan.steps
  assert all exec_plan.tasks.controls covered by manual_plan.control_coverage
  assert all expected_artifacts in manual_plan appear in tenant_manifest.evidence_monitors
  assert all normative_controls reference controls present in plan control_coverage
  return true
```

---

## 5. Implementation Notes
- Fail closed when gates fail.
- Use vendor capability packages as the only source of “how.”
- Use assessor knowledge to drive evidence design.
- Treat tenant manifest as the runtime “contract of RIGHT.”

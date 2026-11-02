# Assessor KB — authoring rules for family batches

This folder holds the source for two generated references (KB-1, the Assessor Approach KB and
Evidence Matrix; see the gap-closure plan §8):

- `../assessor-approach.reference.json` — one entry per practice (110)
- `../assessor-evidence-matrix.reference.json` — one entry per 800-171A objective (320)

Each family has its own file (`AC.json`, `AT.json`, ... `SI.json`), so batches can be authored in
parallel without touching the same file. **Edit only your family's file.** `AT.json` is the
finished exemplar; copy its depth and tone.

## Workflow

1. `node scripts/kb-skeleton.mjs` — (re)generates the structure. Safe to run any time: it rewrites
   ids, titles, determination statements and methods from the references, and keeps every
   authored field already in the file.
2. Fill the authored fields in your family file (below).
3. `node scripts/kb-build.mjs` — regenerates the two references. Never hand-edit them.
4. `npx vitest run src/data/assessor-kb.lint.test.ts` — structure checks (must pass).
   `KB_LINT_COMPLETE=<FAMILY>` (for example `KB_LINT_COMPLETE=AC`) also fails on any empty
   authored field in that family; `KB_LINT_COMPLETE=1` checks all families.

## Schema

```
{ family, family_name,
  practices: [
    { id, title,                                   <- generated, do not edit
      approach: {                                  <- AUTHORED
        what_assessor_does: "<paragraph>",
        common_failure_modes: ["<one failure per item>", ...] },
      objectives: [
        { id, determination, methods,              <- generated, do not edit
          evidence: [                              <- AUTHORED, one or more rows
            { artifact_type, ces_source, notes } ] } ] } ] }
```

- `ces_source` is exactly one of: `stack_signal`, `ao_row`, `stamper_evidence`, `ec_upload`,
  `eo_store`, `interview`.
- Every row has exactly these three keys. Do not add keys; propose schema changes instead.
- The source references carry no "assessment objects" list, so there is no `objects` field.
  `determination` is the 800-171A determination statement for the objective.

## Rules

1. **Authority.** NIST SP 800-171A objectives as carried in
   `../assessment-objectives.reference.json` and the practices in
   `../cmmc-l2-controls.reference.json`. Write to the determination statement of each objective.
2. **Never copy Planner Store text.** The Requirements Store
   (`ces-muster/public/knowledge/domain CES CMMC Fundamental Requirements Store.yaml`) is
   untrusted: its titles and text are shifted and its `evidence_minimum` is placeholder. The lint
   fails if any authored sentence of 25 characters or more appears in it. Do not use the other
   Muster `domain Assessor ...` YAML files as a source either.
3. **Plain assessor language.** Say what the assessor reads, asks and tries, and what makes them
   mark the objective not met. Short sentences, no marketing, no claims about scores.
4. **Each evidence row names a real CES source.** In `notes`, cite the concrete thing: the
   control-signal-registry key and its Graph endpoints or evaluator, the AdminOps command id
   (check `cmmcPractices` in `ces-ao/src/registry/ao-commands.registry.json` — only cite a
   command registered against that practice), the EO store and record id, the Stamper gate
   document path, or what the contractor uploads through the Evidence Collector. If no tenant
   signal covers a practice (registry evaluator `manualGateEvaluator`), say so; do not invent one.
5. **Cover the methods.** Across an objective's rows, give the assessor something for each method
   listed in `methods` (examine: a document or record; interview: who and what to ask; test: what
   to try or reconcile).
6. **Keep to the schema.** Do not edit generated fields; rerun the skeleton instead.

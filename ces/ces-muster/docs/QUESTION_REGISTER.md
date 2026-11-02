# Question register (MG-28)

The question register lists every question Muster asks, the output field each answer feeds, the sources
Muster tries before asking, and why the answer cannot be derived. It is how "fewer questions" is measured and
reviewed under the parity rule: **discover, then infer, then default, and ask only as a last resort.**

## Files

| File | Role |
|---|---|
| `src/features/interview/questionRegister.json` | The register. A generated file, committed to the repo. |
| `src/features/interview/questionRegister.ts` | Builds the rows from `QUESTION_GRAPH` (readiness, boundary, SI, TCP and provisioning nodes), the SI derivation table, the archetype priors and the harvest prefill. |
| `src/features/interview/questionRegisterJustifications.ts` | The hand-authored part: why each node can't be derived, or which backlog item will derive it, plus the Profile-tab questions that are not graph nodes. |
| `scripts/generate-question-register.ts` | `npm run register:generate` writes the JSON. `npm run register:check` exits 1 if the JSON is stale. |
| `src/features/interview/__tests__/questionRegister.test.ts` | Fails on a missing row, a missing justification, a stale JSON file, a row with no output field, or a stale Profile row. |

## Columns (one row per question)

| Column | Meaning |
|---|---|
| `id` | The question node id (for example `iam-001`, `G-02`, `TCP.DM.001`, `PI.PER.001`), `profile.<field>` for a Profile-tab question, or `review.<BTC id>` for a Plan-tab capture review (MG-09 / MG-16). |
| `kind` | One of `readiness`, `boundary`, `plan-input:si`, `plan-input:tcp`, `plan-input:policy` (MG-16 Policy Inputs), `provisioning`, `profile` or `plan-review` (Plan-tab capture review). |
| `text` | The question as the operator sees it. |
| `asked_when` | When the question is actually shown: stack gating, "unless pruned by a covering fact", "when the SI derivation returns nothing", or "optional plan input". |
| `optional_for_finish` | True if the interview can finish without an answer (plan inputs and some Profile fields). |
| `output_fields` | The output field(s) the answer feeds. Readiness nodes feed `requirement_results[<control>].status`. Plan inputs feed their contract field (`si_baseline.*`, `tenant_config_profile.*`, `infrastructure_manifest.*`), plus any field fed through a derivation. Every row has at least one. |
| `sources_tried` | The discovery, inference and default sources tried before asking: the discovery join, boundary drafts, stack pruning, the harvest prefill, archetype priors, the SI derivation table, the SI-to-TCP compile default and bank or generator defaults. |
| `why_not_derived` | One of three values: a reason grounded in code (the file is cited); `candidate for derivation: MG-nn`, naming the backlog item that will derive the answer; or `to justify (BHD)` where the code does not say why. |
| `status` | `justified`, `candidate` or `to_justify`. `unregistered` appears only when a graph node has no justification entry, and the test fails on it. |

The `counts` block holds the number of rows, the number of graph nodes and Profile questions, the number of
rows with each status, and the number of candidate rows per backlog item.

## The rule

**A PR that adds a question adds a register row.** Add the node, add its entry in
`questionRegisterJustifications.ts`, run `npm run register:generate`, and commit the JSON. A PR that derives a
question it used to ask updates the entry (or deletes the node) and regenerates the JSON. Never write a guessed
reason: if the code doesn't say why the answer can't be derived, write `to justify (BHD)`.

The unregistered-node test covers the question graph. The Profile-tab questions are listed by hand. For them, the
test checks only that each row's UI anchor still exists in `AssessmentPage.tsx`. The archetype pick and the
AI-adaptive toggle control the interview but feed no output, so they are not listed.

# The Pain Story v2: rehearsal review

Reviewed September 9, 2026, local time. The strongest improvement is to connect every spoken promise to a visible result. The current design is visually consistent, but the slide narrative and the app frequently describe different moments.

## What I ran

Built ces-tester, validated `demos/ces-pain-story-v2.xlsx`, and launched its real demo runtime against the simulated tenant. Inspected all ten slides in the browser, manually advancing and letting both live actions finish. Presenter text was hidden for an audience-view review. Narration was read from the workbook, not heard as delivered speech. This was an accelerated inspection, not a timed performance of the complete talk track.

The four assigned actions completed: prepared Configuration translation and Assessment, then live Readiness and Operations. Execution and boundary attestation were not performed by this deck. The show was exited cleanly.

The initial launch failed because Windows PowerShell children inherited an incompatible module path. Setting the module path for the launch process to Windows PowerShell's system modules let the runtime reuse the existing demo certificate. No application source or workbook content was changed for this review.

Run evidence: [report.json](../../runs/show/show-1789002019559/report.json). Action artifacts are under `runs/show/show-1789002020033/`. The report records all four actions as done; that does **not** establish that their intended audience proof appeared on screen.

## Observed problems and concrete changes

| Slide | What the audience sees | Recommended change |
|---|---|---|
| 1 | A large branded title, internal deck name `CES-PAIN-STORY-V2`, and “4 tools / 10 slides.” The subtitle explains what the presentation will discuss. | Keep the brand and confident typography. Replace the internal name and deck statistics with the customer scenario: “Ridgeline Fabrication: from uncertainty to a recorded change.” Give the audience a concrete question to follow. |
| 2 | “The real discovery walk, live,” beside the Assessment screen left over from preparation. | Assign and rehearse the intended discovery action, or make this a short introductory slide without a live pane. Never reuse an unrelated app view as its proof. |
| 3 | A boundary-attestation promise beside the same Assessment screen. | Move this explanation after discovery imports the boundary draft. Then perform one confirmation and show the named attester. The current sequence describes the boundary before the runtime produces it. |
| 4 | Readiness fills a profile, waits, then imports a result and lands on boundary confirmation. The slide already says it found the seeded gaps. | Use separate running and completed messages. End on a legible result summary and one actual observation before proceeding to confirmation. This run produced 329 observations: 57 met, 0 not met, 0 partial, 272 unknown. These are observations, not 329 distinct CMMC controls. Do not narrate an MFA enforcement gap as a finding of this presence-based walk. |
| 5 | A promise of exact commands and a readiness-to-plan handoff, but a persistently blank app pane during inspection. | Reveal the prepared result explicitly: 110 compiled tasks, one selected command, and the input/output artifact identities. State that this demo uses a prepared mission plan. It compiled before the live readiness action, so this run does not prove that the newly generated readiness artifact fed it. |
| 6 | Execution, verification, and human gates are described while the pane shows the earlier Readiness boundary draft. No execution action is assigned. | Either enable and rehearse the simulated execution action or present an explicitly labeled explanation with a relevant visual. Show one approval, one change, and one verification before claiming they were demonstrated. |
| 7 | “Walk it like an assessor” and document-generation promises beside the Readiness boundary screen. | Separate assessment preparation from its on-stage review. On entering this slide, restore Assessment and navigate one determination to its supporting artifact. Use an evidence landing rather than the default SPRS landing if evidence is the story. Demonstrate document output separately if it remains a headline claim. |
| 8 | A-18 Default User Permission Lockdown runs successfully. The result is visible, but the evidence section sits below the pane's visible bottom; command categories occupy much of the view. | Collapse navigation, scroll to the emitted evidence, enlarge it, and hold. Name the actual operation and its purpose before execution. Do not imply that this A-18 permission change is the MFA remediation introduced earlier. |
| 9 | A useful pain-to-change diagram competes with another full set of paragraphs. | Let the diagram carry the slide, enlarged. Replace generic promises with three receipts from the run. The graphic also says “boundary signed by a name,” conflicting with the authored instruction to say “attested by name.” |
| 10 | “The close — five promises, kept in front of you,” followed by explanatory prose and claims that fixes were re-proven. | Use a customer-facing next step: “Start with your readiness picture.” Summarize only what was actually demonstrated. Execution, assessor navigation, and a complete evidence handoff were not shown in this rehearsal. |

## Make the live app explain the slide

Use the same four-part structure for each proof beat:

1. **Question:** one short customer question on the left.
2. **Action:** one sentence naming what is happening in the app now.
3. **Proof:** pause on a specific result, with a highlight anchored to that result.
4. **Meaning:** one sentence explaining the customer's next decision.

Make the app the larger surface during action and proof, roughly 60–70% of the stage as a starting layout to rehearse. Keep at most a headline and two short lines alongside it. Restore a balanced split for explanation. The current full portrait app shrinks labels, captions, and evidence into text that is difficult to read while also following the slide.

Captions should describe the current action in a short phrase: “Reading configuration,” “Reviewing the boundary draft,” or “Evidence saved.” The current paragraph-length captions are another narration stream. Some also disagree with the workbook: the readiness caption says the score comes later from Assessment, while the authoring convention assigns the headline score to the readiness export. Reconcile these before the next presentation.

Use completed results to trigger the next message. “Found the gaps” must not appear while the evaluator is still running, and a failed or unavailable proof must change the close's wording. Reserve the result area for observed values; never prefill favorable outcomes.

## Suggested talk tracks for the strongest beats

**Readiness — headline: “Start with what the environment can prove.”**

“We are reading the simulated tenant without changing its configuration. Watch the result arrive. This run returned 57 met observations and 272 unknown observations. Unknown means we still need evidence or human input; this discovery walk is not a completed readiness score. The useful starting point is what we know, what remains unresolved, and the boundary your team must confirm.”

Promote the verified zero-write result to a large “0 tenant writes” proof card. Keep the result dynamically sourced. Move boundary confirmation into the next visible beat.

**Configuration — headline: “Inspect the command before the change.”**

“For this rehearsal, we compiled a prepared mission plan during setup. It produced 110 tasks. Here is one task, the control it addresses, and the exact command it will run. Translation prepares the work; it does not show that the tenant has been fixed.”

Show a real command selected from the compiled output. To claim an end-to-end handoff in a future run, display and verify the identity of the readiness output used as the next step's input.

**Operations — headline: “Make a change. Keep its evidence.”**

“We are restricting default user permissions in the simulated tenant. Watch the selected command, the deliberate live execution, and the result. Now open the evidence it produced: the operation, its outcome, and the recorded context. This is the Operations record generated by the work we just performed.”

Pause on the evidence fields actually present. Do not imply it automatically enters the assessor package. If preview-first remains part of this beat, visibly perform a preview; the current driver follows a live-simulator execution path.

**Close — headline: “Start with your readiness picture.”**

“You saw a read-only evaluation and a governed operation that generated its own evidence. The next step is to establish what your environment can demonstrate and what still needs attention.”

Expand this recap only after the additional proof beats actually work.

## Runtime work that would enable the story

**First: give every slide an explicit presentation action.** In `show-run.ts`, completed warm operations are skipped when entered because only pending operations start. In `eo-review-op.ts`, warm mode assesses and returns; live mode browses. Preparation therefore completes successfully without guaranteeing that slide 7 ever shows Assessment. Add a separate reveal/present lifecycle for prepared results. It should restore the appropriate app state and perform the presentation without repeating a mutation.

**Second: own the mirror per slide.** `slide-render.ts` honors `right-third: app` even when the slide has no operation, so slides 2, 3, and 6 can show whichever app the shared pane last visited. Bind the pane to a relevant view or result. Otherwise show a clearly labeled explanation, or omit the pane. Diagnose the blank Configuration stream independently; successful translation is already recorded, but its presentation failed.

**Third: add proof checkpoints to the drivers.** A visible selection, a result, and the evidence deserve independent pauses. Operations completed in about 8.5 seconds, but its talk track is 235 words for a 90-second slide. The software has finished long before a presenter can reach “watch this.” Start the action at the relevant cue and hold at the result until the audience has read it.

**Fourth: validate audience outcomes as well as operation outcomes.** Add focused rehearsal checks for: correct app on slide entry; a nonblank Configuration result; visible evidence inside the final viewport; a prepared Assessment review actually occurring; and a recap supported by the actions that completed. Preserve no-double-execution behavior.

**Fifth: reconcile the authoring layers.** The recipe, packaged workbook, captions, and runtime catalog have diverged. Update wording in the system objects or recipe, then regenerate the package through the strategy pipeline. Do not hand-edit the composed workbook. Surface `show` directions in presenter controls, and flag “watch/live/just demonstrated” language on slides without the required proof action.

## Pacing and polish

The defined slide dwell totals 11:20, excluding preparation and any extended live holds. Readiness took about 97 seconds including import, longer than its 70-second dwell. Translation's narration has 184 words for 60 seconds, and the close has 128 words for 45 seconds. These leave little room to point, wait, or answer a question. Shorten the scripts, then rehearse the real pauses; an operation timer alone is not a presentation timing model.

Retain the navy/gold visual system, prominent headlines, and visible pointer. Remove repeated feature/benefit/differentiator paragraphs from live beats. Prefer concrete outcomes over absolutes such as “the fear, removed,” “kept compliant,” and “assessment prep starts already done.” The trust comes from showing the record and accurately explaining its limits.

The next rehearsal should prove a small complete chain: one real observation, the relevant plan input, one deliberately executed change, and its visible evidence. Once that chain is clear, the broader four-capability story will be much easier to understand.

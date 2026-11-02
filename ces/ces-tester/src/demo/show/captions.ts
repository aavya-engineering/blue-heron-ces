// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-6 — the per-action NARRATION corpus. Every demo-act emits these on the
 * surface it drives (`op-registry.ts` binds `ctx.caption` to the pane; the two
 * Stamper ops render on the backstage session), so the audience reads what is
 * happening as it happens, in the founder's voice.
 *
 * Three rules bind every string here, and they are the reason this is code, not
 * a deck column (REQ 4a):
 *
 * 1. **Static only — no run values.** A caption never carries a run-specific
 *    number or path; those live in the status HUD and the log, which source them
 *    from the tools' own APIs. A caption that interpolated a figure would be a
 *    place a wrong figure could hide.
 * 2. **Honest to the REAL action.** Outward names only (Readiness Evaluation,
 *    Configuration, Operations, Assessment; stacksim keeps its name). No
 *    fixture-button narration, no invented readiness score, Stamper judged by the
 *    on-disk report not the badge, the sim MFA gap framed as report-only (never
 *    missing), and the adaptive interview describes the comparison without
 *    asserting a drop (it is measured; a tie is reported).
 * 3. **Voice-linted.** The whole corpus (`ALL_CAPTIONS`) passes
 *    `voice_lint.py` with zero [tell] — the `demo:captions-lint` gate re-checks
 *    it on every build.
 *
 * Grouped by REAL branch (warm / live / self-heal / degraded), not one flat
 * list, so an op emits exactly the set its branch takes. `CAPTIONS` is a total
 * `Record<DemoOpId, ...>` (the same trick `OP_IMPLEMENTATIONS` uses), so a future
 * op cannot ship captionless.
 */

import type { DemoOpId } from './deck-model.js';

/** One op's captions, keyed by the real branch that emits them. */
export type OpCaptions = Readonly<Record<string, readonly string[]>>;

/**
 * The corpus. `satisfies Record<DemoOpId, OpCaptions>` gives BOTH totality (a
 * missing op id is a compile error) and the literal branch keys each op reads
 * (`CAPTIONS['eo-review'].warm[0]`).
 */
export const CAPTIONS = {
  'simstack-create': {
    steps: [
      'This is the tenant the whole demo runs on. It looks like the estates we actually walk into every week.',
      'The registry record is real — four authorization fields, a live certificate path, and an endpoint that answers when we ask it.',
      'Here is the gap we are going to chase. An MFA policy exists. It has sat in report-only mode for six months, and nobody ever flipped it to enforced.',
      'That describes most environments we assess. The control was configured once and then quietly left half-finished.',
    ],
  },
  'simstack-destroy': {
    steps: [
      'When the demo ends, this tenant goes away.',
      'We remove the registry record and stop the sim serve.',
      'Every screenshot and every artifact from this run stays on disk. The environment is disposable. The proof of what we did is not.',
    ],
  },
  'muster-readiness': {
    success: [
      'The first question any contractor asks is simple. Where do we actually stand right now?',
      'This is a read-only walk of the tenant. It reads configuration and writes nothing back, and in a moment we will prove that rather than ask you to trust it.',
      'While the evaluation runs, we are filling in how it was done — the session kind, the authorization tier, and who operated it.',
      'It gives us a posture on every control. It does not hand us a score, and I am not going to invent one. That number comes later, from the Assessment.',
    ],
    degraded: [
      'The readiness evaluator is not built on this machine, so this beat steps aside honestly rather than showing you a figure it never computed.',
    ],
  },
  'muster-connect-tenant': {
    steps: [
      'Before we assess anything, we declare how we are assessing it.',
      'Session kind, authorization tier, the operator, the tenant — all stated up front.',
      'This looks like paperwork. It is the thing that makes a readiness result defensible instead of an opinion.',
    ],
  },
  'muster-auto-analysis': {
    steps: [
      'Now we run the real discovery walk against that tenant.',
      'This is the actual command-line evaluation. The app also ships a quick-tour button that loads canned data, and we never touch it here.',
      'What lands on screen came from this tenant, in this run.',
      'Every control it resolves on its own is one fewer question a human has to sit and answer later.',
    ],
  },
  'muster-consent-and-attest': {
    steps: [
      'Nothing gets scanned that you have not authorized.',
      'Here is the part that carries legal weight. A machine can infer where the boundary sits. It cannot attest to it.',
      'A named person confirms the boundary, and the confirm button stays disabled until that name is filled in.',
      'Your system security plan carries False Claims Act exposure. This is where that protection actually lives.',
    ],
  },
  'muster-adaptive-interview': {
    steps: [
      'This is the interview, and I want you to watch the number of questions.',
      'We run it two ways. One branch has already seen the discovery results; the other starts cold.',
      'Then we compare how many questions each branch still has to ask, and read the difference straight off the screen.',
      'Whatever is left is the set a machine cannot resolve on its own — intent, boundary, who owns a control.',
    ],
  },
  'muster-generate-sprs-mp': {
    steps: [
      'This is the number your program office asks about.',
      'We finish the interview and export the readiness result the tool produced.',
      'We read the SPRS figure out of that exported file, so the number is the one the tool actually computed.',
      'Only fully met controls count toward it. Partial and unknown deduct in full, because a score you cannot stand behind in an audit is worse than a low one.',
      'Alongside it comes the mission plan — the remediation work, ordered and ready for Configuration to execute.',
    ],
  },
  'muster-rollup': {
    success: [
      'You just watched one subcontractor prove itself. As the prime, the question you actually live with is every sub at once.',
      'This is your rollup board. Each sub runs the same read-only evaluation in its own tenant, and its status reports up to you.',
      'The subs on screen are sample status files, so you can see the board the way it fills in — not results we pulled from this run.',
      'Green, amber, red, sub by sub. You see where each one stands without sending a single email, and without touching their systems.',
    ],
    degraded: [
      'The rollup surface is not up on this machine, so we show the sample board as a plain card rather than dressing up a live one.',
    ],
  },
  'stamper-translate': {
    warm: [
      'While we were talking, the plan has been compiling in the background.',
      'Configuration is turning the findings into concrete, ordered tasks aimed at this specific tenant.',
      'What matters is the task list that comes out the other side, and that is what you are looking at.',
    ],
    live: [
      'Right now Configuration is compiling the mission plan into executable tasks.',
      'Each finding becomes an ordered step written against this tenant.',
    ],
  },
  'stamper-execute': {
    warm: [
      'The remediation itself already ran, back during setup. It takes minutes, and I would rather spend them talking to you than watching a progress bar.',
      'What you are seeing is the report it wrote to disk — tasks attempted, tasks applied, tasks failed.',
      'We judge that file, and we leave the status badge alone. The badge has read Complete over a report that said partial, so we stopped trusting it.',
      'The failures it lists are known simulator artifacts, and we call them out by name rather than quietly filter them.',
    ],
    live: [
      'Configuration is applying the plan against the tenant right now, one task at a time.',
      'This runs for minutes, so settle in. The honest version of this beat takes real time.',
    ],
    livePeek: [
      'Configuration starts applying the plan against the tenant, and you watch the first tasks land.',
      'The full run takes several minutes, so we confirm it is really executing and then stop it here.',
      'In production it runs to completion and writes the report we judge, and we never trust the status badge.',
    ],
  },
  'ao-registry': {
    steps: [
      'This is the Operations console, and we are about to run a governed command against the live sim tenant.',
      'We pick the command out of the registry and submit it.',
      'It writes its own evidence record as it runs, so there is a trail for every action.',
    ],
  },
  'ao-make-change': {
    steps: [
      'Now we submit the fix through the same governed path.',
      'This command changes the tenant authorization policy — the MFA object we have been circling all along.',
      'Same console, same evidence trail. The change is captured the moment it happens.',
    ],
  },
  'eo-review': {
    warm: [
      'The assessment itself runs during setup. It is the slow part, and it is honest work, so we pay for it off stage.',
    ],
    liveWalk: [
      'This is the Assessment result, and we are going to read it the way an assessor does.',
      'Start with the whole picture — every control, sorted into met, not met, partial, and not assessed.',
      'Now we open one family and filter it down to what came back not met.',
      'This is the SPRS score the assessment produced, with the deductions that built it.',
    ],
    selfHeal: [
      'The assessment is not on screen yet, so we are going to run it live right now rather than fake a result.',
    ],
  },
  'eo-show-change-captured': {
    steps: [
      'We remediated a moment ago. Now we assess the same tenant again, so the after-picture is freshly measured.',
      'We captured the before-state earlier and wrote it to disk, so this comparison rests on two recorded snapshots.',
      'Then we walk to the exact control and read what moved — the status, and the SPRS score, treated as two separate facts.',
      'If the control did not move, we say so plainly. A demo that narrates a flip that never happened is the one thing this harness exists to prevent.',
    ],
  },
} satisfies Record<DemoOpId, OpCaptions>;

/**
 * The whole corpus, flattened in a stable order — the lint gate's input
 * (`scripts/lint-captions.mjs`) and the non-empty test read this. Every caption
 * exactly once, so the linter judges precisely what ships.
 */
export const ALL_CAPTIONS: readonly string[] = Object.values(
  CAPTIONS as Record<string, OpCaptions>,
).flatMap((set) => Object.values(set).flat());

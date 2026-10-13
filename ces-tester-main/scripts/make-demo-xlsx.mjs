#!/usr/bin/env node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 S0 — the starter demo-deck fixture generator.
 *
 * ces-tester LOADS decks; it does not author spreadsheets (PLAN-DEMO-TOOL.md
 * "Out of Scope"). This script exists for exactly one reason: the round-trip
 * gate. It emits a minimal, deterministic OOXML workbook so `xlsx-loader.ts`
 * can be tested against a real .xlsx produced here and asserted as a grouped
 * deck model — generator -> our own loader -> asserted model.
 *
 * Deliberately a hand-rolled writer over `fflate.zipSync` rather than a
 * dependency: the only write we ever need is this fixture, and every xlsx
 * *writer* on npm is either abandoned or drags in the SheetJS CDN tarball
 * (RESEARCH_SUMMARY.md findings 2-4).
 *
 * Two mechanics are load-bearing:
 *
 * 1. **Zip entry names are hardcoded with forward slashes.** `path.join` on
 *    win32 yields backslashes, which produce an archive no xlsx reader will
 *    open. Never build these keys with the path module.
 * 2. **Strings are `t="inlineStr"` cells** — no `sharedStrings.xml`, so the
 *    writer stays a pure function of the row data. `read-excel-file` v9 reads
 *    inline strings (verified by the S1 round-trip test); if that ever
 *    regresses, the fallback is a real shared-string table.
 *
 * The script now emits TWO decks (see `DECKS` at the bottom):
 *
 * - `ces-overview` — the loader-shaped fixture described above.
 * - `ces-pain-story` — the founder's pain-first narrative deck. It is authored
 *   here rather than in Excel for one practical reason: a talk track is prose
 *   that gets rewritten many times, and prose under version control diffs, and
 *   a binary workbook does not. The .xlsx stays the artifact `demo:show` loads;
 *   this file stays the source the wording is edited in.
 *
 * Usage: node scripts/make-demo-xlsx.mjs                    # both decks
 *        node scripts/make-demo-xlsx.mjs [outPath]          # ces-overview
 *        node scripts/make-demo-xlsx.mjs --deck <id> [outPath]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

/** The column contract (demos/README.md). Order here IS the sheet order. */
export const COLUMNS = [
  'slide #',
  'talk track',
  'feature',
  'function',
  'benefit',
  'differentiator',
  'tools',
  'op mode',
  'op',
  'duration (sec)',
  'image',
  'features',
  'right-third',
];

/**
 * The acts-showcase deck's column contract. Identical to the shared `COLUMNS`
 * plus a trailing `params` column, read by name (`demos/README.md` — unknown
 * columns warn, known ones are matched by normalized header). It is DECK-LOCAL
 * on purpose: appending `params` to the shared `COLUMNS` would change the two
 * committed decks' bytes and break their golden fixtures. Slide 14 (`eo-review`,
 * `land=evidence`) and slide 2 (`land=sprs`) need this cell.
 */
export const ACTS_SHOWCASE_COLUMNS = [...COLUMNS, 'params'];

/**
 * The starter deck: 8 slides across 11 rows. Shaped to exercise the loader —
 * three multi-row slides (2, 5, 7), a mix of op modes (staged / warm / live),
 * blank cells that must inherit within a slide, and one slide (3) with a blank
 * duration so `--default-dwell` is exercised.
 *
 * No `image` cell is populated: a missing image file is a LOAD-TIME error, and
 * shipping binary demo art is outside this plan's File Inventory. The image
 * path is covered by render/server unit tests instead.
 *
 * The five TOOL slides (3 stacksim, 4 muster, 5 stamper, 6 ao, 8 eo) each carry
 * a newline-separated `features` cell. Every label is a real, documented
 * capability traced to `docs/MUSTER-TENANT-READINESS.md`, `docs/context/VAULT.md`
 * ("Sibling Surfaces") or the CES feature deck — nothing here is invented, and
 * two plausible-sounding items were deliberately NOT used: Stamper's first
 * stage is "compilation" (not "translation"), and the write-refusal guard is
 * ces-tenant's, not stacksim's, so stacksim claims its mutation-tracking ledger
 * instead. Five each is exactly the display cap, so no slide warns.
 */
export const STARTER_ROWS = [
  {
    slide: 1,
    talk: 'Welcome. CES turns a CMMC assessment from a six-week consulting engagement into a repeatable run that leaves evidence behind.',
    feature: 'CES in one run',
    rightThird: 'absent',
    fn: 'Orchestrates five tools end to end against a live tenant',
    benefit: 'Weeks of assessment and remediation collapse into a single evidenced run',
    diff: 'Every claim is backed by a ledger entry, not a spreadsheet',
    tools: 'stacksim, muster, stamper, ao, eo',
    mode: 'staged',
    op: '',
    duration: 20,
  },
  {
    slide: 2,
    talk: 'Start with the problem: nobody can prove what changed.',
    feature: 'The evidence gap',
    rightThird: 'absent',
    fn: 'Assessment findings live in documents; remediation lives in an engineer’s shell history',
    benefit: '',
    diff: '',
    tools: '',
    mode: 'staged',
    op: '',
    duration: 30,
  },
  {
    slide: 2,
    talk: '',
    feature: '',
    fn: '',
    benefit: 'Auditors accept evidence, not assertions — cost, schedule and audit risk all collapse onto that one gap',
    diff: 'Competitors hand over a report; CES hands over a ledger',
    tools: '',
    mode: '',
    op: '',
    duration: '',
  },
  {
    slide: 3,
    talk: 'tenant-stacksim gives us a real, resettable Microsoft 365 tenant to demo against.',
    feature: 'tenant-stacksim',
    rightThird: 'absent',
    fn: 'A high-fidelity simulated M365 / Azure tenant with a full write ledger',
    benefit: 'Demo and regression-test against real API shapes without ever touching a customer tenant',
    diff: 'Every mutation is recorded, so read-only behaviour can be proven rather than promised',
    tools: 'stacksim',
    mode: 'staged',
    op: '',
    duration: '',
    features: [
      'Simulated M365/GCC-High tenant',
      'CLI seed and serve',
      'HTTP resolve/evidence/ledger endpoints',
      'Mutation-tracking evidence ledger',
      'Sandboxed PowerShell module surface',
    ].join('\n'),
  },
  {
    slide: 4,
    talk: 'Muster runs the assessment wizard and produces the mission plan.',
    feature: 'Muster',
    rightThird: 'absent',
    fn: 'Guided discovery wizard producing a certified SPRS headline and a machine-readable mission plan',
    benefit: 'Assessment output is hand-off ready — no re-keying between assessor and remediator',
    diff: 'One artifact drives the remediation; the plan and the work cannot drift apart',
    tools: 'muster',
    mode: 'staged',
    op: '',
    duration: 25,
    features: [
      'Read-only tenant discovery walk',
      'Signed collector-kit import',
      'Microsoft Graph harvest probes',
      'Adaptive readiness interview',
      'Conservative SPRS score and projection',
    ].join('\n'),
  },
  {
    slide: 5,
    talk: 'Stamper takes that plan and actually remediates the tenant.',
    feature: 'Stamper',
    rightThird: 'absent',
    fn: 'Applies and verifies remediation tasks against the tenant, task by task',
    benefit: '',
    diff: '',
    tools: 'stamper',
    mode: 'staged',
    op: '',
    duration: 40,
    features: [
      'Registry-driven plan compilation',
      'No-write tenant assessment',
      'Dependency-ordered idempotent execution',
      'Evidence-weighted verification bands',
      'Command registry and variable workbench',
    ].join('\n'),
  },
  {
    slide: 5,
    talk: '',
    feature: '',
    fn: '',
    benefit: 'Remediation is executed and verified in the same pass, so nothing is reported fixed that was not',
    diff: 'Apply and verify are one artifact, not two teams and two tickets',
    tools: 'stamper',
    mode: '',
    op: '',
    duration: '',
  },
  {
    slide: 6,
    talk: 'AdminOps is the day-two surface. We warm it up now so it is ready the moment we need it.',
    feature: 'AdminOps',
    rightThird: 'app',
    fn: 'A tiered command registry for day-two administrative operations',
    benefit: 'Routine tenant changes stop being ad-hoc scripts on somebody’s laptop',
    diff: 'Tier gating plus auto-collected evidence on every single execution',
    tools: 'ao',
    mode: 'warm',
    op: 'ao-registry',
    duration: 45,
    features: [
      '95-command governed registry',
      'Preview-first get-then-set safety',
      'Tier-3 two-person approval',
      'Governed MCP agent administration',
      'Simulated-tenant rehearsal',
    ].join('\n'),
  },
  {
    slide: 7,
    talk: 'Here it is live — the real AdminOps GUI, driven exactly the way an operator drives it.',
    feature: 'Live command execution',
    rightThird: 'app',
    fn: 'Browse the registry, open a Tier-1 command, execute it against the tenant',
    benefit: '',
    diff: '',
    tools: 'ao',
    mode: 'live',
    op: 'ao-registry',
    duration: 90,
  },
  {
    slide: 7,
    talk: '',
    feature: '',
    fn: '',
    benefit: 'Every operator action leaves an evidence record without the operator doing anything extra',
    diff: 'The evidence is collected by the tool, not assembled afterwards by the human',
    tools: 'ao',
    mode: 'live',
    op: 'ao-registry',
    duration: '',
  },
  {
    slide: 8,
    talk: 'And the Evidence Officer closes the loop with a real re-assessment.',
    feature: 'Evidence Officer',
    rightThird: 'absent',
    fn: 'Re-assesses the tenant and reports real per-control determinations',
    benefit: 'The before-to-after delta is measured against the tenant, never asserted',
    diff: 'The needle moves on evidence or it does not move at all',
    tools: 'eo',
    mode: 'staged',
    op: '',
    duration: 30,
    features: [
      'Live before/after assessment',
      'One determination per objective',
      'SPRS deduction detail and history',
      'POA&M auto-close lifecycle',
      'Generated System Security Plan',
    ].join('\n'),
  },
];

/**
 * The pain-first narrative deck — 12 slides across 14 rows, 584 s (9:44) of
 * declared dwell, plus however long the one live op takes (a `live` slide holds
 * past its dwell until the op completes, so wall time is 9:44 + that hold).
 *
 * Every talk track is written to be SPOKEN — contractions, second person, one
 * concrete image of what the pain costs before any mechanism is named. If a
 * line reads like a bullet, it is wrong for this deck.
 *
 * It is NOT one act per tool. It is five pains removed in order — the fear, the
 * "where do we stand" pain, the "get compliant without stopping the business"
 * pain, the "stay compliant" pain, the "survive the assessor" pain — and a tool
 * appears at the slide where a pain calls for it. Stamper carries three slides
 * because remediation carries three distinct pains; tenant-stacksim recurs on
 * four, because it is CES product (THREAD_HANDOFF.md, founder 2026-09-05) and
 * is what makes "read-only" and "rehearsed" provable rather than promised.
 *
 * Op discipline: `staged` everywhere except the AdminOps pair — slide 8 `warm`
 * so the console is standing by when the story reaches day-two operations, and
 * slide 9 `live`, the dramatic peak, where a real command is submitted and the
 * evidence record writes itself. `ao-registry` is the only op id the runtime
 * registers (`deck-model.ts` DemoOpId), so it is the only one named here.
 *
 * `features` appears on five slides only, three items each, and only where the
 * list is the mechanism that removes THAT slide's pain. Every label traces to
 * `docs/MUSTER-TENANT-READINESS.md`, `docs/context/VAULT.md` ("Sibling
 * Surfaces"), the CES feature deck, or STARTER_ROWS above. The narrative slides
 * carry none: a feature list on the opener would make it a feature tour.
 *
 * Slides 9 and 12 are two-row slides; the continuation row leaves the op cells
 * blank so the slide's spec is inherited (never re-stated, never in conflict).
 */
export const PAIN_STORY_ROWS = [
  {
    slide: 1,
    talk:
      'Somewhere in your inbox is a flow-down clause with a date on it. Miss that date and nobody fines you — ' +
      'you simply stop being eligible to bid. That’s the real fear: not a penalty, a contract you can no longer win. ' +
      'And the way most companies meet that date is by running four disconnected projects at once — scope it, fix it, ' +
      'operate it, prove it — out of questionnaires, spreadsheets and screenshots, every one of them competing with the ' +
      'work the business actually exists to do. The next ten minutes aren’t a tour of five tools. They’re the four ' +
      'things that frighten you about this, taken off the table one at a time, against one real tenant. Let’s start ' +
      'where everyone starts: not knowing.',
    feature: 'Four projects, one business, no slack',
    rightThird: 'absent',
    fn: 'One system across the whole Level 2 lifecycle — plan, execute, maintain, prove — run inside your own Microsoft environment',
    benefit: 'The compliance program stops competing with revenue work for the same handful of people',
    diff: 'CES takes the burden instead of redistributing it to your team or to a consultant',
    tools: 'stacksim, muster, stamper, ao, eo',
    mode: 'staged',
    op: '',
    duration: 45,
  },
  {
    slide: 2,
    talk:
      'Ask ten people inside a defense supplier where they stand on CMMC and you’ll get ten answers, all of them optimistic. ' +
      'The honest answer is gated behind a sales call and a paid engagement — so the first real number many companies ever ' +
      'see is an assessor’s finding, and by then the money’s already been spent in the wrong places. Muster gives you that ' +
      'number before you commit to anything: a readiness interview in your browser, scoped to the services you actually run. ' +
      'And it’s built to fail conservative. An "I don’t know" is recorded as an explicit unknown and counts against you, ' +
      'because a score that flatters you is the most expensive thing you can own.',
    feature: 'You cannot budget a gap you cannot see',
    rightThird: 'absent',
    fn: 'A browser readiness interview scoped to your services, scored on the DoD 5-3-1 arithmetic across all 110 requirements',
    benefit: 'Budget, staffing and timeline get set from a real position instead of an estimate that will not survive contact',
    diff: 'The question the market sells as an engagement, answered self-serve — and answered conservatively',
    tools: 'muster',
    mode: 'staged',
    op: '',
    duration: 50,
    features: [
      'Conservative SPRS-style score',
      'Unknowns recorded as explicit unknowns',
    ].join('\n'),
  },
  {
    slide: 3,
    talk:
      'Here’s the one that keeps people up at night. Every dollar you’re about to spend is sized by where you say CUI lives, ' +
      'and if that boundary’s wrong then the assessment built on top of it is wrong too. Draw it too wide and you’re hardening ' +
      'half the company for no reason. Draw it too narrow and an assessor finds CUI sitting outside it. Muster drafts the ' +
      'boundary for you from a read-only look at your environment, then makes a named person confirm or correct every single ' +
      'line. The machine is never allowed to assert boundary intent on its own, and an unconfirmed draft never scores as a ' +
      'pass. So the boundary is yours, and it’s signed.',
    feature: 'Get the boundary wrong and everything after it is wasted',
    rightThird: 'absent',
    fn: 'Drafts your CUI boundary from discovery, then requires a named human confirmation on every line before it can score',
    benefit: 'The decision that sizes the entire program is drafted for you and owned by a person, not inherited from a vendor',
    diff: 'Your boundary in your environment — never the vendor enclave quietly becoming your scope',
    tools: 'muster',
    mode: 'staged',
    op: '',
    duration: 50,
  },
  {
    slide: 4,
    talk:
      'A self-assessment is a 110-row questionnaire answered from memory, and memory is exactly what an assessor punctures. ' +
      'So the second answer doesn’t ask anybody anything. Stamper reads your live tenant — all 110 controls, 14 families, on ' +
      'the same five-three-one weighting the DoD uses — and it changes nothing while it does it. And "changes nothing" isn’t ' +
      'a promise on a slide. We run this against tenant-stacksim, a simulated Microsoft tenant that’s itself part of CES, and ' +
      'stacksim keeps a mutation ledger. After a full assessment that ledger still reads zero. Read-only is the claim everyone ' +
      'in this category makes and almost nobody can show you.',
    feature: 'A number you can defend, deduction by deduction',
    rightThird: 'absent',
    fn: 'Read-only discovery scores all 110 controls straight from live configuration and rolls them to the 14 families',
    benefit: 'Ground truth from the system itself — commitment-free, repeatable any time, and it needs no change window',
    diff: 'Scores system state instead of memory, and the read-only claim is demonstrable on the ledger, not asserted',
    tools: 'stamper, stacksim',
    mode: 'staged',
    op: '',
    duration: 50,
  },
  {
    slide: 5,
    talk:
      'Now the expensive part. Remediation is where CMMC budgets blow out, because the work scatters across portals and scripts ' +
      'and outside labor, and it moves at the speed of whoever happens to be available that week. And the version of that pain ' +
      'nobody puts in a proposal is the two a.m. one: the change window opens, a script hits a setting nobody accounted for, you ' +
      'back out at four in the morning and rebook for next month. CES compiles the plan first. Every control reference becomes an ' +
      'exact, dependency-ordered command, validated before anything touches your tenant. If it’s going to fail, it fails at ' +
      'compile time, by name, in daylight.',
    feature: 'The failure lands on the compiler’s desk, not in your change window',
    rightThird: 'absent',
    fn: 'Compiles control references into exact, dependency-ordered commands and validates them before the tenant is touched',
    benefit: 'A broken plan costs minutes at a desk instead of a burned maintenance window and a date that slips a month',
    diff: 'Control-to-command knowledge is versioned data that compounds — a consulting engagement evaporates when it ends',
    tools: 'stamper',
    mode: 'staged',
    op: '',
    duration: 45,
    features: [
      'Registry-driven plan compilation',
      'Validate a plan without executing',
      'Dependency-ordered execution layers',
    ].join('\n'),
  },
  {
    slide: 6,
    talk:
      'The other reason remediation stalls is simpler: you don’t have a test tenant. There’s production, and there’s ' +
      'production. So a tool that says "trust me, I’ll fix it" is asking you to bet the environment your business runs on, ' +
      'and the honest answer is usually no. CES doesn’t ask for that bet. Rehearse the whole sequence against tenant-stacksim ' +
      'first — the simulated tenant, gates and all — then run for real with the dial wherever you want it: dry run, approve ' +
      'every step, approve every layer, or hands off. And the second run is safe, because every change reads before it writes. ' +
      'That second run is where trust in automation actually gets decided.',
    feature: 'Automation earns its autonomy at your pace',
    rightThird: 'absent',
    fn: 'Applies the plan in dependency layers with the gating dialled from dry run to fully unattended, rehearsable end to end',
    benefit: 'The change window stops being a risk event, because the play has already been run somewhere it cannot hurt you',
    diff: 'The adoption path between full-manual and trust-me automation — with the rehearsal tenant included, not sold separately',
    tools: 'stamper, stacksim',
    mode: 'staged',
    op: '',
    duration: 50,
    features: [
      'Rehearsal against the simulated tenant',
      'Dry run to unattended, one plan',
      'Read-before-write, safe to re-run',
    ].join('\n'),
  },
  {
    slide: 7,
    talk:
      'About a third of Level 2 has no configuration behind it at all — policy, training, screening, the things a person has to ' +
      'do and then prove. Automation-only tools leave that half on the floor, and that’s how a company with a perfect technical ' +
      'score still fails — then pays for the re-assessment and waits out the delay with the contract still unsigned. In CES the ' +
      'non-technical controls are gates inside the same run: the operator stops, attests, and that attestation is hashed into ' +
      'the same record as the automated changes. One run record covers the settings and the people. Nothing ends up orphaned in ' +
      'a binder somebody has to go find.',
    feature: 'The half that automation usually orphans',
    rightThird: 'absent',
    fn: 'Turns non-technical controls into manual gates whose operator attestations are hashed into the same run record',
    benefit: 'No second workstream and no separate binder — the people controls finish when the technical ones do',
    diff: 'The seam between automation and human controls is eliminated, not documented around',
    tools: 'stamper',
    mode: 'staged',
    op: '',
    duration: 44,
  },
  {
    slide: 8,
    talk:
      'Say you get to compliant. You then sign an annual affirmation with your own name on it — and between assessments, posture ' +
      'decays one ordinary admin change at a time. Somebody opens a port for a vendor on a Tuesday. Nobody’s malicious; the ' +
      'control just quietly stops holding, and you’re the one who attested that it did. AdminOps makes the governed path the ' +
      'convenient path. Day-two operations are typed, CMMC-labelled commands: preview is the default, the scope and ' +
      'CUI-boundary gates evaluate first and fail closed, and the riskiest operations need a second person whose approval is ' +
      'bound to the exact parameters. The console on the right came up before we started — it’s been standing by since slide one.',
    feature: 'Compliance decays one admin change at a time',
    rightThird: 'app',
    fn: 'Day-two admin work as typed, CMMC-labelled commands behind gates that evaluate before anything executes',
    benefit: 'Posture is maintained by how you operate day to day instead of by an annual scramble before the affirmation',
    diff: 'Enforcement at the change point — a gate that fires, not an alert about drift that already happened',
    tools: 'ao',
    mode: 'warm',
    op: 'ao-registry',
    duration: 48,
    features: [
      'Preview-first get-then-set writes',
      'Fail-closed CMMC scope gates',
      'Tier-3 two-person approval',
    ].join('\n'),
  },
  {
    slide: 9,
    talk:
      'Here’s the pain that eats the most hours and gets talked about the least: evidence archaeology. The assessment approaches, ' +
      'and somebody spends three weeks re-proving by hand what the environment already knew — screenshots with no timestamps, ' +
      'exports with no provenance, stale the day they’re filed. So watch this instead. This is the real AdminOps console, driven ' +
      'the way an operator drives it: find the command, arm the live write against our tenant-stacksim tenant, submit. Nobody’s ' +
      'going to open a folder. Nobody’s going to take a screenshot.',
    feature: 'Watch the evidence write itself',
    rightThird: 'app',
    fn: 'Browse the registry, open a real command, arm the live write against the simulated tenant, and submit it',
    benefit: '',
    diff: '',
    tools: 'ao, stacksim',
    mode: 'live',
    op: 'ao-registry',
    duration: 60,
  },
  {
    slide: 9,
    talk:
      'There it is — the result, and beside it an evidence record the executor wrote by itself: the command, the verdict, the ' +
      'control it maps to, who ran it, and when. Operating the environment and building the record were the same act. Ask ' +
      'yourself what your current tooling would have left behind after that.',
    feature: '',
    fn: '',
    benefit: 'Assessment prep starts already done, because the evidence was filed at the moment the work happened',
    diff: 'The record is emitted by the executor itself — it is never left to somebody remembering to be diligent',
    tools: '',
    mode: '',
    op: '',
    duration: '',
  },
  {
    slide: 10,
    talk:
      'Assessment day is where the schedule goes. Not because you’re non-compliant — because the assessor asks why each objective ' +
      'was judged the way it was, and your people go digging through shared drives to answer, one objective at a time, for a week, ' +
      'off the work that pays for all of this. The Evidence Officer answers ahead of them: one determination per assessment ' +
      'objective, with the reasoning and the deciding source attached. You hand the assessor a viewer and they pivot by family, by ' +
      'status, by objective, drill to the artifact, and re-verify its hash themselves on the spot. Radical transparency turns out ' +
      'to be the cheapest assessor-relations strategy there is.',
    feature: 'The assessor serves themselves; your team keeps working',
    rightThird: 'absent',
    fn: 'One determination per objective with its rationale, published through a self-contained viewer the assessor drives',
    benefit: 'The assessment stops pulling your engineers off revenue work for a week of document requests',
    diff: 'Built to the assessor’s own method, so the audit becomes navigation instead of negotiation',
    tools: 'eo',
    mode: 'staged',
    op: '',
    duration: 48,
    features: [
      'Self-serve assessor viewer',
      'On-demand hash verification',
    ].join('\n'),
  },
  {
    slide: 11,
    talk:
      'And then the paperwork. The System Security Plan is the anchor document of the whole assessment and the costliest thing ' +
      'to produce — and a hand-authored plan that contradicts your actual environment isn’t just embarrassing, it’s a finding, ' +
      'in the document the assessor reads first. The POA&M is worse: regenerated every cycle, milestone history lost, ' +
      'deficiencies parked on it that were never eligible to be parked. Here, both come out of the assessment that just ran. ' +
      'The SSP is generated from the same determinations. The POA&M reconciles — what you fixed auto-closes with its audit ' +
      'trail, what regressed reopens. Staying current is a regeneration, not another engagement.',
    feature: 'The documentation cost becomes a build output',
    rightThird: 'absent',
    fn: 'Generates the SSP from the assessment and reconciles the POA&M each run — auto-close, carry-forward, reopen',
    benefit: 'The two most expensive documents in the program stop being projects and start being outputs',
    diff: 'A POA&M with memory — the reconciling mechanic, not just a prettier version of the document',
    tools: 'eo',
    mode: 'staged',
    op: '',
    duration: 46,
  },
  {
    slide: 12,
    talk:
      'Go back to that clause with a date on it. Ten minutes ago it was four projects and a hope. Here’s what it is now. One ' +
      'honest position you didn’t have to buy. A plan that fails on a desk instead of in your change window. A boundary signed ' +
      'by a name. Day-two operations that can’t quietly drift, because the gate outranks the switch.',
    feature: 'The fear, removed',
    rightThird: 'absent',
    fn: 'Five tools — tenant-stacksim, Muster, Stamper, AdminOps, Evidence Officer — on one evidence spine',
    benefit: '',
    diff: '',
    tools: 'stacksim, muster, stamper, ao, eo',
    mode: 'staged',
    op: '',
    duration: 48,
  },
  {
    slide: 12,
    talk:
      'And one live command, run in front of you, that filed its own evidence. That’s the whole system in miniature. Five tools, ' +
      'one evidence spine, inside your own Microsoft environment, on a tenant that never left this room. CES takes care of CMMC. ' +
      'You do your work.',
    feature: '',
    fn: '',
    benefit: 'Your attention goes back to the work the business exists to do — the one resource you cannot buy more of',
    diff: 'One evidence spine across five tools, in your environment, instead of four vendors and four artifacts to reconcile',
    tools: '',
    mode: '',
    op: '',
    duration: '',
  },
];

/**
 * GP-DEMO-5 streamgui — the stream-GUI PROOF deck. Authored ALL-LIVE in
 * NARRATION ORDER (P1-6): every streamed beat is `live`-on-slide so the single
 * serialized op queue processes each op on the slide the audience is watching,
 * and `stamper-execute` gets its execute-only fast path because the live
 * `stamper-translate` immediately precedes it and leaves backstage connected
 * with `#outputPath` populated. NO warm ops — a warm execute at prep would sit
 * in the queue and cross a later live op's slide.
 *
 * Grown across slices: A2 seeds it with title + translate-live; B1 inserts the
 * muster-readiness-live slide before translate; A3 appends the execute-live slide
 * after translate. Final order: title → muster-readiness → translate → execute.
 */
export const STREAMGUI_PROOF_ROWS = [
  {
    slide: 1,
    talk:
      'Everything you are about to see runs live, in the slide. No screenshots, no recordings — the ' +
      'real product GUIs, streamed into the right third of the stage while they operate.',
    feature: 'The live GUIs, streamed on stage',
    fn: 'The real CES tool interfaces stream into the slide as they run — Configuration and Readiness alike',
    benefit: 'What the room sees is the product actually operating, in sync with the narration — never a mock-up',
    diff: 'The Configuration GUI streams from a headless backstage session, so it appears live without ever touching the pane',
    tools: 'stamper, muster',
    mode: 'staged',
    op: '',
    duration: 12,
  },
  {
    slide: 2,
    talk:
      'First, Readiness. The evaluation walks the tenant, and this run\'s real result imports straight ' +
      'into the Muster app — the boundary panel, operating in front of you. Not the demo button; the ' +
      'real walk.',
    feature: 'Readiness — the real result, in the app',
    fn: 'The readiness evaluation runs and its real result is imported into the Muster SPA, ending on the boundary panel',
    benefit: 'What streams is this run\'s genuine four-value posture, imported through the app\'s own file seam',
    diff: 'Never the fixture "Run Discovery" button — the real CLI artifact feeds the UI, boundary panel visible',
    tools: 'muster',
    mode: 'live',
    op: 'muster-readiness',
    duration: 20,
  },
  {
    slide: 3,
    talk:
      'Here is Configuration compiling the mission plan into executable remediation tasks — the real ' +
      'Stamper GUI, streamed from backstage, operating in front of you.',
    feature: 'Configuration — the plan compiled live',
    fn: 'The Stamper Configuration GUI compiles the mission plan into dependency-ordered executable tasks',
    benefit: 'The task count on the readout is the real /api/translate result — judged, never a badge',
    diff: 'The GUI streams from the headless backstage session (/mirror/backstage), leaving the pane state untouched',
    tools: 'stamper',
    mode: 'live',
    op: 'stamper-translate',
    duration: 20,
  },
  {
    slide: 4,
    talk:
      'And now execute — the same GUI applies and verifies the plan against the tenant, task by task. ' +
      'It takes the fast path because the translate you just watched left it connected and ready.',
    feature: 'Configuration — the plan applied live',
    fn: 'The Stamper GUI applies and verifies the remediation plan against the tenant, task by task',
    benefit: 'The applied/total count is judged from the execution report on disk, never the "Complete" badge',
    diff: 'Live from backstage, in-sync: the translate on the previous slide gives execute its execute-only fast path',
    tools: 'stamper',
    mode: 'live',
    op: 'stamper-execute',
    duration: 30,
  },
];

/**
 * GP-DEMO-5 streamgui — A3's warm-path proof deck. Title + a warm
 * `stamper-translate` (authored as slide content, feeding the fast path) + a warm
 * `stamper-execute`. BOTH warm, so both fire at prep on the single serialized
 * queue; the execute-warm slide streams backstage's REAL current state (mid-run
 * or completed report) on `/mirror/backstage`. NO live op crosses the warm
 * execute (the ordering rule P1-6).
 */
export const STREAMGUI_EXECUTE_WARM_ROWS = [
  {
    slide: 1,
    talk:
      'This deck warms Configuration during prep and streams its real backstage state on the ' +
      'execute slide — no live op crosses it.',
    feature: 'Configuration streamed warm',
    fn: 'The Config pair runs backstage at prep; the execute slide streams its real current state',
    benefit: 'The ~13-minute remediation is off the stage clock, and what streams is the genuine backstage state',
    diff: 'Warm streams the real end/mid state; the all-live proof deck streams the operation in-sync instead',
    tools: 'stamper',
    mode: 'staged',
    op: '',
    duration: 12,
  },
  {
    slide: 2,
    talk:
      'Configuration compiled the mission plan during prep — this beat is authored as slide content ' +
      'so execute has its fast path.',
    feature: 'Plan compiled at prep',
    fn: 'The mission plan is compiled to executable tasks on the backstage session during prep',
    benefit: 'Leaving the backstage page connected with an executable plan is what gives execute its fast path',
    diff: 'A warm translate earlier in the deck is the difference between the ~5-min fast path and the ~18-min full flow',
    tools: 'stamper',
    mode: 'warm',
    op: 'stamper-translate',
    duration: 12,
  },
  {
    slide: 3,
    talk:
      'And here is execute, streamed from backstage — the real current state of the remediation, ' +
      'mid-run or the completed report, judged by the execution report on disk.',
    feature: 'Configuration — applied, streamed warm',
    fn: 'The Stamper GUI applies and verifies the plan against the tenant; its real backstage state streams into the slide',
    benefit: 'A subscriber connecting to a finished-idle backstage still sees the real current frame, never a blank',
    diff: 'Warm keeps the ~13-min wall time off the stage while still streaming the genuine backstage state',
    tools: 'stamper',
    mode: 'warm',
    op: 'stamper-execute',
    duration: 30,
  },
];

/**
 * acts-showcase — every demo-act, one per slide, in a precondition-valid order.
 *
 * FOUNDER AMENDMENT (2026-09-07): the two Configuration acts run **WARM**, every
 * other act runs **LIVE**. All-live measured ~23-25 min, ~18 of it the Config
 * pair (`stamper-translate` ~5 min + `stamper-execute` ~13 min); warming that
 * pair takes ~18 min off the stage clock, so audience-facing time is ~8-10 min.
 * Both warm ops fire at prep through the ONE serialized op queue in deck order,
 * so slide 1's live `simstack-create` is dispatched behind them and slide 1
 * holds while they run — that hold IS the off-stage prep window, not a hang.
 *
 * Order rationale (preconditions, unchanged from PLAN-ACTS-SHOWCASE.md):
 *   before-assessment (2) → sole remediator Config (3 translate → 4 execute,
 *   adjacent so execute keeps its fast path: a warm translate on an EARLIER
 *   slide is what provides it) → after (5), so no mutation sits between the
 *   before and after reads. Muster chain 6→10 is the proven stateful order;
 *   `muster-readiness` (11) self-navigates so it is safe after. AO (12,13)
 *   precede `eo-review land=evidence` (14), which needs an earlier AO write.
 *   `simstack-destroy` last.
 *
 * Honesty: slide 5 (`eo-show-change-captured`) runs in a STANDALONE deck with no
 * harness-written `eo-before.json`, so it re-assesses the remediated tenant and
 * reports the real post-state — the talk track claims NO before/after flip
 * (OP-CATALOG.md "no reliable before"). The two warm Config talk tracks say
 * plainly the work ran during preparation (dossier A.5/C.1), rather than
 * pretending it runs now. Talk tracks use OUTWARD capability names — Readiness
 * Evaluation, Configuration, Operations, Assessment — never internal tool ids.
 *
 * duration: live acts = 3 (advance-when-done — the slide holds until the act
 * finishes, then dwells 3 s). The two warm Config slides dwell 7 s so the
 * revealed result card shows briefly.
 */
export const ACTS_SHOWCASE_ROWS = [
  {
    slide: 1,
    talk:
      "Here's the tenant we'll work — a real estate whose MFA policy has sat in report-only for six months, never enforced.",
    feature: "The tenant we'll work",
    tools: 'stacksim',
    mode: 'live',
    op: 'simstack-create',
    duration: 3,
  },
  {
    slide: 2,
    talk:
      'Assessment first: the compliance matrix, the identification-and-authentication gaps, and the SPRS number we start from.',
    feature: 'Assessment — where we start',
    tools: 'eo',
    mode: 'live',
    op: 'eo-review',
    duration: 3,
    params: 'land=sprs',
  },
  {
    slide: 3,
    talk:
      'Configuration compiled the mission plan during setup — exact, dependency-ordered remediation tasks for this tenant. Here is the task list it produced.',
    feature: 'Configuration — the plan compiled',
    tools: 'stamper',
    mode: 'warm',
    op: 'stamper-translate',
    duration: 6,
  },
  {
    slide: 4,
    talk:
      'Now Configuration applies those tasks against the tenant — we start it, watch the first ones land, and move on while it keeps running.',
    feature: 'Configuration — the plan applied',
    tools: 'stamper',
    mode: 'live',
    op: 'stamper-execute',
    duration: 3,
    params: 'peekMs=5000',
  },
  {
    slide: 5,
    talk:
      "We re-assess the remediated tenant and report exactly what moved — never a change the evidence doesn't show.",
    feature: 'Assessment — what moved',
    tools: 'eo',
    mode: 'live',
    op: 'eo-show-change-captured',
    duration: 3,
  },
  {
    slide: 6,
    talk:
      'Readiness Evaluation opens by declaring how we assess — mode, authorization tier, operator, tenant.',
    feature: 'Readiness Evaluation — declared',
    tools: 'muster',
    mode: 'live',
    op: 'muster-connect-tenant',
    duration: 3,
  },
  {
    slide: 7,
    talk:
      'The real read-only discovery walk runs and imports into the app — this tenant, this run, never the demo button.',
    feature: 'Readiness Evaluation — discovery',
    tools: 'muster',
    mode: 'live',
    op: 'muster-auto-analysis',
    duration: 3,
  },
  {
    slide: 8,
    talk:
      'A named human attests the CUI boundary the machine inferred — nothing auto-drafted scores on its own.',
    feature: 'Readiness Evaluation — attested',
    tools: 'muster',
    mode: 'live',
    op: 'muster-consent-and-attest',
    duration: 3,
  },
  {
    slide: 9,
    talk:
      "Watch the question count drop — discovery already answered most, so we don't ask your team again.",
    feature: 'Readiness Evaluation — interview',
    tools: 'muster',
    mode: 'live',
    op: 'muster-adaptive-interview',
    duration: 3,
  },
  {
    slide: 10,
    talk:
      'The SPRS number you report, read from the exported result, plus the mission plan Configuration executes.',
    feature: 'Readiness Evaluation — the number',
    tools: 'muster',
    mode: 'live',
    op: 'muster-generate-sprs-mp',
    duration: 3,
  },
  {
    slide: 11,
    talk:
      'A read-only readiness snapshot — four-value posture, no invented score, a zero-mutation ledger proving it only read.',
    feature: 'Readiness Evaluation — the snapshot',
    tools: 'muster',
    mode: 'live',
    op: 'muster-readiness',
    duration: 3,
  },
  {
    slide: 12,
    talk:
      'Operations: the governed command registry — every tenant action catalogued with its approval tier, executed live.',
    feature: 'Operations — the registry',
    tools: 'ao',
    mode: 'live',
    op: 'ao-registry',
    duration: 3,
  },
  {
    slide: 13,
    talk:
      "The same governed path submits the remediating change — it runs and it's recorded in one motion.",
    feature: 'Operations — the change',
    tools: 'ao',
    mode: 'live',
    op: 'ao-make-change',
    duration: 3,
  },
  {
    slide: 14,
    talk:
      "The Evidence Explorer: the record that command wrote, filed as it ran, beside the assessment's own evidence trail.",
    feature: 'Assessment — the Evidence Explorer',
    tools: 'eo',
    mode: 'live',
    op: 'eo-review',
    duration: 3,
    params: 'land=evidence',
  },
  {
    slide: 15,
    talk:
      'The tenant goes away; the evidence stays. Disposable environment, permanent proof.',
    feature: 'The tenant goes away',
    tools: 'stacksim',
    mode: 'live',
    op: 'simstack-destroy',
    duration: 3,
  },
];

/**
 * GP-DEMO-6 — the PRIME→SUBS readiness deck. The prime contractor's question is
 * not "am I ready" but "is every sub I depend on ready", and it drives the story:
 * the stake and the fear (1-2), the model that removes it (3), ONE sub proving
 * itself live end to end (4-7, the sub's own tenant), then the prime's payoff —
 * every sub on one Red/Amber/Green board (8), and the close (9).
 *
 * Honesty, load-bearing (PLAN-PRIME-SUBS-DEMO.md §3): slides 4-7 are ONE real
 * live evaluation — a read-only walk of a single simulated sub tenant, zero
 * writes, observations not a score. Slide 8's rollup is the REAL surface driven
 * with a LABELED SAMPLE fleet: a Readiness Evaluation reads one tenant, so the
 * board's five subs are illustrative status files (each party name carries
 * `(sample)`), never narrated as this run's tenants. The `muster-rollup` op and
 * its captions say so on stage; the talk track bridges conceptually, never as
 * provenance. Point-of-view switches are spoken: slides 1-3 and 8-9 are the
 * PRIME's seat, 4-7 are inside one SUB.
 *
 * Images are the ces-strategy core-story diagrams already in `demos/images/`.
 * Every slide pins `right-third` so none inherits a stale pane (the pain-story-v2
 * rehearsal review's stale-pane finding). Live slides hold until their op
 * completes, then dwell; staged slides carry the diagram in the pane.
 */
export const PRIME_SUBS_ROWS = [
  {
    slide: 1,
    talk:
      'You are the prime. Your certification, and the award riding on it, depend on subcontractors you ' +
      'have no window into. If one of them handles controlled information and is not ready, that is not ' +
      'their problem — it is yours. The next few minutes are about opening that window: seeing where every ' +
      'sub stands, from evidence, without touching their systems.',
    feature: 'Your award rides on subs you cannot see inside',
    fn: 'Readiness Evaluation, run per subcontractor, rolled up to the prime who carries the flow-down',
    benefit: 'The risk you inherit from your weakest sub stops being invisible',
    diff: 'An objective readiness picture per sub, not a binder of promises you cannot check',
    tools: 'muster',
    mode: 'staged',
    op: '',
    duration: 45,
    image: 'images/ces-core-story-hub-spoke.png',
    rightThird: 'image',
  },
  {
    slide: 2,
    talk:
      'Today the only thing most primes have on a sub is a self-attestation — the sub says it is compliant. ' +
      'A self-attestation is a promise, and it ages the moment it is signed. Worse, if it is wrong, you passed ' +
      'that risk — and the liability — down your own chain. A paper score you cannot verify is not visibility. ' +
      'It is exposure with a date on it.',
    feature: 'Self-attestation is a promise, not proof',
    fn: 'The gap between what a sub reports on paper and what its environment can actually demonstrate',
    benefit: 'You stop carrying a compliance risk you were never able to see or size',
    diff: 'Readiness read from the environment, not a questionnaire answered from memory',
    tools: 'muster',
    mode: 'staged',
    op: '',
    duration: 45,
    image: 'images/ces-core-story-decay.png',
    rightThird: 'image',
    features: ['Self-attestation ages the moment it is signed', 'Unverifiable paper score = inherited liability'].join('\n'),
  },
  {
    slide: 3,
    talk:
      'Here is the model. You hand us your subs. Each one runs a Readiness Evaluation in its own tenant, ' +
      'read-only, and its status reports back to you on your cadence. The sub sees its own instructions and ' +
      'its own status — not your board. You see where every sub stands without asking. Let us go inside one ' +
      'sub and watch it prove itself.',
    feature: 'Hand us your subs — each proves itself, you get the rollup',
    fn: 'Per-sub Readiness Evaluation in the sub’s own tenant, status rolled up to the prime',
    benefit: 'Flow-down stops being an email chase and becomes a live readiness picture',
    diff: 'The sub proves itself in its own environment; the prime sees the aggregate, never the sub’s raw data',
    tools: 'muster',
    mode: 'staged',
    op: '',
    duration: 45,
    image: 'images/ces-core-story-prime-subs-flow.png',
    rightThird: 'image',
  },
  {
    slide: 4,
    talk:
      'This is one subcontractor’s tenant. Readiness Evaluation opens by declaring how it is assessing — ' +
      'the session kind, the authorization tier, who is operating, which tenant. Honesty starts at the manifest: ' +
      'you cannot produce a readiness result here without stating how you obtained it.',
    feature: 'Inside one sub: connect, method declared',
    fn: 'Points Readiness Evaluation at the sub tenant and declares the assessment method up front',
    benefit: 'Every readiness result the sub produces is defensible, because how it was obtained is on the record',
    diff: 'The method is declared before any finding — an assessment, not an opinion',
    tools: 'muster',
    mode: 'live',
    op: 'muster-connect-tenant',
    duration: 20,
    rightThird: 'app',
  },
  {
    slide: 5,
    talk:
      'Now the real walk. It reads the sub’s environment and changes nothing — and we prove that rather than ' +
      'ask you to trust it. Watch the observations arrive. It does not hand us a score, and I will not invent one: ' +
      'this is a readiness picture — what is known, and what is still unresolved — not a finished number.',
    feature: 'The walk — read-only, zero writes, observations arrive',
    fn: 'A presence-based, read-only discovery walk of the sub tenant, imported into the app on its own file seam',
    benefit: 'The prime gets an evidence-backed starting point for this sub, and a zero-write proof it only read',
    diff: 'Observations with an honest unknown count — never a flattering score the sub cannot stand behind',
    tools: 'muster',
    mode: 'live',
    op: 'muster-readiness',
    duration: 30,
    rightThird: 'app',
  },
  {
    slide: 6,
    talk:
      'A machine can infer where this sub’s controlled-information boundary sits. It cannot attest to it. ' +
      'A named person confirms the boundary, and the confirm button stays disabled until that name is filled in. ' +
      'That is the accountability a prime can actually rely on when the flow-down clause has its name on it.',
    feature: 'A named human attests the boundary',
    fn: 'A named human confirms the CUI boundary the machine inferred; nothing auto-drafted scores on its own',
    benefit: 'The prime inherits an attested boundary, not a machine guess it would have to defend later',
    diff: 'Name-gated attestation — an unconfirmed draft never counts as a pass',
    tools: 'muster',
    mode: 'live',
    op: 'muster-consent-and-attest',
    duration: 25,
    rightThird: 'app',
  },
  {
    slide: 7,
    talk:
      'Now the interview — and watch the question count. Because the read-only walk already answered so much, ' +
      'this sub’s team is asked far fewer questions than a cold start would demand. We run it both ways and read ' +
      'the difference straight off the screen. Whatever is left is the set a machine cannot resolve on its own — ' +
      'intent, ownership, where a boundary really sits. That is less time you pull this sub’s people off their ' +
      'real work just to satisfy your flow-down.',
    feature: 'The interview — shrunk by what discovery already knew',
    fn: 'Runs the interview against the imported discovery facts and compares its question count to a cold manual branch',
    benefit: 'The sub answers far fewer questions, so proving readiness up to the prime costs its team less time',
    diff: 'Discovery prunes the interview — the human is asked only what a machine cannot resolve',
    tools: 'muster',
    mode: 'live',
    op: 'muster-adaptive-interview',
    duration: 20,
    rightThird: 'app',
  },
  {
    slide: 8,
    talk:
      'And the number your program office asks about — the SPRS figure — read straight out of this sub’s ' +
      'exported readiness result, not retyped and not scraped off a screen. Be precise about what this is: ' +
      'the sub’s own reported readiness number, the one that flows up to you now. A formal third-party ' +
      'assessment is a separate, later step — this is the self-reported figure, traceable to the artifact the ' +
      'tool produced. Now step back to your seat, because the real question was never one sub.',
    feature: 'The number that flows up — the sub’s reported SPRS',
    fn: 'Finishes the interview and reads the self-reported SPRS figure from the exported readiness payload',
    benefit: 'The number the sub reports up is the one the tool computed and can be traced to its source, not a claim',
    diff: 'Read from the exported artifact, never the DOM — and named honestly as self-reported, not an assessor’s score',
    tools: 'muster',
    mode: 'live',
    op: 'muster-generate-sprs-mp',
    duration: 25,
    rightThird: 'app',
  },
  {
    slide: 9,
    talk:
      'This is your board. Every sub, one view, Red / Amber / Green — each row sourced from a sub’s own ' +
      'evaluation, on your cadence. The subs on screen are sample status files, so you can see how the board ' +
      'fills in — not results pulled from this run. You see where each one stands without sending a single email, ' +
      'and without touching their systems.',
    feature: 'The prime’s seat: every sub, one RAG board',
    fn: 'Imports each sub’s status file into the real rollup surface and lands Red/Amber/Green per sub',
    benefit: 'The prime reads the whole team’s readiness at a glance, and knows exactly which subs need attention',
    diff: 'The real rollup surface, driven live — objective, continuous, and honest about which inputs are illustrative',
    tools: 'muster',
    mode: 'live',
    op: 'muster-rollup',
    duration: 35,
    rightThird: 'app',
  },
  {
    slide: 10,
    talk:
      'Your flow-down never paused. What changed is that you can now see where every sub stands — from evidence, ' +
      'without touching their systems, without a promise you have to take on faith. Start with your readiness ' +
      'picture, sub by sub, and let the board tell you where to spend the next dollar.',
    feature: 'Your flow-down didn’t pause',
    fn: 'A continuous, evidence-backed readiness picture of every subcontractor, rolled up to the prime',
    benefit: 'The prime carries the flow-down with visibility instead of faith, and spends remediation where it counts',
    diff: 'Readiness proven in each sub’s own environment and rolled up — never a binder of self-attestations',
    tools: 'muster',
    mode: 'staged',
    op: '',
    duration: 45,
    image: 'images/ces-core-story-promises-kept.png',
    rightThird: 'image',
  },
];

/** XML text escape for inline-string cell values. */
export function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 0-based column index -> spreadsheet column letters (0 -> A, 26 -> AA). */
export function columnLetter(index) {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** One `<c>` element. Numbers stay numeric; blanks are omitted entirely. */
function cellXml(rowNumber, colIndex, value) {
  if (value === '' || value === null || value === undefined) return '';
  const ref = `${columnLetter(colIndex)}${rowNumber}`;
  if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

/** Build `xl/worksheets/sheet1.xml` from a header row plus data rows. */
export function sheetXml(header, dataRows) {
  const rows = [header, ...dataRows];
  const body = rows
    .map((cells, i) => {
      const rowNumber = i + 1;
      const cs = cells.map((v, c) => cellXml(rowNumber, c, v)).join('');
      return `<row r="${rowNumber}">${cs}</row>`;
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheetData>${body}</sheetData></worksheet>`
  );
}

/** The four fixed package parts. Sheet name is the deck's sheet name. */
export function packageParts(sheetName) {
  return {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
    'xl/workbook.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>',
  };
}

/**
 * Serialize a header + rows into .xlsx bytes. Every zip key is a literal
 * forward-slash path (mechanic 1 above).
 */
export function buildXlsx(header, dataRows, sheetName = 'demo') {
  const files = {};
  for (const [name, xml] of Object.entries(packageParts(sheetName))) {
    files[name] = strToU8(xml);
  }
  files['xl/worksheets/sheet1.xml'] = strToU8(sheetXml(header, dataRows));
  // level 0 (store) + a fixed mtime keep the fixture byte-stable across runs.
  // The epoch itself is rejected — zip's DOS timestamp only spans 1980-2099,
  // and fflate reads the LOCAL year, so the date is built with the local
  // constructor (a UTC 1980-01-01 lands in 1979 west of Greenwich).
  return zipSync(files, { level: 0, mtime: new Date(2020, 0, 1) });
}

/**
 * A deck's authored rows as bare arrays, in COLUMNS order. `image` is emitted
 * from `r.image` when a row sets it (a deck path relative to `demos/`, e.g.
 * `images/foo.png`); rows without the key keep the empty cell they always had,
 * so every previously-committed deck stays byte-identical.
 */
export function sheetRowsFor(rows) {
  return rows.map((r) => [
    r.slide,
    r.talk,
    r.feature,
    r.fn,
    r.benefit,
    r.diff,
    r.tools,
    r.mode,
    r.op,
    r.duration,
    r.image ?? '',
    r.features ?? '',
    r.rightThird ?? '',
  ]);
}

/** Back-compat alias — the starter deck's rows specifically. */
export function starterSheetRows() {
  return sheetRowsFor(STARTER_ROWS);
}

export function buildStarterDeck() {
  return buildXlsx(COLUMNS, starterSheetRows(), 'ces-overview');
}

export function buildPainStoryDeck() {
  return buildXlsx(COLUMNS, sheetRowsFor(PAIN_STORY_ROWS), 'ces-pain-story');
}

export function buildStreamguiProofDeck() {
  return buildXlsx(COLUMNS, sheetRowsFor(STREAMGUI_PROOF_ROWS), 'streamgui-proof');
}

export function buildStreamguiExecuteWarmDeck() {
  return buildXlsx(COLUMNS, sheetRowsFor(STREAMGUI_EXECUTE_WARM_ROWS), 'streamgui-execute-warm');
}

/**
 * acts-showcase rows as bare arrays, in `ACTS_SHOWCASE_COLUMNS` order: the
 * shared 13-cell base from `sheetRowsFor` (untouched, so the committed decks
 * stay byte-identical) with a 14th `params` cell appended.
 */
export function actsShowcaseSheetRows() {
  return sheetRowsFor(ACTS_SHOWCASE_ROWS).map((cells, i) => [
    ...cells,
    ACTS_SHOWCASE_ROWS[i].params ?? '',
  ]);
}

export function buildActsShowcaseDeck() {
  return buildXlsx(ACTS_SHOWCASE_COLUMNS, actsShowcaseSheetRows(), 'acts-showcase');
}

export function buildPrimeSubsDeck() {
  return buildXlsx(COLUMNS, sheetRowsFor(PRIME_SUBS_ROWS), 'ces-prime-subs');
}

/**
 * Every deck this script emits. The FIRST entry is the default single-argument
 * target, because `node make-demo-xlsx.mjs <outPath>` has always meant
 * "ces-overview, here" and the round-trip test invokes it that way.
 */
export const DECKS = [
  { id: 'ces-overview', rows: STARTER_ROWS, build: buildStarterDeck },
  { id: 'ces-pain-story', rows: PAIN_STORY_ROWS, build: buildPainStoryDeck },
  { id: 'streamgui-proof', rows: STREAMGUI_PROOF_ROWS, build: buildStreamguiProofDeck },
  { id: 'streamgui-execute-warm', rows: STREAMGUI_EXECUTE_WARM_ROWS, build: buildStreamguiExecuteWarmDeck },
  { id: 'acts-showcase', rows: ACTS_SHOWCASE_ROWS, build: buildActsShowcaseDeck },
  { id: 'ces-prime-subs', rows: PRIME_SUBS_ROWS, build: buildPrimeSubsDeck },
];

/** One deck to disk, plus the line the operator reads back. */
function writeDeck(deck, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, deck.build());
  const slides = new Set(deck.rows.map((r) => r.slide)).size;
  const seconds = deck.rows.reduce((n, r) => n + (typeof r.duration === 'number' ? r.duration : 0), 0);
  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  console.log(
    `wrote ${outPath} — ${slides} slide(s) across ${deck.rows.length} row(s), ${seconds}s declared (${mmss})`,
  );
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..');
  const argv = process.argv.slice(2);

  let deckId;
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--deck') {
      deckId = argv[i + 1];
      i += 1;
    } else {
      positional.push(argv[i]);
    }
  }

  // No arguments at all regenerates the whole demos/ directory — that is the
  // one command the gate runs, so both decks can never drift apart on disk.
  if (deckId === undefined && positional.length === 0) {
    for (const deck of DECKS) writeDeck(deck, path.join(repoRoot, 'demos', `${deck.id}.xlsx`));
    return;
  }

  const deck = DECKS.find((d) => d.id === (deckId ?? DECKS[0].id));
  if (!deck) {
    console.error(`unknown deck "${deckId}" — expected one of ${DECKS.map((d) => d.id).join(', ')}`);
    process.exitCode = 2;
    return;
  }
  const outPath = positional[0]
    ? path.resolve(positional[0])
    : path.join(repoRoot, 'demos', `${deck.id}.xlsx`);
  writeDeck(deck, outPath);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();

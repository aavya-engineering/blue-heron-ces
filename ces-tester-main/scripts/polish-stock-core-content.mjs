// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import fs from 'node:fs';

const corePath = 'C:/Users/mhsut/DevProjects/ces/ces-strategy/DEMOS/system/ces-core-story/ces-core-story.py';
const diagramsPath = 'C:/Users/mhsut/DevProjects/ces/ces-strategy/DEMOS/system/ces-core-story/make_diagrams.py';

function replaceExactly(path, replacements) {
  let text = fs.readFileSync(path, 'utf8');
  for (const [before, after] of replacements) {
    if (text.includes(before)) text = text.replace(before, after);
    else if (!text.includes(after)) throw new Error(`Expected source text was not found in ${path}: ${before.slice(0, 80)}`);
  }
  fs.writeFileSync(path, text);
}

replaceExactly(corePath, [
  [
    '"feature": "Where your cost actually lives " + EM + " and how it comes off",',
    '"feature": "Where compliance effort collects " + EM + " and how to reduce the rework",',
  ],
  [
    '"function": "Where your money actually goes, measured against the Department\'s own score weights " + EM + " and the five cost drivers matched to what removes each one.",',
    '"function": "Where compliance effort collects: scope, hand-authored documentation, evidence rebuilt after the fact, and assessment preparation treated as a separate project.",',
  ],
  [
    '"benefit": "You see that your spend sits in the tier that moves your risk least " + EM + " and that the expensive part is paperwork you can stop authoring, not protection you\'d have to give up.",',
    '"benefit": "You can reduce the manual work around compliance while preserving the protections and human decisions that still matter.",',
  ],
  [
    '"differentiator": "Cost comes off your paperwork, not your protection: every requirement stays in force; what changes is what it costs you to prove it.",',
    '"differentiator": "CES reduces rework around compliance; the required protections, customer decisions, and assessment relationship remain yours.",',
  ],
  [
    '"One-third of the requirements carry over half the score weight " + EM + " and they\'re mostly settings",\n                "The prove tier: over a third of the requirements, about a seventh of the weight, most of your spend",\n                "Becoming assessable costs you far more than the assessment",\n                "Scope is the multiplier; the system security plan and evidence archaeology are the bill",\n                "Each one comes off without touching a single protective control",',
    '"Scope expands every obligation and artifact",\n                "Hand-authored plans and document updates",\n                "Evidence rebuilt after the work is done",\n                "Assessment preparation treated as a separate project",\n                "Reduce rework without reducing required protection",',
  ],
  [
    '"show": "The two tier bars first " + EM + " let the 57% / 14% contrast land. Then walk the five rows top to bottom, left column then right.",',
    '"show": "Use the five rows as a practical diagnosis: scope, documents, evidence, assessment preparation, then the work that can be removed.",',
  ],
  [
    '"watchouts": "Numbers allowed here: one-third, 57%, 37%, 14%, \'about 36\', \'41\' (all in the released RFI sentences). Never \'33%\'. No dollar figures on the slide or in the talk " + EM + " the assessment-vs-total ratio is spoken as \'roughly a sixth\', attributed to a public analysis, not to us. Do not claim hours or dollars saved by CES. Row 4: CES builds the package; it does not touch the assessor relationship.",',
    '"watchouts": "Do not introduce unsupported cost, time, or score-weight claims. CES can reduce rework around documentation and evidence; it does not remove customer decisions, the assessment relationship, or required protection.",',
  ],
  [
    '"differentiator": "Your score, your plan, your plan of action and the assessor\'s view come from one record, so they cannot contradict each other " + EM + " and you never reconcile them.",',
    '"differentiator": "One evidence spine keeps readiness outputs, plans, changes and determinations traceable to the same source — so reconciliation is deliberate, not a separate project.",',
  ],
]);

replaceExactly(diagramsPath, [
  [
    '("Continuously assessment-ready", "current determinations and supporting evidence", "Assessment"),',
    '("Continuously assessment-ready", "current determinations and supporting evidence", "Evidence spine"),',
  ],
]);

const promises = [
  ['A clear picture of where you stand', 'Recorded findings, with human confirmation where needed', 'Readiness Evaluation'],
  ['Compliant quickly, with low impact', 'Validated plans, controlled execution, reviewed results', 'Configuration'],
  ['Kept compliant, with low impact', 'Governed routine changes with recorded outcomes', 'Operations'],
  ['Continuously assessment-ready', 'Current determinations and supporting evidence', 'Evidence spine'],
  ['A smooth, non-disruptive assessment', 'Organized outputs for a focused review', 'Assessment'],
];
const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
function promiseGraphic(checked) {
  const rows = promises.map(([title, detail, tag], index) => {
    const y = 122 + index * 126;
    return `<rect x="44" y="${y}" width="42" height="42" rx="6" fill="${checked ? '#f5b74a' : '#172334'}" stroke="#f5b74a" stroke-width="3"/>` +
      (checked ? `<text x="65" y="153" text-anchor="middle" font-size="30" font-family="Arial, sans-serif" font-weight="700" fill="#0f1722">✓</text>` : '') +
      `<text x="112" y="${y + 17}" font-size="25" font-family="Arial, sans-serif" font-weight="700" fill="#e8edf2">${escape(title)}</text>` +
      `<text x="112" y="${y + 41}" font-size="16" font-family="Arial, sans-serif" fill="#9badc1">${escape(detail)}</text>` +
      `<rect x="870" y="${y + 8}" width="278" height="28" rx="14" fill="#172334" stroke="#33455b"/>` +
      `<text x="1009" y="${y + 28}" text-anchor="middle" font-size="13" font-family="Arial, sans-serif" font-weight="700" letter-spacing="1.4" fill="#c8d4df">${escape(tag.toUpperCase())}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="850" viewBox="0 0 1200 850"><rect width="1200" height="850" rx="18" fill="#101923"/><text x="44" y="58" font-size="17" font-family="Arial, sans-serif" font-weight="700" letter-spacing="2" fill="#f5b74a">FIVE PROMISES — WITH A PRACTICAL PATH BEHIND EACH ONE</text>${rows}<line x1="44" y1="776" x2="1156" y2="776" stroke="#33455b"/><text x="44" y="812" font-size="16" font-family="Arial, sans-serif" fill="#9badc1">Your readiness picture, decisions, and evidence remain yours.</text></svg>`;
}
const imageDir = 'C:/Users/mhsut/DevProjects/ces/ces-strategy/DEMOS/system/ces-core-story/out/images';
fs.writeFileSync(`${imageDir}/ces-core-story-promises.svg`, promiseGraphic(false));
fs.writeFileSync(`${imageDir}/ces-core-story-promises-kept.svg`, promiseGraphic(true));

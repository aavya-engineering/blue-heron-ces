// Gap closure NS-1b tests (GAP-CLOSURE-PLAN.md §4 G-NS NS-1; §5 V80; §7 GD-b): node --test scripts/gap-ns1.test.mjs
// The V80 judge over synthetic snapshots, reviews, mints and EC items (the shapes ces-eo's ControlAssessor, review-router,
// ApproverTokenMintLog and ces-ec write), and the verify.mjs wiring by text. Nothing in the workspace is read or written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeV80, V80_NO_REVIEWS } from './verify-gap.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const H = 'c'.repeat(64);
const NS = 'AT.L2-3.2.3';
const objectivesRef = { objectives: [{ controlId: NS, objectiveId: `${NS}[a]` }, { controlId: NS, objectiveId: `${NS}[b]` }, { controlId: 'AC.L1-3.1.1', objectiveId: 'AC.L1-3.1.1[a]' }] };
const UPLOADER = { subjectId: 'u1', upn: 'Uploader.One@t.example.test' };
const REVIEWER = 'reviewer.two@t.example.test';
const item = (cid, sha = H, uploadedBy = UPLOADER) => ({ itemId: `item-${cid}`, controlIds: [cid], sha256: sha, uploadedBy });
const ecItems = [item(NS), item('AC.L1-3.1.1', 'e'.repeat(64))];
const mints = [{ mintId: 'jti-1', approver: { upn: REVIEWER } }];
const review = (objectiveId, over = {}) => ({ reviewId: `r-${objectiveId}`, tenantSlug: 's', controlId: NS, objectiveId, artifactHash: H, verdict: 'met', reviewer: { upn: REVIEWER, subjectId: 'x', tokenId: 'jti-1' }, ...over });
const ctl = (control_id, status, statusRationale) => ({ control_id, status, statusRationale });
const stackMet = ctl('AC.L1-3.1.1', 'met', 'Tier 2 (live read) decides: discovery/exists');
const snap = (nsStatus, nsRationale) => ({ snapshotId: 's1', controls: [stackMet, ctl(NS, nsStatus, nsRationale)] });
const gdbMet = 'GD-b (document review of every objective; no stack source has an opinion) decides: ...';
const base = (over = {}) => ({ snapshot: snap('not_assessed', 'No source has an opinion: ec_capture/no_query'), reviews: [], mints, ecItems, objectivesRef, ...over });

test('V80 passes with the fixed detail when no reviews are recorded and nothing is credited by review; the probe is reported', () => {
  const r = judgeV80(base());
  assert.equal(r.pass, true, r.detail);
  assert.ok(r.detail.startsWith(V80_NO_REVIEWS), r.detail);
  assert.equal(V80_NO_REVIEWS, 'no reviews recorded; no non-stack control credited by review');
  assert.match(r.detail, /probe: 2 EC item\(s\), 2 control\(s\) with an unreviewed upload, none credited by review \(AT\.L2-3\.2\.3 not_assessed, AC\.L1-3\.1\.1 met \(Tier 2\)\)/);
});

test('V80 fails when no reviews are recorded but a control is credited by review', () => {
  const r = judgeV80(base({ snapshot: snap('met', gdbMet) }));
  assert.equal(r.pass, false);
  assert.match(r.detail, /no reviews recorded but 1 control\(s\) credited by review: AT\.L2-3\.2\.3/);
});

test('V80 probe fails when an unreviewed upload\'s control is met without a stack tier', () => {
  const r = judgeV80(base({ snapshot: snap('met', 'Something else decides') }));
  assert.equal(r.pass, false);
  assert.match(r.detail, /probe: upload with no review not left uncredited: AT\.L2-3\.2\.3 met without a stack tier, store decision or review/);
  assert.match(judgeV80(base({ ecItems: [] })).detail, /the run has no EC item/);
});

// PKG-2 (NS-3b, D-2): EO's personnel / training stores decide PS / AT snapshot statuses ("Store precedence (...)").
const storeMoved = 'Store precedence (personnel store, ledger precedence): personnel screening from the organisation\'s records: ...; was not_assessed (No source has an opinion)';
const PS = 'PS.L2-3.9.1';
const PROBE = 'CA.L2-3.12.4';
const psItems = [item(PS, 'f'.repeat(64)), item(PROBE, 'a'.repeat(64))];
const storeSnap = (psStatus, psRationale, probe = ctl(PROBE, 'not_assessed', 'No source has an opinion')) => ({ snapshotId: 's1', controls: [stackMet, ctl(PS, psStatus, psRationale), probe] });
const probeDecl = { artifact: 'probe-unreviewed-upload', control_id: PROBE, expect: 'not_assessed' };

test('V80 (PKG-2): a PS / AT control the store decides is a deciding source for an unreviewed upload, shown as "<store> store"', () => {
  for (const status of ['met', 'not_met']) {
    const r = judgeV80(base({ snapshot: storeSnap(status, storeMoved), ecItems: psItems, probeDecl }));
    assert.equal(r.pass, true, r.detail);
    assert.match(r.detail, new RegExp(`PS\\.L2-3\\.9\\.1 ${status} \\(personnel store\\)`));
    assert.match(r.detail, /designated probe CA\.L2-3\.12\.4 not_assessed \(an unreviewed upload credits nothing by itself\)/);
  }
  // The store prefix counts only at the start of the rationale and only on PS / AT controls.
  const tail = judgeV80(base({ snapshot: storeSnap('met', `Something else; ${storeMoved}`), ecItems: psItems }));
  assert.equal(tail.pass, false);
  assert.match(tail.detail, /PS\.L2-3\.9\.1 met without a stack tier, store decision or review/);
  const notPs = judgeV80(base({ snapshot: { snapshotId: 's', controls: [stackMet, ctl(PROBE, 'met', storeMoved)] }, ecItems: [item(PROBE)] }));
  assert.equal(notPs.pass, false);
  assert.match(notPs.detail, /CA\.L2-3\.12\.4 met without a stack tier, store decision or review/);
  // A store decision is never a review credit: "credited by review" still keys on GD-b only.
  assert.match(judgeV80(base({ snapshot: storeSnap('met', storeMoved), ecItems: psItems })).detail, /^no reviews recorded; no non-stack control credited by review/);
});

test('V80 (PKG-2): the designated probe must stay not_assessed with no deciding source and an unreviewed upload', () => {
  const ok = judgeV80(base({ snapshot: storeSnap('met', storeMoved), ecItems: psItems, probeDecl }));
  assert.equal(ok.pass, true, ok.detail);
  const met = judgeV80(base({ snapshot: storeSnap('met', storeMoved, ctl(PROBE, 'met', 'Tier 2 (live read) decides')), ecItems: psItems, probeDecl }));
  assert.equal(met.pass, false);
  assert.match(met.detail, /the designated probe CA\.L2-3\.12\.4 is met \(Tier 2\), want not_assessed with no deciding source/);
  const missing = judgeV80(base({ snapshot: storeSnap('met', storeMoved), ecItems: [item(PS, 'f'.repeat(64))], probeDecl }));
  assert.equal(missing.pass, false);
  assert.match(missing.detail, /the designated probe CA\.L2-3\.12\.4 has no unreviewed upload in the run/);
  const reviewed = judgeV80(base({ snapshot: storeSnap('met', storeMoved), ecItems: psItems, probeDecl, reviews: [review(`${NS}[a]`, { controlId: PROBE, objectiveId: `${PROBE}[a]`, artifactHash: 'a'.repeat(64) })] }));
  assert.equal(reviewed.pass, false);
  assert.match(reviewed.detail, /the designated probe CA\.L2-3\.12\.4 has no unreviewed upload/);
});

test('V80 (PKG-2) over the package customers: every scenario declares its probe (FD-17: S1 MP.L1-3.8.3, the rest CA.L2-3.12.4) verify.mjs passes', () => {
  const probeOf = { 's1-mach': 'MP.L1-3.8.3', 's2-eng': PROBE, 's3-def': PROBE, 'muster-partial': PROBE };
  for (const slug of ['s1-mach', 's2-eng', 's3-def', 'muster-partial']) {
    const doc = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'customers', slug, 'document-reviews.json'), 'utf8'));
    assert.deepEqual({ control_id: doc.probe.control_id, expect: doc.probe.expect }, { control_id: probeOf[slug], expect: 'not_assessed' }, slug);
  }
  const src = fs.readFileSync(path.join(HERE, 'verify.mjs'), 'utf8');
  assert.match(src, /objectivesRef: exists\(objPath\) \? readJson\(objPath\) : null, probeDecl,/);
});

test('V80 passes when a credited control has a countable met review per objective from a non-uploader mint holder', () => {
  const r = judgeV80(base({ snapshot: snap('met', gdbMet), reviews: [review(`${NS}[a]`), review(`${NS}[b]`)], otherTenantReviews: 1 }));
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /2 review\(s\) \(2 countable\), 1 under other tenants \(not judged\); 1 control\(s\) credited by review/);
  assert.match(r.detail, /probe: 2 EC item\(s\), 1 control\(s\) with an unreviewed upload/);
});

test('V80 fails a credited control whose review is missing, by the uploader, without a mint, or on an unknown uploader', () => {
  const met = (reviews, items = ecItems, m = mints) => judgeV80(base({ snapshot: snap('met', gdbMet), reviews, ecItems: items, mints: m }));
  const missing = met([review(`${NS}[a]`)]);
  assert.equal(missing.pass, false);
  assert.match(missing.detail, /AT\.L2-3\.2\.3: no countable met review for AT\.L2-3\.2\.3\[b\]/);
  const self = met([review(`${NS}[a]`), review(`${NS}[b]`, { reviewer: { upn: UPLOADER.upn.toUpperCase(), subjectId: 'u1', tokenId: 'jti-1' } })]);
  assert.equal(self.pass, false);
  assert.match(self.detail, /reviewer is the uploader/);
  const noMint = met([review(`${NS}[a]`), review(`${NS}[b]`)], ecItems, []);
  assert.equal(noMint.pass, false);
  assert.match(noMint.detail, /no approver-token mint/);
  const unknown = met([review(`${NS}[a]`), review(`${NS}[b]`)], [item(NS, H, null)]);
  assert.equal(unknown.pass, false);
  assert.match(unknown.detail, /uploader unknown/);
  const negative = met([review(`${NS}[a]`), review(`${NS}[b]`), review(`${NS}[b]`, { reviewId: 'r-neg', verdict: 'not_met' })]);
  assert.equal(negative.pass, false);
  assert.match(negative.detail, /met despite countable not_met review/);
});

test('V80 fails without its inputs', () => {
  assert.match(judgeV80(base({ snapshot: null })).detail, /no stored snapshot/);
  assert.match(judgeV80(base({ reviews: null, reviewsError: 'locked' })).detail, /document reviews not read \(locked\)/);
  assert.match(judgeV80(base({ ecItems: null })).detail, /EC items not read/);
  assert.match(judgeV80(base({ objectivesRef: null })).detail, /assessment-objectives/);
});

test('verify.mjs wires V80 through judgeV80 with the stored snapshot, ces.db reviews and mints, and the EC items', () => {
  const src = fs.readFileSync(path.join(HERE, 'verify.mjs'), 'utf8');
  assert.match(src, /check\('V80', [^\n]*gapmod\.judgeV80\(\{/);
  assert.match(src, /eo_document_reviews/);
  assert.match(src, /eo_approver_token_mints/);
  assert.match(src, /'EvidenceCollector', 'storage', slug, 'items'/);
  assert.match(src, /snapshot: storedSnapshot/);
});

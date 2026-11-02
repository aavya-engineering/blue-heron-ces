// Synthetic-customer W5 cycle 3 (P11) tests: node --test scripts/build-customer-records.test.mjs
// Reads customers/s1-mach/customer.json and customers/s1-mach/records/ (read only); writes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRecords, scanRecords, MARKER, RECORD_SCHEMA, AWARENESS, INSIDER } from './build-customer-records.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(HERE, '..', 'customers', 's1-mach');
const customer = () => JSON.parse(fs.readFileSync(path.join(DIR, 'customer.json'), 'utf8'));

// The 16 S1 controls whose narrative carries "the <kind> records that evidence this control" (GAPS-s1-mach rows, content-gap).
const GAP_CONTROLS = [
  'AT.L2-3.2.2', 'AU.L2-3.3.8', 'AU.L2-3.3.9', 'IR.L2-3.6.2', 'IR.L2-3.6.3', 'MA.L2-3.7.1', 'MA.L2-3.7.2', 'MA.L2-3.7.3', 'MA.L2-3.7.6',
  'PE.L1-3.10.1', 'PE.L1-3.10.3', 'PE.L1-3.10.4', 'PE.L1-3.10.5', 'PE.L2-3.10.2', 'PE.L2-3.10.6', 'RA.L2-3.11.1',
];

test('determinism: the same customer.json gives byte-identical files and the same hashes', () => {
  const a = buildRecords(customer());
  const b = buildRecords(customer());
  assert.equal(a.catalogText, b.catalogText);
  assert.deepEqual(a.files.map((f) => [f.file, f.sha256]), b.files.map((f) => [f.file, f.sha256]));
  for (const f of a.files) assert.equal(createHash('sha256').update(f.text, 'utf8').digest('hex'), f.sha256);
});

test('a changed history anchor changes every dated record hash (dates derive from the anchor only)', () => {
  const c = customer();
  const a = buildRecords(c);
  const b = buildRecords({ ...c, history_anchor: '2026-11-01T00:00:00.000Z' });
  for (const f of a.files) assert.notEqual(f.sha256, b.files.find((x) => x.file === f.file).sha256, f.file);
});

test('the committed records/ folder equals a fresh build (run the generator after changing customer.json)', () => {
  const built = buildRecords(customer());
  for (const f of built.files) assert.equal(fs.readFileSync(path.join(DIR, 'records', f.file), 'utf8'), f.text, f.file);
  assert.equal(fs.readFileSync(path.join(DIR, 'records', 'catalog.json'), 'utf8'), built.catalogText);
});

test('catalog: one item per file, sha256 / size / rows / period agree with the file, every item tagged', () => {
  const built = buildRecords(customer());
  assert.equal(built.catalog.items.length, built.files.length);
  for (const item of built.catalog.items) {
    const f = built.files.find((x) => x.file === item.file);
    const doc = JSON.parse(f.text);
    assert.equal(item.sha256, f.sha256);
    assert.equal(item.size_bytes, Buffer.byteLength(f.text, 'utf8'));
    assert.equal(item.rows, doc.rows.length);
    assert.ok(item.rows > 0, item.file);
    assert.deepEqual(item.period, doc.period);
    assert.ok(item.control_ids.length > 0, item.file);
    assert.equal(item.media_type, 'application/json');
    assert.equal(item.collected_at.slice(0, 10), doc.period.to);
    assert.equal(doc.schema, RECORD_SCHEMA);
    assert.equal(doc.marker, MARKER);
    assert.equal(doc.record_kind, item.record_kind);
  }
});

test('every one of the 16 gap controls is tagged by at least one item; personnel and training items exist for appendices F / G', () => {
  const { catalog } = buildRecords(customer());
  const tagged = new Set(catalog.items.flatMap((i) => i.control_ids));
  assert.deepEqual(GAP_CONTROLS.filter((c) => !tagged.has(c)), []);
  const kinds = new Set(catalog.items.map((i) => i.record_kind));
  for (const k of ['training_completion', 'personnel_screening', 'personnel_lifecycle']) assert.ok(kinds.has(k), k);
});

test('roster consistency: names are roster names; training mirrors the simulator (licensed = staff minus the disabled leaver)', () => {
  const c = customer();
  const roster = new Set(c.accounts.map((a) => a.display_name));
  const built = buildRecords(c);
  for (const f of built.files) {
    for (const r of JSON.parse(f.text).rows) {
      for (const k of ['name', 'reviewer', 'signed_off_by', 'performed_by', 'verified_by', 'host', 'escort', 'by', 'owner', 'approved_by', 'facilitator', 'reviewed_by', 'authorised_by', 'maintainer']) {
        if (r[k] === undefined) continue;
        assert.ok(roster.has(r[k]) || /^visitor VIS-\d{4}-\d{3}$/.test(r[k]) || /^contractor technician CT-[A-Z]{3}-\d{2}$/.test(r[k]), `${f.file} ${k} ${r[k]}`);
      }
    }
  }
  const staff = c.accounts.filter((a) => a.kind === 'staff');
  const disabled = staff.find((a) => a.lifecycle?.event === 'leaver' && a.lifecycle.account_enabled === false);
  const aw = JSON.parse(built.files.find((f) => f.file === 'training-awareness.json').text);
  assert.equal(aw.rows.length, staff.length - 1);
  assert.ok(!aw.rows.some((r) => r.person_id === disabled.person_id));
  assert.ok(aw.rows.every((r) => r.course === AWARENESS));
  assert.ok(JSON.parse(built.files.find((f) => f.file === 'training-insider-threat.json').text).rows.every((r) => r.course === INSIDER));
  const lc = JSON.parse(built.files.find((f) => f.file === 'personnel-lifecycle.json').text);
  const leavers = staff.filter((a) => a.lifecycle?.event === 'leaver').map((a) => a.person_id).sort();
  assert.deepEqual([...new Set(lc.rows.filter((r) => r.event === 'termination').map((r) => r.person_id))].sort(), leavers);
  // The leaver still enabled in the tenant has the account-disable step open (the AO A-02 target), not done.
  const open = staff.find((a) => a.lifecycle?.event === 'leaver' && a.lifecycle.account_enabled === true);
  assert.equal(lc.rows.find((r) => r.person_id === open.person_id && /account disabled/.test(r.step)).status, 'open');
});

test('dated inside the history: audit reviews are 13 weekly sign-offs; the risk assessment falls inside the 90-day window', () => {
  const c = customer();
  const anchor = c.history_anchor.slice(0, 10);
  const built = buildRecords(c);
  const doc = (f) => JSON.parse(built.files.find((x) => x.file === f).text);
  const au = doc('audit-log-reviews.json');
  assert.equal(au.rows.length, 13);
  for (let i = 1; i < 13; i++) assert.equal((Date.parse(au.rows[i].date) - Date.parse(au.rows[i - 1].date)) / 86400000, 7);
  const ra = doc('risk-assessment.json');
  const age = (Date.parse(anchor) - Date.parse(ra.period.to)) / 86400000;
  assert.ok(age > 0 && age < 90, `risk assessment ${age} days before the anchor`);
  for (const f of built.files) assert.ok(doc(f.file).period.to < anchor, `${f.file} ends before the anchor`);
});

test('denylist and workstation-path scan is clean', async () => {
  assert.deepEqual(await scanRecords(buildRecords(customer())), []);
});

test('W5c4 follow-up (REC-W4c1): the three new kinds carry the control tags and kinds for the EO coverage rows', () => {
  const c = customer();
  const built = buildRecords(c);
  const item = (f) => built.catalog.items.find((i) => i.file === f);
  const doc = (f) => JSON.parse(built.files.find((x) => x.file === f).text);
  assert.deepEqual([item('training-incident-response.json').record_kind, item('training-incident-response.json').control_ids], ['training_completion', ['IR.L2-3.6.1']]);
  assert.deepEqual([item('maintenance-personnel.json').record_kind, item('maintenance-personnel.json').control_ids], ['maintenance_personnel_list', ['MA.L2-3.7.6']]);
  assert.deepEqual([item('enclave-access-list.json').record_kind, item('enclave-access-list.json').control_ids], ['enclave_access_authorisation_list', ['PE.L1-3.10.1']]);
  // IR training: the tabletop's participants plus every admin owner, all completed inside the 90-day window.
  const ir = doc('training-incident-response.json');
  const tabletop = doc('incident-response-test.json').rows[0].participants.map((p) => p.replace(/ \(.*$/, ''));
  for (const n of tabletop) assert.ok(ir.rows.some((r) => r.name === n), n);
  const anchor = Date.parse(c.history_anchor);
  for (const r of ir.rows) { const age = (anchor - Date.parse(r.date)) / 86400000; assert.ok(age > 0 && age < 90 && r.status === 'completed', r.name); }
  // Maintenance list: the two contractors S1 uses, each row with the escort rule; internal maintainers need none.
  const ma = doc('maintenance-personnel.json');
  const orgs = [...new Set(ma.rows.filter((r) => r.type === 'contractor').map((r) => r.organisation))];
  assert.equal(orgs.length, 2);
  assert.ok(ma.rows.filter((r) => r.type === 'contractor').every((r) => /escorted and supervised at all times/.test(r.escort_rule)));
  assert.ok(ma.rows.some((r) => r.organisation === 'Thistledown Workstation Service (FICTIONAL)'), 'the vendor in the visitor and maintenance logs');
  // Enclave access list = exactly the people the badge log grants unescorted entry, with a review date.
  const pe = doc('enclave-access-list.json');
  const granted = new Set(doc('physical-access-log.json').rows.filter((r) => r.result === 'granted').map((r) => r.name));
  assert.deepEqual(new Set(pe.rows.map((r) => r.name)), granted);
  assert.ok(pe.rows.every((r) => r.reviewed_by && r.next_review > r.date));
});

// ---------------------------------------------------------------- S2 (synthetic-customer W6)
const DIR2 = path.resolve(HERE, '..', 'customers', 's2-eng');
const customer2 = () => JSON.parse(fs.readFileSync(path.join(DIR2, 'customer.json'), 'utf8'));

test('S2: deterministic, and the committed records/ folder equals a fresh build', () => {
  const a = buildRecords(customer2());
  const b = buildRecords(customer2());
  assert.equal(a.catalogText, b.catalogText);
  for (const f of a.files) assert.equal(fs.readFileSync(path.join(DIR2, 'records', f.file), 'utf8'), f.text, f.file);
  assert.equal(fs.readFileSync(path.join(DIR2, 'records', 'catalog.json'), 'utf8'), a.catalogText);
  assert.equal(a.catalog.slug, 's2-eng');
});

test('S2: the same record kinds as S1 tag the 16 gap controls; names are S2 roster names; training mirrors the S2 simulator', () => {
  const c = customer2();
  const built = buildRecords(c);
  assert.deepEqual(built.catalog.items.map((i) => i.record_kind).sort(), buildRecords(customer()).catalog.items.map((i) => i.record_kind).sort());
  const tagged = new Set(built.catalog.items.flatMap((i) => i.control_ids));
  assert.deepEqual(GAP_CONTROLS.filter((x) => !tagged.has(x)), []);
  const roster = new Set(c.accounts.map((a) => a.display_name));
  for (const f of built.files) {
    for (const r of JSON.parse(f.text).rows) {
      for (const k of ['name', 'reviewer', 'signed_off_by', 'performed_by', 'verified_by', 'host', 'escort', 'by', 'owner', 'approved_by', 'facilitator', 'reviewed_by', 'authorised_by', 'maintainer']) {
        if (r[k] === undefined) continue;
        assert.ok(roster.has(r[k]) || /^visitor VIS-\d{4}-\d{3}$/.test(r[k]) || /^contractor technician CT-[A-Z]{3}-\d{2}$/.test(r[k]), `${f.file} ${k} ${r[k]}`);
      }
    }
  }
  // S2 has no disabled leaver, so every staff and contractor account completed the courses the simulator seeds.
  const staff = c.accounts.filter((a) => a.kind === 'staff');
  const aw = JSON.parse(built.files.find((f) => f.file === 'training-awareness.json').text);
  assert.equal(aw.rows.length, staff.length);
  assert.ok(aw.rows.every((r) => r.course === 'S2 Security Awareness: Handling CUI (2026)'));
  // The contractor leaver (the AO A-02 target) has the account-disable step open.
  const leaver = staff.find((a) => a.lifecycle?.event === 'leaver');
  assert.equal(leaver.employee_type, 'Contractor');
  const lc = JSON.parse(built.files.find((f) => f.file === 'personnel-lifecycle.json').text);
  assert.equal(lc.rows.find((r) => r.person_id === leaver.person_id && /account disabled/.test(r.step)).status, 'open');
  // Incident ids mirror the simulator's rewritten history.
  const inc = JSON.parse(built.files.find((f) => f.file === 'incident-tracking.json').text);
  assert.deepEqual([...new Set(inc.rows.map((r) => r.incident))], ['incident-s2-1', 'incident-s2-2']);
  for (const f of built.files) assert.ok(JSON.parse(f.text).period.to < c.history_anchor.slice(0, 10), `${f.file} ends before the anchor`);
});

test('S2: denylist and workstation-path scan is clean, and no S1 fiction appears', async () => {
  const built = buildRecords(customer2());
  assert.deepEqual(await scanRecords(built), []);
  const text = built.files.map((f) => f.text).join('\n') + built.catalogText;
  assert.doesNotMatch(text, /\bS1\b|S1-|s1-mach|Hollinford|Quarrystone|Fennick|CNC|kiosk|machinist/i);
});

// gen-customer.mjs - generates customer.json for the synthetic customer S3
// `s3-def` (synthetic-customer PLAN.md §2.1 / §2.1b W6, decision B25: fictional
// roster + denylist). Everything here is FICTIONAL. Deterministic: same file in
// -> byte-identical customer.json out (no clock, no randomness).
//
//   node gen-customer.mjs            (writes customer.json beside this file)
//   node gen-customer.mjs --check    (exit 1 if customer.json differs)
//
// S3 is the DELIBERATELY DEFICIENT customer: a defence electronics and cable
// harness manufacturer whose Microsoft 365 tenant grew without management.
// Its deficiencies (each listed in deficiencies.json with who fixes it) are
// modelled here and in the simulator seed set customer-history-s3:
//   - stale enabled accounts beyond 90 days (3 staff, and a former IT
//     technician's admin account idle 140 days, the PLAN §2.1b stale admin);
//   - a leaver whose account is still enabled;
//   - users without MFA registration; MFA only through report-only CA;
//   - 3 standing Global Administrators (one of them the owner's normal,
//     licensed account), no PIM; no break-glass separation (the emergency
//     account sits in no CA exclusion);
//   - unassigned or missing Intune policies; no DLP; no CUI label;
//   - legacy authentication allowed; the CUI site shared to "anyone";
//   - security awareness training missing; 9 critical CVEs untracked.
// Person names come from S3's own invented pools below (not S1's or S2's).
// Every generated string is run through S1's denylist loader (the NB scan
// tokens plus the real-entity terms); a hit aborts the build.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDenylist, scanStrings } from '../s1-mach/gen-customer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'customer.json');

const SLUG = 's3-def';
const DOMAIN = `${SLUG}.simtenant.onmicrosoft.us`;

// Invented name pools (B25), distinct from S1's and S2's. Not taken from any person list.
export const FIRST = [
  'Arveth', 'Belmira', 'Caddow', 'Derwyn', 'Ennick', 'Faravel', 'Gethra', 'Hallis', 'Ilvor', 'Jorsa',
  'Kelvane', 'Lisset', 'Maudrin', 'Nerrin', 'Ostrel', 'Pavrin', 'Quesna', 'Rellan', 'Sevrin', 'Tolvar',
  'Ursel', 'Velwyn', 'Wenniv', 'Yarrel', 'Zevrin', 'Amsel', 'Brivane', 'Cressel', 'Dalwyn', 'Embrin',
];
export const SUR_A = ['Arrow', 'Brisk', 'Corran', 'Dapple', 'Embry', 'Fennel', 'Garrow', 'Hesk', 'Ingle', 'Kinder', 'Lattice', 'Mallow', 'Pennan', 'Russet', 'Tansy', 'Vellum'];
export const SUR_B = ['brook', 'crest', 'gate', 'hurst', 'more', 'shaw'];

function personName(i) {
  const first = FIRST[(i * 7 + 3) % FIRST.length];
  const last = SUR_A[(i * 3) % SUR_A.length] + SUR_B[(Math.floor(i / SUR_A.length) + i) % SUR_B.length];
  return { first, last, display: `${first} ${last}` };
}
const local = (n) => `${n.first}.${n.last}`.toLowerCase();
const hex = (n, w) => n.toString(16).padStart(w, '0');
/** Deterministic GUID-shaped sim id (5353 prefix = "S3 sim"; not a real object id). */
const simGuid = (kind, n) => `53530000-${hex(kind, 4)}-4000-8000-${hex(n, 12)}`;

const GA = '62e90394-69f5-4237-9190-012177145e10';
const SECURITY_ADMIN = '194ae4cb-b126-40b2-bd5b-6091b380977d';

// 56 staff: department, title, count, role keys (first holder of each role).
// The plant has no separate security staff: the IT and Security Lead is the
// ISSO and the only administrator; the President owns the system.
const STAFF_PLAN = [
  ['Executive', 'President', 1, ['owner']],
  ['Executive', 'Vice President of Operations', 1, []],
  ['Finance', 'Controller', 1, []],
  ['Contracts', 'Contracts Administrator', 1, []],
  ['IT', 'IT and Security Lead (ISSO)', 1, ['isso', 'administrator']],
  ['Engineering', 'Manufacturing Engineer', 3, []],
  ['Engineering', 'Test Engineer', 2, []],
  ['Engineering', 'Design Engineer', 2, []],
  ['Quality', 'Quality Manager', 1, []],
  ['Quality', 'Quality Inspector', 3, []],
  ['Production', 'Production Supervisor', 2, []],
  ['Production', 'Test Technician', 4, []],
  ['Shipping and Receiving', 'Shipping Clerk', 2, []],
  ['Front Office', 'Office Administrator', 1, []],
  ['Front Office', 'HR Coordinator', 1, []],
  ['Production', 'Cable Harness Assembler', 20, []],
  ['Production', 'Electronics Assembler', 10, []],
];

export function buildCustomer() {
  const people = [];
  const roles = {};
  let idx = 0;
  for (const [department, title, count, roleKeys] of STAFF_PLAN) {
    for (let c = 0; c < count; c++) {
      const n = personName(idx);
      const seq = idx + 1;
      const p = {
        person_id: `s3p-${String(seq).padStart(3, '0')}`,
        seed_id: `user-${seq}`,
        object_id: simGuid(1, seq),
        kind: 'staff',
        display_name: n.display,
        upn: `${local(n)}@${DOMAIN}`,
        job_title: title,
        department,
        roles: c === 0 ? roleKeys : [],
      };
      for (const r of p.roles) roles[r] = p.person_id;
      people.push(p);
      idx++;
    }
  }
  if (people.length !== 56) throw new Error(`staff count ${people.length} != 56`);

  // Lifecycle and inactivity (90-day history). No HR feed reaches the directory:
  //  - one Electronics Assembler left 12 days ago and is still enabled (finding);
  //  - three staff have not signed in for 96 / 118 / 133 days and are still
  //    enabled (no leave record: extended leave and a seasonal second shift).
  const byTitle = (t, k = 0) => people.filter((p) => p.job_title === t)[k];
  byTitle('Electronics Assembler', 4).lifecycle = { event: 'leaver', days_before_anchor: 12, account_enabled: true, note: 'left 12 days ago; no offboarding ran (finding-only: the harness offboards the stale admin, PLAN §2.1b)' };
  byTitle('Cable Harness Assembler', 6).inactive_days = 96;
  byTitle('Cable Harness Assembler', 13).inactive_days = 118;
  byTitle('Quality Inspector', 2).inactive_days = 133;

  const accounts = [...people];
  let seq = people.length;
  // The shared shop-floor login (one password on 4 terminals).
  seq++;
  accounts.push({
    person_id: `s3x-${String(seq).padStart(3, '0')}`,
    seed_id: `user-${seq}`,
    object_id: simGuid(1, seq),
    kind: 'staff',
    shared: true,
    display_name: 'Shop Floor Terminal (shared login)',
    upn: `shopfloor@${DOMAIN}`,
    job_title: 'Shared shop-floor terminal login',
    department: 'Production',
    roles: [],
  });
  // 2 admin accounts: the ISSO's (the operator) and a former IT support
  // technician's, idle 140 days and still enabled (the PLAN §2.1b stale admin).
  const isso = people.find((p) => p.person_id === roles.isso);
  seq++;
  accounts.push({
    person_id: `s3a-${String(seq).padStart(3, '0')}`,
    seed_id: `user-${seq}`,
    object_id: simGuid(1, seq),
    kind: 'admin',
    owner_person_id: isso.person_id,
    display_name: `${isso.display_name} (Admin)`,
    upn: `adm-${isso.upn.split('@')[0]}@${DOMAIN}`,
    job_title: 'Administrator account',
    department: 'IT',
    roles: [],
  });
  const former = personName(77);
  seq++;
  accounts.push({
    person_id: `s3a-${String(seq).padStart(3, '0')}`,
    seed_id: `user-${seq}`,
    object_id: simGuid(1, seq),
    kind: 'admin',
    display_name: `${former.display} (Admin)`,
    upn: `adm-${local(former)}@${DOMAIN}`,
    job_title: 'Administrator account (former IT support technician)',
    department: 'IT',
    roles: [],
    stale_admin: true,
    // The shared builder dates a leaver's employeeLeaveDateTime and last sign-in
    // (leave + 1 day) from this; it is the oldest leave date in the tenant, so the
    // harness's offboard_upn discoverer (E5) picks this account for AO A-02.
    lifecycle: { event: 'leaver', days_before_anchor: 140, account_enabled: true, note: 'technician left 140 days ago; their primary account was deleted long ago, the admin account was forgotten (PLAN §2.1b stale admin; Stamper disables it at E6, E6X re-enables it, AO A-02 disables it at E7A)' },
  });
  seq++;
  accounts.push({
    person_id: `s3b-${String(seq).padStart(3, '0')}`,
    seed_id: `user-${seq}`,
    object_id: simGuid(1, seq),
    kind: 'break_glass',
    display_name: 'Emergency Access',
    upn: `emergency.access@${DOMAIN}`,
    job_title: 'Emergency Access',
    department: 'IT',
    roles: [],
  });
  if (accounts.length !== 60) throw new Error(`account count ${accounts.length} != 60`);

  const names = new Set(accounts.map((a) => a.display_name));
  if (names.size !== accounts.length) throw new Error('duplicate display names');
  const upns = new Set(accounts.map((a) => a.upn));
  if (upns.size !== accounts.length) throw new Error('duplicate UPNs');

  const pid = (pred) => accounts.filter(pred).map((a) => a.person_id);
  const owner = people.find((p) => p.person_id === roles.owner);
  const operatorAdmin = accounts.find((a) => a.kind === 'admin' && a.owner_person_id === isso.person_id);
  const staleAdmin = accounts.find((a) => a.stale_admin);
  const breakGlass = accounts.find((a) => a.kind === 'break_glass');
  const enclave = pid((a) => a.kind === 'staff' && !a.shared && (['Executive', 'Contracts', 'Engineering', 'IT'].includes(a.department) || a.job_title === 'Quality Manager'));
  if (enclave.length !== 12) throw new Error(`CUI group ${enclave.length} != 12`);

  // Group ids keep the generic positions the simulator's tenant object names
  // (group-1 CUI, group-4 all staff, group-6 admins). No break-glass group.
  const groups = [
    { group_id: 'group-1', name: 'CUI-Authorized-Users', purpose: 'Program drawings site members (named CUI, but the site is shared to anyone)', member_person_ids: enclave },
    { group_id: 'group-2', name: 'S3-Production', purpose: 'Production floor staff', member_person_ids: pid((a) => a.kind === 'staff' && a.department === 'Production' && !a.shared) },
    { group_id: 'group-3', name: 'S3-Engineering', purpose: 'Engineering staff', member_person_ids: pid((a) => a.kind === 'staff' && a.department === 'Engineering') },
    { group_id: 'group-4', name: 'S3-All-Staff', purpose: 'Every staff member', member_person_ids: pid((a) => a.kind === 'staff' && !a.shared) },
    { group_id: 'group-5', name: 'S3-Quality', purpose: 'Quality staff', member_person_ids: pid((a) => a.kind === 'staff' && a.department === 'Quality') },
    { group_id: 'group-6', name: 'S3-IT-Admins', purpose: 'Administrator accounts', member_person_ids: pid((a) => a.kind === 'admin') },
    { group_id: 'group-7', name: 'S3-Office', purpose: 'Front office, finance and contracts', member_person_ids: pid((a) => a.kind === 'staff' && ['Front Office', 'Finance', 'Contracts'].includes(a.department)) },
    { group_id: 'group-8', name: 'S3-Shop-Floor-Terminals', purpose: 'The shared shop-floor login', member_person_ids: pid((a) => a.shared === true) },
  ];

  // Devices: 34 Windows (PLAN §2.1 S3 column). 30 assigned workstations (every
  // non-assembly staff member, then 4 assemblers who lead a line) and 4
  // shop-floor terminals signed in with the shared login. 6 non-compliant,
  // 3 unencrypted; 9 carry an unremediated critical CVE (TVM).
  const shared = accounts.find((a) => a.shared);
  const nonAssembly = people.filter((p) => !/Assembler$/.test(p.job_title));
  const leads = people.filter((p) => p.job_title === 'Cable Harness Assembler').slice(0, 4);
  const owners = [...nonAssembly, ...leads];
  if (owners.length !== 30) throw new Error(`workstation owners ${owners.length} != 30`);
  const name = (pattern, n) => pattern.replace(/N+/, (m) => String(n).padStart(m.length, '0'));
  const naming = { workstation: 'S3-WS-NNN', shopfloor: 'S3-SF-NN' };
  const inventory = [
    ...owners.map((a, i) => ({ device_name: name(naming.workstation, i + 1), os: 'Windows', kind: 'workstation', owner_person_id: a.person_id, ownership: 'company' })),
    ...[1, 2, 3, 4].map((i) => ({ device_name: name(naming.shopfloor, i), os: 'Windows', kind: 'shopfloor', owner_person_id: shared.person_id, ownership: 'company' })),
  ];
  const noncompliant = ['S3-WS-007', 'S3-WS-012', 'S3-WS-019', 'S3-WS-024', 'S3-SF-02', 'S3-SF-04'];
  const unencrypted = ['S3-WS-024', 'S3-SF-02', 'S3-SF-04'];
  const criticalCve = ['S3-WS-003', 'S3-WS-007', 'S3-WS-011', 'S3-WS-015', 'S3-WS-019', 'S3-WS-022', 'S3-WS-027', 'S3-SF-01', 'S3-SF-03'];

  const customer = {
    _fictional: 'SIMULATED / FICTIONAL. Every organisation, person, id, address and resource in this file is invented for the CES simulator (synthetic-customer PLAN.md §2, B25). Generated by gen-customer.mjs - edit that file, not this one.',
    slug: SLUG,
    schema: 'ces-synthetic-customer/1',
    deficient_by_design: 'S3 carries the PLAN §2.1b deficiencies on purpose; deficiencies.json lists each one, who fixes it and the GAPS row expected.',
    history_anchor: '2026-10-01T00:00:00.000Z',
    history_anchor_rule: 'Fixed fiction date. Builds and tests that need a reproducible tenant set STACKSIM_FIXED_NOW to this value; otherwise the simulator anchors seeded history to build time floored to the UTC day (SeedEngine). Seeded history = anchor minus fixed offsets.',
    organization: {
      legal_name: 'Corvelline Defense Assemblies Inc. (FICTIONAL)',
      short_name: 'Corvelline Assemblies (FICTIONAL)',
      domain: DOMAIN,
      uei: 'SIMX7Q3D9K5V',
      cage: '9S3D4',
      naics: ['336419', '334418'],
      description: 'Fictional 56-person manufacturer of cable harnesses and electronic sub-assemblies for defence primes, building to CUI drawings received from the primes.',
      address: { street: '410 Ostervale Works Road', city: 'Dunmarrow', state: 'ZZ', zip: '00000', country: 'US' },
      phone: '+1-555-0163',
      facility_count: 1,
      facilities: [{ facility_id: 's3-fac-1', name: 'Ostervale Works', address_ref: 'organization.address' }],
      license: { primary_sku: 'Microsoft 365 G3 (GCC High)', add_on_sku: 'Microsoft 365 E5 Security (GCC High)', identity_model: 'cloud_only', cloud: 'GCC High' },
      roles: Object.fromEntries(
        ['owner', 'isso', 'administrator'].map((r) => {
          const p = people.find((x) => x.person_id === roles[r]);
          return [r, { person_id: p.person_id, display_name: p.display_name, upn: p.upn, job_title: p.job_title }];
        }),
      ),
    },
    accounts_summary: { staff: 56, shared_login: 1, admin: 2, break_glass: 1, total: accounts.length, stale_enabled: 4, leaver_enabled: 1 },
    accounts,
    groups,
    cui_enclave: { group_id: 'group-1', member_count: enclave.length, sharepoint_site: `https://${SLUG}.sharepoint.us/sites/program-drawings`, teams_channels: [], flow: 'prime portal -> plain e-mail attachments -> SharePoint "Program Drawings" site (shared to anyone with the link) -> shop-floor terminals and workstations', site_sharing: 'anyone' },
    pim: {
      permanent_global_admin: 'three standing Global Administrators: the President\'s normal licensed account, the ISSO\'s admin account and the emergency account; no PIM eligibility, no approval, no access review',
      eligible_roles: [
        { role: 'Global Administrator', template_id: GA },
        { role: 'Security Administrator', template_id: SECURITY_ADMIN },
      ],
      eligible_principals: [],
      standing: [
        { person_id: owner.person_id, role: 'Global Administrator', template_id: GA, note: 'the owner\'s normal, licensed account' },
        { person_id: operatorAdmin.person_id, role: 'Global Administrator', template_id: GA, note: 'the ISSO\'s admin account (the operator)' },
        { person_id: breakGlass.person_id, role: 'Global Administrator', template_id: GA, note: 'the emergency account, in no CA exclusion' },
        { person_id: staleAdmin.person_id, role: 'Security Administrator', template_id: SECURITY_ADMIN, note: 'the stale former technician\'s admin account' },
      ],
    },
    devices: {
      windows11_intune: inventory.length,
      ios: 0,
      compliant: inventory.length - noncompliant.length,
      noncompliant,
      unencrypted,
      critical_cve_devices: criticalCve,
      naming,
      inventory,
    },
    conditional_access: [
      ['S3-CA01 Require MFA - all users', 'mfa_all_users'],
      ['S3-CA02 Require MFA - administrators', 'mfa_admin_roles'],
    ].map(([n, template], i) => ({ policy_id: `caPolicy-${i + 1}`, name: n, template, state: 'enabledForReportingButNotEnforced', break_glass_excluded: false })),
    named_locations: [
      { seedId: simGuid(0xb1, 1), name: 'S3 Ostervale Works egress', kind: 'ip', cidrs: ['192.0.2.0/26'] },
    ],
    legacy_authentication: 'allowed (no blocking CA policy)',
    baseline: { intune_security_baseline: false, bitlocker: 'partial (3 devices unencrypted)' },
    intune_policies: 'one Windows compliance policy, not assigned; Defender Antivirus configuration not assigned; no settings-catalog, removable-storage or app-protection policy',
    dlp_policies: [],
    sensitivity_label: null,
    training: 'annual awareness course completed by the front office only, more than a year ago; no insider-threat course',
    security_operations: { sentinel: false, defender_xdr: true, note: 'Defender XDR from the E5 Security add-on; 2 alerts new and unassigned for 20 days; nobody triages the queue' },
    vulnerabilities: { cves: 41, critical_untracked: 9 },
    azure_government: null,
    azure_note: 'An Azure Government subscription exists (bought for a planned enclave) and holds no resources. The simulator stance stays m365_azure (ProfileLoader refuses seed sets on any other stance, PLAN §2.2); no Azure resource is seeded.',
    azure_subscription_id: simGuid(0xa2, 1),
  };
  return customer;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const customer = buildCustomer();
  const hits = scanStrings(customer, loadDenylist());
  if (hits.length) {
    console.error(`denylist hits (${hits.length}):\n${hits.join('\n')}`);
    process.exit(1);
  }
  const text = JSON.stringify(customer, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    const same = existsSync(OUT) && readFileSync(OUT, 'utf8') === text;
    console.log(same ? 'customer.json up to date' : 'customer.json DRIFT');
    process.exit(same ? 0 : 1);
  }
  writeFileSync(OUT, text, 'utf8');
  console.log(`wrote ${OUT}: ${customer.accounts.length} accounts, ${customer.groups.length} groups, ${customer.devices.inventory.length} devices, denylist clean`);
}

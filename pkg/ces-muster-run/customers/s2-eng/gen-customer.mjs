// gen-customer.mjs - generates customer.json for the synthetic customer S2
// `s2-eng` (synthetic-customer PLAN.md §2.1 W6, decision B25: fictional roster +
// denylist). Everything here is FICTIONAL. Deterministic: same file in ->
// byte-identical customer.json out (no clock, no randomness).
//
//   node gen-customer.mjs            (writes customer.json beside this file)
//   node gen-customer.mjs --check    (exit 1 if customer.json differs)
//
// S2 is an engineering services firm with a HYBRID identity model: its staff
// accounts are synchronised from an on-premises Active Directory (Entra Connect,
// password hash sync), while the separate admin accounts, the break-glass
// accounts, the contractors and the sync service account are cloud-only.
// Person names come from S2's own invented pools below (not S1's). Every
// generated string is run through S1's denylist loader (the NB scan tokens plus
// the real-entity terms); a hit aborts the build.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDenylist, scanStrings } from '../s1-mach/gen-customer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'customer.json');

const SLUG = 's2-eng';
const DOMAIN = `${SLUG}.simtenant.onmicrosoft.us`;
/** The fictional on-premises AD forest the staff accounts sync from (not a resolvable domain). */
const AD_DOMAIN = 'corp.s2-eng.sim';
const AD_DN = 'DC=corp,DC=s2-eng,DC=sim';
const AD_SID = 'S-1-5-21-5252005200-5252005201-5252005202';

// Invented name pools (B25), distinct from S1's. Not taken from any person list.
export const FIRST = [
  'Aubrel', 'Bexanne', 'Cyprel', 'Dallow', 'Emberlin', 'Fenra', 'Galwyn', 'Harlune', 'Ingrel', 'Jorvane',
  'Kestrel', 'Linnow', 'Morvane', 'Nyssel', 'Oriel', 'Perrow', 'Quenby', 'Roswen', 'Sorrel', 'Tavrin',
  'Ulvane', 'Vespra', 'Wynnet', 'Yselde', 'Zephren', 'Arlow', 'Brisel', 'Calvane', 'Dovren', 'Elwen',
];
export const SUR_A = ['Ashby', 'Birch', 'Cinder', 'Dunn', 'Elder', 'Flint', 'Gorse', 'Heath', 'Ivor', 'Junip', 'Larch', 'Moss', 'Pike', 'Quarr', 'Rowan', 'Sedge'];
export const SUR_B = ['field', 'ford', 'ridge', 'worth', 'bank', 'dale'];

function personName(i) {
  const first = FIRST[(i * 11) % FIRST.length];
  const last = SUR_A[(i * 5) % SUR_A.length] + SUR_B[(Math.floor(i / SUR_A.length) + i * 2) % SUR_B.length];
  return { first, last, display: `${first} ${last}` };
}
const local = (n) => `${n.first}.${n.last}`.toLowerCase();
const hex = (n, w) => n.toString(16).padStart(w, '0');
/** Deterministic GUID-shaped sim id (5252 prefix = "S2 sim"; not a real object id). */
const simGuid = (kind, n) => `52520000-${hex(kind, 4)}-4000-8000-${hex(n, 12)}`;
/** The on-premises immutable id Entra Connect writes: base64 of the AD objectGUID bytes (here a sim GUID). */
const immutableId = (n) => Buffer.from(simGuid(0x0ad, n).replace(/-/g, ''), 'hex').toString('base64');

// 26 synced staff: department, title, count, role keys (first holder of each role).
const STAFF_PLAN = [
  ['Executive', 'President / Principal Engineer', 1, ['owner', 'authorizing_official']],
  ['Executive', 'Director of Operations', 1, []],
  ['Executive', 'Finance Manager', 1, []],
  ['Programs', 'Program Manager / Facility Security Officer', 1, ['fso']],
  ['Programs', 'Contracts and CUI Manager', 1, ['cui_manager']],
  ['IT', 'Information Security Manager (ISSM)', 1, ['issm']],
  ['IT', 'Information Systems Security Officer (ISSO)', 1, ['isso']],
  ['IT', 'Systems Administrator', 1, ['administrator']],
  ['Engineering', 'Lead Systems Engineer', 2, []],
  ['Engineering', 'Mechanical Design Engineer', 4, []],
  ['Engineering', 'Electrical Engineer', 3, []],
  ['Engineering', 'Structural Analyst', 2, []],
  ['Engineering', 'Test Engineer', 2, []],
  ['Drafting', 'CAD Designer', 3, []],
  ['Front Office', 'Office Manager', 1, []],
  ['Front Office', 'Project Accountant', 1, []],
];
// 3 contractors (cloud-only, ext.* accounts): two technicians of the firm's
// managed IT provider and one subcontract engineer.
const CONTRACTORS = [
  ['Contractors', 'MSP Support Technician (Ostlake Managed IT, FICTIONAL)'],
  ['Contractors', 'MSP Support Technician (Ostlake Managed IT, FICTIONAL)'],
  ['Contractors', 'Subcontract Stress Engineer'],
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
        person_id: `s2p-${String(seq).padStart(3, '0')}`,
        seed_id: `user-${seq}`,
        object_id: simGuid(1, seq),
        kind: 'staff',
        display_name: n.display,
        upn: `${local(n)}@${DOMAIN}`,
        job_title: title,
        department,
        roles: c === 0 ? roleKeys : [],
        on_premises: {
          sync_enabled: true,
          immutable_id: immutableId(seq),
          sam_account_name: local(n).slice(0, 20),
          domain_name: AD_DOMAIN,
          distinguished_name: `CN=${n.display},OU=Staff,OU=S2,${AD_DN}`,
          security_identifier: `${AD_SID}-${1100 + seq}`,
        },
      };
      for (const r of p.roles) roles[r] = p.person_id;
      people.push(p);
      idx++;
    }
  }
  if (people.length !== 26) throw new Error(`synced staff count ${people.length} != 26`);
  for (const [department, title] of CONTRACTORS) {
    const n = personName(idx);
    const seq = idx + 1;
    people.push({
      person_id: `s2c-${String(seq).padStart(3, '0')}`,
      seed_id: `user-${seq}`,
      object_id: simGuid(1, seq),
      kind: 'staff',
      employee_type: 'Contractor',
      display_name: n.display,
      upn: `ext.${local(n)}@${DOMAIN}`,
      job_title: title,
      department,
      roles: [],
    });
    idx++;
  }

  // Lifecycle (90-day history): 1 joiner (a synced staff member) and 1 leaver.
  // The leaver is a cloud-only contractor whose engagement ended 11 days ago and
  // whose account is still enabled (AO A-02 target). A synced account could not
  // be disabled from the cloud on a real hybrid tenant (accountEnabled is mastered
  // in on-premises AD), so the A-02 target is deliberately a cloud-only account.
  const byTitle = (t, k = 0) => people.filter((p) => p.job_title === t)[k];
  byTitle('Test Engineer', 1).lifecycle = { event: 'joiner', days_before_anchor: 18, account_enabled: true };
  byTitle('MSP Support Technician (Ostlake Managed IT, FICTIONAL)', 1).lifecycle = { event: 'leaver', days_before_anchor: 11, account_enabled: true, note: 'MSP engagement ended; not yet disabled (AO A-02 target)' };

  // 3 separate cloud-only admin accounts (adm-<first>.<last>) for the ISSM, ISSO and systems administrator.
  const adminOwners = [roles.issm, roles.isso, roles.administrator];
  const accounts = [...people];
  let seq = people.length;
  for (const owner of adminOwners) {
    const o = people.find((p) => p.person_id === owner);
    seq++;
    accounts.push({
      person_id: `s2a-${String(seq).padStart(3, '0')}`,
      seed_id: `user-${seq}`,
      object_id: simGuid(1, seq),
      kind: 'admin',
      owner_person_id: owner,
      display_name: `${o.display_name} (Admin)`,
      upn: `adm-${o.upn.split('@')[0]}@${DOMAIN}`,
      job_title: 'Privileged administration account (cloud-only)',
      department: 'IT',
      roles: [],
    });
  }
  for (const [n, name] of [[1, 'Emergency Access 01'], [2, 'Emergency Access 02']]) {
    seq++;
    accounts.push({
      person_id: `s2b-${String(seq).padStart(3, '0')}`,
      seed_id: `user-${seq}`,
      object_id: simGuid(1, seq),
      kind: 'break_glass',
      display_name: name,
      upn: `eaa.0${n}@${DOMAIN}`,
      job_title: 'Emergency Access (Break Glass)',
      department: 'IT',
      roles: [],
    });
  }
  seq++;
  accounts.push({
    person_id: `s2s-${String(seq).padStart(3, '0')}`,
    seed_id: `user-${seq}`,
    object_id: simGuid(1, seq),
    kind: 'service',
    display_name: 'Entra Connect Sync Service',
    upn: `svc.entraconnect@${DOMAIN}`,
    job_title: 'Service Account (Entra Connect directory synchronisation)',
    department: 'IT',
    roles: [],
  });
  if (accounts.length !== 35) throw new Error(`account count ${accounts.length} != 35`);

  const names = new Set(accounts.map((a) => a.display_name));
  if (names.size !== accounts.length) throw new Error('duplicate display names');

  const pid = (pred) => accounts.filter(pred).map((a) => a.person_id);
  const enclave = [
    ...pid((a) => a.kind === 'staff' && !a.employee_type && ['Executive', 'Programs', 'IT'].includes(a.department) && a.job_title.startsWith('President')),
    ...pid((a) => a.kind === 'staff' && !a.employee_type && ['Programs', 'IT'].includes(a.department)),
    ...pid((a) => a.kind === 'staff' && ['Lead Systems Engineer', 'Mechanical Design Engineer'].includes(a.job_title)),
  ];
  if (enclave.length !== 12) throw new Error(`CUI enclave ${enclave.length} != 12`);

  // Group ids keep the generic positions the simulator's tenant object names
  // (group-1 CUI enclave, group-4 all staff, group-5 LOA, group-6 admins,
  // group-7 training enforcement); group-12 is the break-glass exclusion group.
  const groups = [
    { group_id: 'group-1', name: 'CUI-Authorized-Users', purpose: 'CUI enclave members (SharePoint project enclave + 2 Teams channels)', member_person_ids: enclave },
    { group_id: 'group-2', name: 'S2-Engineering', purpose: 'Engineering staff', member_person_ids: pid((a) => a.kind === 'staff' && a.department === 'Engineering') },
    { group_id: 'group-3', name: 'S2-Drafting', purpose: 'CAD designers', member_person_ids: pid((a) => a.kind === 'staff' && a.department === 'Drafting') },
    { group_id: 'group-4', name: 'S2-All-Staff', purpose: 'Every staff member (synced from on-premises AD)', member_person_ids: pid((a) => a.kind === 'staff' && !a.employee_type) },
    { group_id: 'group-5', name: 'S2-LOA-Suspended', purpose: 'Leave of absence - access blocked', member_person_ids: [] },
    { group_id: 'group-6', name: 'S2-Privileged-Admins', purpose: 'Separate cloud-only privileged admin accounts', member_person_ids: pid((a) => a.kind === 'admin') },
    { group_id: 'group-7', name: 'S2-Training-Not-Complete', purpose: 'New hires restricted until security training is complete', member_person_ids: pid((a) => a.lifecycle?.event === 'joiner') },
    { group_id: 'group-8', name: 'S2-Contractors', purpose: 'Contractor and managed IT provider accounts (cloud-only)', member_person_ids: pid((a) => a.employee_type === 'Contractor') },
    { group_id: 'group-9', name: 'S2-CUI-Project-Team', purpose: 'Teams team hosting the 2 CUI channels', member_person_ids: enclave.slice(0, 8) },
    { group_id: 'group-10', name: 'S2-BYOD-Mobile', purpose: 'Personal phones under Intune app protection (MAM) and the Android work profile', member_person_ids: [] },
    { group_id: 'group-11', name: 'S2-Front-Office', purpose: 'Front office and project accounting', member_person_ids: pid((a) => a.kind === 'staff' && a.department === 'Front Office') },
    { group_id: 'group-12', name: 'S2-Break-Glass', purpose: 'Emergency access accounts (excluded from every CA policy)', member_person_ids: pid((a) => a.kind === 'break_glass') },
  ];

  // Devices: one Windows 11 laptop per synced staff member (Intune, Defender
  // for Endpoint), 4 CAD workstations, 6 company iPhones, 6 personal Android
  // phones (Android Enterprise work profile, under app protection).
  const syncedStaff = accounts.filter((a) => a.kind === 'staff' && !a.employee_type);
  const engineers = syncedStaff.filter((a) => a.department === 'Engineering');
  const drafting = syncedStaff.filter((a) => a.department === 'Drafting');
  const name = (pattern, n) => pattern.replace(/N+/, (m) => String(n).padStart(m.length, '0'));
  const naming = { laptop: 'S2-LT-NNN', cad: 'S2-CAD-NN', ios: 'S2-IOS-NN', android: 'S2-ADR-NN' };
  const inventory = [
    ...syncedStaff.map((a, i) => ({ device_name: name(naming.laptop, i + 1), os: 'Windows', kind: 'laptop', owner_person_id: a.person_id, ownership: 'company' })),
    ...[0, 1, 2, 3].map((i) => ({ device_name: name(naming.cad, i + 1), os: 'Windows', kind: 'cad', owner_person_id: drafting[i % drafting.length].person_id, ownership: 'company' })),
    ...syncedStaff.filter((a) => ['Executive', 'Programs', 'IT'].includes(a.department)).slice(0, 6).map((a, i) => ({ device_name: name(naming.ios, i + 1), os: 'iOS', kind: 'ios', owner_person_id: a.person_id, ownership: 'company' })),
    ...engineers.slice(0, 6).map((a, i) => ({ device_name: name(naming.android, i + 1), os: 'Android', kind: 'android', owner_person_id: a.person_id, ownership: 'personal' })),
  ];
  // The BYOD group holds the Android phones' owners.
  groups.find((g) => g.group_id === 'group-10').member_person_ids = inventory.filter((d) => d.ownership === 'personal').map((d) => d.owner_person_id);

  const customer = {
    _fictional: 'SIMULATED / FICTIONAL. Every organisation, person, id, address and resource in this file is invented for the CES simulator (synthetic-customer PLAN.md §2, B25). Generated by gen-customer.mjs - edit that file, not this one.',
    slug: SLUG,
    schema: 'ces-synthetic-customer/1',
    history_anchor: '2026-10-01T00:00:00.000Z',
    history_anchor_rule: 'Fixed fiction date. Builds and tests that need a reproducible tenant set STACKSIM_FIXED_NOW to this value; otherwise the simulator anchors seeded history to build time floored to the UTC day (SeedEngine). Seeded history = anchor minus fixed offsets.',
    organization: {
      legal_name: 'Tamberlow Systems Engineering LLC (FICTIONAL)',
      short_name: 'Tamberlow Engineering (FICTIONAL)',
      domain: DOMAIN,
      uei: 'SIMX4N8T2R6W',
      cage: '9S2E7',
      naics: ['541330', '541715'],
      description: 'Fictional 29-person engineering services firm (26 staff and 3 contractors) producing design, analysis and test packages for prime contractors under CUI-bearing subcontracts.',
      address: { street: '2750 Halberd Point Road, Suite 300', city: 'Wrenmoor', state: 'ZZ', zip: '00000', country: 'US' },
      phone: '+1-555-0157',
      facility_count: 2,
      facilities: [
        { facility_id: 's2-fac-1', name: 'Halberd Point Office', address_ref: 'organization.address' },
        { facility_id: 's2-fac-2', name: 'Cinderfield Test Lab', address: { street: '18 Cinderfield Lane', city: 'Wrenmoor', state: 'ZZ', zip: '00000', country: 'US' } },
      ],
      msp: { name: 'Ostlake Managed IT (FICTIONAL)', service: 'remote endpoint and server support under the ISSO; technicians hold cloud-only ext.* contractor accounts in S2-Contractors' },
      license: { primary_sku: 'Microsoft 365 G5 (GCC High)', identity_model: 'hybrid', cloud: 'GCC High', directory_sync: 'Entra Connect, password hash sync' },
      roles: Object.fromEntries(
        ['owner', 'authorizing_official', 'isso', 'issm', 'fso', 'administrator', 'cui_manager'].map((r) => {
          const p = people.find((x) => x.person_id === roles[r]);
          return [r, { person_id: p.person_id, display_name: p.display_name, upn: p.upn, job_title: p.job_title }];
        }),
      ),
    },
    hybrid_identity: {
      model: 'hybrid',
      sync_engine: 'Entra Connect (password hash sync)',
      on_premises_domain: AD_DOMAIN,
      sync_server: 'vm-s2-sync-01',
      sync_service_account: `svc.entraconnect@${DOMAIN}`,
      synced_kinds: 'staff (not contractors)',
      cloud_only: 'admin, break-glass, contractor and service accounts',
      last_sync_minutes_before_anchor: 25,
      last_password_sync_minutes_before_anchor: 3,
    },
    accounts_summary: { staff: 26, contractor: 3, admin: 3, break_glass: 2, service: 1, synced: 26, total: accounts.length },
    accounts,
    groups,
    cui_enclave: { group_id: 'group-1', member_count: enclave.length, sharepoint_site: `https://${SLUG}.sharepoint.us/sites/cui-enclave`, teams_channels: ['CUI-Projects', 'CUI-Design-Reviews'], flow: 'prime portal -> encrypted mail -> SharePoint project enclave -> engineering laptops and CAD workstations (managed) -> deliverable package back to the prime portal' },
    pim: {
      permanent_global_admin: 'break-glass accounts only',
      eligible_roles: [
        { role: 'Global Administrator', template_id: '62e90394-69f5-4237-9190-012177145e10' },
        { role: 'Privileged Role Administrator', template_id: 'e8611ab8-c189-46e8-94e1-60213ab1f814' },
        { role: 'Security Administrator', template_id: '194ae4cb-b126-40b2-bd5b-6091b380977d' },
        { role: 'Intune Administrator', template_id: '3a2c62db-5318-420d-8d74-23affee5d9d5' },
        { role: 'Exchange Administrator', template_id: '29232cdf-9323-42fd-ade2-1d097af3e4de' },
      ],
      eligible_principals: pid((a) => a.kind === 'admin'),
    },
    devices: {
      windows11_intune: inventory.filter((d) => d.os === 'Windows').length,
      ios: inventory.filter((d) => d.os === 'iOS').length,
      android_byod: inventory.filter((d) => d.os === 'Android').length,
      compliant: inventory.length - 3,
      noncompliant: ['S2-LT-012', 'S2-CAD-04', 'S2-ADR-06'],
      unencrypted: ['S2-CAD-04'],
      naming,
      inventory,
    },
    conditional_access: [
      ['S2-CA01 Require MFA - all users', 'mfa_all_users'],
      ['S2-CA02 Block legacy authentication', 'block_legacy_auth'],
      ['S2-CA03 Require MFA - admin roles', 'mfa_admin_roles'],
    ].map(([n, template], i) => ({ policy_id: `caPolicy-${i + 1}`, name: n, template, state: 'enabled', excludes_group: 'group-12' })),
    named_locations: [
      { seedId: simGuid(0xb1, 1), name: 'S2 Halberd Point office egress', kind: 'ip', cidrs: ['198.51.100.0/25'] },
      { seedId: simGuid(0xb1, 2), name: 'S2 Cinderfield test lab egress', kind: 'ip', cidrs: ['198.51.100.128/26'] },
    ],
    baseline: { intune_security_baseline: true, bitlocker: true },
    mam: {
      target_group: 'group-10',
      ios_policy: 'S2 iOS app protection - BYOD and company phones',
      android_policy: 'S2 Android app protection - BYOD',
      byod_posture: 'personal phones allowed for mail and Teams under app protection; backup and Save As not yet blocked (B-09 separation candidate)',
    },
    dlp_policies: ['S2-DLP CUI in SharePoint project enclave', 'S2-DLP CUI in Exchange (external block)'],
    sensitivity_label: { name: 'CUI', description: 'Controlled Unclassified Information - encrypt, enclave only' },
    security_operations: { sentinel: false, defender_xdr: true, note: 'no Microsoft Sentinel workspace; Defender XDR alerts and incidents only; the Log Analytics workspace holds Azure diagnostics' },
    azure_government: {
      subscription_id: simGuid(0xa2, 1),
      subscription_name: 's2-eng-gov-prod',
      region: 'usgovvirginia',
      resource_group: 'rg-s2-eng-prod',
      vms: [
        { name: 'vm-s2-sync-01', role: 'Entra Connect sync server', subnet: 'snet-s2-mgmt', private_ip: '10.52.1.10' },
        { name: 'vm-s2-lic-01', role: 'CAD and analysis licence server', subnet: 'snet-s2-workload', private_ip: '10.52.2.10' },
      ],
      vnet: {
        name: 'vnet-s2-eng-prod',
        address_space: '10.52.0.0/16',
        subnets: [
          { name: 'snet-s2-mgmt', cidr: '10.52.1.0/24' },
          { name: 'snet-s2-workload', cidr: '10.52.2.0/24' },
        ],
      },
      nsg: 'nsg-s2-workload',
      log_analytics: 'law-s2-eng-prod',
      backup_vault: 'rsv-s2-eng-prod',
      allowed_admin_source: '198.51.100.0/25',
      key_vault_note: 'no customer key vault; CES creates one at E6 (SC.L2-3.13.10.key-vault)',
    },
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

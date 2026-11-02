// gen-customer.mjs - generates customer.json for the synthetic customer S1
// `s1-mach` (synthetic-customer PLAN.md §2.1, decision B25: fictional roster +
// denylist). Everything here is FICTIONAL. Deterministic: same file in ->
// byte-identical customer.json out (no clock, no randomness).
//
//   node gen-customer.mjs            (writes customer.json beside this file)
//   node gen-customer.mjs --check    (exit 1 if customer.json differs)
//
// Person names are built from two invented name pools below (first names and
// surname syllables). Every generated string is run through the denylist:
// the NB scan tokens file (<WS>\nb-tools\scan-tokens.txt, .NET regexes) plus
// the real-entity terms in EXTRA_DENY. A hit aborts the build.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'customer.json');
const SCAN_TOKENS = path.resolve(HERE, '..', '..', '..', '..', 'nb-tools', 'scan-tokens.txt');

const SLUG = 's1-mach';
const DOMAIN = `${SLUG}.simtenant.onmicrosoft.us`;

// Invented name pools (B25). Not taken from any person list.
export const FIRST = [
  'Alvane', 'Brennic', 'Caddis', 'Dorrel', 'Elsin', 'Faylen', 'Gorrin', 'Halric', 'Ivra', 'Jessamy',
  'Kestin', 'Lorrel', 'Merrin', 'Nolwen', 'Orsk', 'Pellan', 'Quillon', 'Rhoswen', 'Saffre', 'Tamsel',
  'Ulven', 'Varra', 'Wendric', 'Yselle', 'Zorran', 'Ambrel', 'Corvane', 'Delphy', 'Ettrin', 'Hollis',
];
export const SUR_A = ['Ashen', 'Brack', 'Copper', 'Dross', 'Fallow', 'Gravel', 'Hollin', 'Kettle', 'Marrow', 'Nettle', 'Oaken', 'Quill', 'Rook', 'Thistle', 'Wex', 'Yarrow'];
export const SUR_B = ['mere', 'vane', 'holt', 'combe', 'wick', 'stead'];

// Real-entity denylist beyond scan-tokens.txt (case-insensitive substrings).
export const EXTRA_DENY = ['Blue Heron', 'blueheron', 'BHD', 'aavya'];

export function loadDenylist(tokensPath = SCAN_TOKENS) {
  const rx = [];
  if (existsSync(tokensPath)) {
    for (const raw of readFileSync(tokensPath, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const ci = line.startsWith('(?i)');
      rx.push(new RegExp(ci ? line.slice(4) : line, ci ? 'i' : ''));
    }
  }
  for (const t of EXTRA_DENY) rx.push(new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));
  return rx;
}

function personName(i) {
  const first = FIRST[(i * 7) % FIRST.length];
  const last = SUR_A[i % SUR_A.length] + SUR_B[(Math.floor(i / SUR_A.length) + i) % SUR_B.length];
  return { first, last, display: `${first} ${last}` };
}
const local = (n) => `${n.first}.${n.last}`.toLowerCase();
const hex = (n, w) => n.toString(16).padStart(w, '0');
/** Deterministic GUID-shaped sim id (5151 prefix = "S1 sim"; not a real object id). */
const simGuid = (kind, n) => `51510000-${hex(kind, 4)}-4000-8000-${hex(n, 12)}`;

// 45 staff: department, title, count, role keys (first holder of each role).
const STAFF_PLAN = [
  ['Executive', 'President / Owner', 1, ['owner', 'authorizing_official']],
  ['Executive', 'Vice President, Operations', 1, []],
  ['Executive', 'Controller', 1, []],
  ['Programs', 'Programs Manager / Facility Security Officer', 1, ['fso']],
  ['Programs', 'Contracts and CUI Manager', 1, ['cui_manager']],
  ['Programs', 'Program Coordinator', 2, []],
  ['IT', 'Information Security Manager (ISSM)', 1, ['issm']],
  ['IT', 'Information Systems Security Officer (ISSO)', 1, ['isso']],
  ['IT', 'Systems Administrator', 2, ['administrator']],
  ['Engineering', 'Manufacturing Engineer', 4, []],
  ['Engineering', 'Design Engineer', 2, []],
  ['Programming', 'CNC Programmer', 4, []],
  ['Quality', 'Quality Manager', 1, []],
  ['Quality', 'Quality Inspector (CMM)', 3, []],
  ['Production', 'Shop Supervisor', 2, []],
  ['Production', 'CNC Machinist', 14, []],
  ['Production', 'Tool Crib Attendant', 1, []],
  ['Front Office', 'Buyer / Purchasing', 2, []],
  ['Front Office', 'Shipping and Receiving', 1, []],
];

export function buildCustomer() {
  const people = [];
  const roles = {};
  let idx = 0;
  for (const [department, title, count, roleKeys] of STAFF_PLAN) {
    for (let c = 0; c < count; c++) {
      const n = personName(idx);
      const p = {
        person_id: `s1p-${String(idx + 1).padStart(3, '0')}`,
        seed_id: `user-${idx + 1}`,
        object_id: simGuid(1, idx + 1),
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
  if (people.length !== 45) throw new Error(`staff count ${people.length} != 45`);

  // Lifecycle markers (§2.1 90-day history): 1 joiner, 2 leavers (1 not yet disabled).
  const byTitle = (t, k = 0) => people.filter((p) => p.job_title === t)[k];
  byTitle('CNC Machinist', 13).lifecycle = { event: 'joiner', days_before_anchor: 21, account_enabled: true };
  byTitle('CNC Machinist', 12).lifecycle = { event: 'leaver', days_before_anchor: 40, account_enabled: false };
  byTitle('Program Coordinator', 1).lifecycle = { event: 'leaver', days_before_anchor: 9, account_enabled: true, note: 'not yet disabled (AO A-02 target)' };

  // 4 separate admin accounts for the ISSM, ISSO and both systems administrators.
  const adminOwners = [roles.issm, roles.isso, ...people.filter((p) => p.job_title === 'Systems Administrator').map((p) => p.person_id)];
  const accounts = [...people];
  let seq = people.length;
  for (const owner of adminOwners) {
    const o = people.find((p) => p.person_id === owner);
    seq++;
    accounts.push({
      person_id: `s1a-${String(seq).padStart(3, '0')}`,
      seed_id: `user-${seq}`,
      object_id: simGuid(1, seq),
      kind: 'admin',
      owner_person_id: owner,
      display_name: `${o.display_name} (Admin)`,
      upn: `adm.${o.upn.split('@')[0]}@${DOMAIN}`,
      job_title: 'Privileged administration account',
      department: 'IT',
      roles: [],
    });
  }
  for (const [n, name] of [[1, 'Emergency Access 01'], [2, 'Emergency Access 02']]) {
    seq++;
    accounts.push({
      person_id: `s1b-${String(seq).padStart(3, '0')}`,
      seed_id: `user-${seq}`,
      object_id: simGuid(1, seq),
      kind: 'break_glass',
      display_name: name,
      upn: `bg.access0${n}@${DOMAIN}`,
      job_title: 'Emergency Access (Break Glass)',
      department: 'IT',
      roles: [],
    });
  }
  for (const [lp, name, title] of [['svc.backup', 'Backup Service', 'Service Account (backup agent)'], ['svc.camsync', 'CAM Sync Service', 'Service Account (CAM file sync)']]) {
    seq++;
    accounts.push({
      person_id: `s1s-${String(seq).padStart(3, '0')}`,
      seed_id: `user-${seq}`,
      object_id: simGuid(1, seq),
      kind: 'service',
      display_name: name,
      upn: `${lp}@${DOMAIN}`,
      job_title: title,
      department: 'IT',
      roles: [],
    });
  }

  const names = new Set(accounts.map((a) => a.display_name));
  if (names.size !== accounts.length) throw new Error('duplicate display names');

  const pid = (pred) => accounts.filter(pred).map((a) => a.person_id);
  const cuiEnclave = [
    ...pid((a) => a.kind === 'staff' && ['Executive', 'Programs', 'Engineering', 'Programming', 'IT'].includes(a.department) && a.job_title !== 'Controller' && a.job_title !== 'Vice President, Operations'),
    ...pid((a) => a.job_title === 'Quality Manager'),
  ];
  // Exactly 18: trim deterministically if the department rule overshoots.
  const enclave = cuiEnclave.slice(0, 18);
  if (enclave.length !== 18) throw new Error(`CUI enclave ${enclave.length} != 18`);

  const groups = [
    { group_id: 'group-1', name: 'CUI-Authorized-Users', purpose: 'CUI enclave members (SharePoint enclave + 2 Teams channels)', member_person_ids: enclave },
    { group_id: 'group-2', name: 'S1-Engineering', purpose: 'Engineering staff', member_person_ids: pid((a) => a.kind === 'staff' && a.department === 'Engineering') },
    { group_id: 'group-3', name: 'S1-Quality', purpose: 'Quality staff', member_person_ids: pid((a) => a.kind === 'staff' && a.department === 'Quality') },
    { group_id: 'group-4', name: 'S1-All-Staff', purpose: 'Every staff member', member_person_ids: pid((a) => a.kind === 'staff') },
    { group_id: 'group-5', name: 'S1-LOA-Suspended', purpose: 'Leave of absence - access blocked', member_person_ids: [] },
    { group_id: 'group-6', name: 'S1-Privileged-Admins', purpose: 'Separate privileged admin accounts', member_person_ids: pid((a) => a.kind === 'admin') },
    { group_id: 'group-7', name: 'S1-Training-Not-Complete', purpose: 'New hires restricted until security training is complete', member_person_ids: pid((a) => a.lifecycle?.event === 'joiner') },
    { group_id: 'group-8', name: 'S1-Production', purpose: 'Production floor staff', member_person_ids: pid((a) => a.kind === 'staff' && a.department === 'Production') },
    { group_id: 'group-9', name: 'S1-CUI-Program-Team', purpose: 'Teams team hosting the 2 CUI channels', member_person_ids: enclave.slice(0, 10) },
    { group_id: 'group-10', name: 'S1-CNC-Programming', purpose: 'CNC programmers (programming VM access)', member_person_ids: pid((a) => a.kind === 'staff' && a.department === 'Programming') },
    { group_id: 'group-11', name: 'S1-Front-Office', purpose: 'Front office and purchasing', member_person_ids: pid((a) => a.kind === 'staff' && a.department === 'Front Office') },
    { group_id: 'group-12', name: 'S1-Break-Glass', purpose: 'Emergency access accounts (excluded from every CA policy)', member_person_ids: pid((a) => a.kind === 'break_glass') },
    { group_id: 'group-13', name: 'S1-Jump-Box-Users', purpose: 'Shop-floor jump box logon', member_person_ids: pid((a) => a.kind === 'staff' && (a.department === 'Programming' || a.job_title === 'Shop Supervisor')) },
    { group_id: 'group-14', name: 'S1-Kiosk-Devices', purpose: 'Shop-floor kiosk device group', member_person_ids: [] },
  ];

  const customer = {
    _fictional: 'SIMULATED / FICTIONAL. Every organisation, person, id, address and resource in this file is invented for the CES simulator (synthetic-customer PLAN.md §2, B25). Generated by gen-customer.mjs - edit that file, not this one.',
    slug: SLUG,
    schema: 'ces-synthetic-customer/1',
    history_anchor: '2026-10-01T00:00:00.000Z',
    history_anchor_rule: 'Fixed fiction date. Builds and tests that need a reproducible tenant set STACKSIM_FIXED_NOW to this value; otherwise the simulator anchors seeded history to build time floored to the UTC day (SeedEngine). Seeded history = anchor minus fixed offsets.',
    organization: {
      legal_name: 'Hollinford Precision Machining LLC (FICTIONAL)',
      short_name: 'Hollinford Precision (FICTIONAL)',
      domain: DOMAIN,
      uei: 'SIMX7Q2M4K9P',
      cage: '9S4M1',
      naics: ['332710'],
      description: 'Fictional 45-person CNC machining subcontractor producing machined parts to prime-contractor drawings that carry CUI.',
      address: { street: '4100 Quarrystone Parkway, Unit 2', city: 'Fennick Falls', state: 'ZZ', zip: '00000', country: 'US' },
      phone: '+1-555-0142',
      facility_count: 1,
      facilities: [{ facility_id: 's1-fac-1', name: 'Quarrystone Plant', address_ref: 'organization.address' }],
      equipment: { cnc_machines: 24, inspection_machines: 3 },
      license: { primary_sku: 'Microsoft 365 G5 (GCC High)', identity_model: 'cloud-only', cloud: 'GCC High' },
      roles: Object.fromEntries(
        ['owner', 'authorizing_official', 'isso', 'issm', 'fso', 'administrator', 'cui_manager'].map((r) => {
          const p = people.find((x) => x.person_id === roles[r]);
          return [r, { person_id: p.person_id, display_name: p.display_name, upn: p.upn, job_title: p.job_title }];
        }),
      ),
    },
    accounts_summary: { staff: 45, admin: 4, break_glass: 2, service: 2, total: accounts.length },
    accounts,
    groups,
    cui_enclave: { group_id: 'group-1', member_count: enclave.length, sharepoint_site: `https://${SLUG}.sharepoint.us/sites/cui-enclave`, teams_channels: ['CUI-Programs', 'CUI-Engineering-Drawings'], flow: 'prime -> encrypted mail -> SharePoint enclave -> programming VM -> shop floor via jump box' },
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
      windows11_intune: 52,
      windows11_breakdown: { staff: 40, kiosk: 8, machining_programming: 4 },
      ios: 6,
      compliant: 50,
      naming: { staff: 'S1-WS-NNN', kiosk: 'S1-KIOSK-NN', programming: 'S1-PRG-NN', ios: 'S1-IOS-NN' },
    },
    conditional_access: [
      'S1-CA01 Require MFA - all users',
      'S1-CA02 Phishing-resistant MFA - admin roles',
      'S1-CA03 Block legacy authentication',
      'S1-CA04 Require compliant device - CUI enclave',
      'S1-CA05 Require compliant device - all apps',
      'S1-CA06 Block sign-in from outside US',
      'S1-CA07 Sign-in risk high - block',
      'S1-CA08 Admin portals - compliant device and MFA',
      'S1-CA09 Session lifetime 12h - browser',
    ].map((name, i) => ({ policy_id: `caPolicy-${i + 1}`, name, state: 'enabled', excludes_group: 'group-12' })),
    baseline: { intune_security_baseline: true, bitlocker: true },
    dlp_policies: ['S1-DLP CUI in SharePoint enclave', 'S1-DLP CUI in Exchange (external block)', 'S1-DLP CUI in Teams'],
    sensitivity_label: { name: 'CUI', description: 'Controlled Unclassified Information - encrypt, enclave only' },
    azure_government: {
      subscription_id: simGuid(0xa2, 1),
      subscription_name: 's1-mach-gov-prod',
      region: 'usgovvirginia',
      resource_group: 'rg-s1-mach-prod',
      vms: [
        { name: 'vm-s1-prog-01', role: 'CNC programming VM (CAM)', subnet: 'snet-s1-workload', private_ip: '10.51.2.10' },
        { name: 'vm-s1-jump-01', role: 'Shop-floor jump box', subnet: 'snet-s1-mgmt', private_ip: '10.51.1.10' },
        { name: 'vm-s1-file-01', role: 'CUI file staging', subnet: 'snet-s1-workload', private_ip: '10.51.2.11' },
      ],
      vnet: {
        name: 'vnet-s1-mach-prod',
        address_space: '10.51.0.0/16',
        subnets: [
          { name: 'snet-s1-mgmt', cidr: '10.51.1.0/24' },
          { name: 'snet-s1-workload', cidr: '10.51.2.0/24' },
          { name: 'snet-s1-shopfloor', cidr: '10.51.3.0/24' },
        ],
      },
      nsg: 'nsg-s1-workload',
      key_vault: 'kv-s1-mach-prod',
      log_analytics: 'law-s1-mach-prod',
      backup_vault: 'rsv-s1-mach-prod',
      allowed_admin_source: '198.51.100.0/24',
    },
  };
  return customer;
}

export function scanStrings(obj, denylist) {
  const hits = [];
  const walk = (v, p) => {
    if (typeof v === 'string') {
      for (const rx of denylist) if (rx.test(v)) hits.push(`${p}: ${rx}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { walk(k, `${p}.<key>`); walk(x, `${p}.${k}`); }
  };
  walk(obj, '$');
  return hits;
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
  console.log(`wrote ${OUT}: ${customer.accounts.length} accounts, ${customer.groups.length} groups, denylist clean`);
}

// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

// build-customer-scenario.mjs - generates scenarios/<slug>.json for a
// synthetic customer (synthetic-customer PLAN §2.2) from
// scenarios/<slug>.config.json, generalising the demo-dib-small builder.
//
// The config is the editable scenario source; it REFERENCES the customer's
// identity file (customer.json, the fictional organisation and roster) by a
// path relative to this repo's root and never copies the roster. The output
// scenario is what ScenarioEngine replays: the roster, group, device and CA
// names go in as PATCH steps through the real resolver path; the 90-day
// history and Azure names go in as seedContext for the customer-history seed
// set (src/seed/sets/customerHistory.ts).
//
//   node scripts/build-customer-scenario.mjs s1-mach           (write)
//   node scripts/build-customer-scenario.mjs s1-mach --check   (drift guard; exit 1 on drift)
//
// tests/integration/customer-scenarios.test.ts runs the same drift guard.
import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const configPath = (slug) => path.join(ROOT, 'scenarios', `${slug}.config.json`);
export const scenarioPath = (slug) => path.join(ROOT, 'scenarios', `${slug}.json`);

/** Generators replaced by customer-history records (their generic objects would carry live clocks or sim names). */
const REPLACED_BY_HISTORY = [
  'devices', 'roleAssignments', 'pimSchedules', 'secureScores', 'alerts', 'riskDetections', 'vulnerabilities',
  'signInLogs', 'authenticationMethodUserRegistrationDetails', 'dlpPolicies', 'dlpCompliancePolicy',
  'vnets', 'nsgs', 'keyVaults', 'logAnalyticsWorkspaces', 'keyVaultKeys', 'keyVaultCertificates',
  // synthetic-customer W5c1-b: the customer's own policies replace the
  // profile's generic placeholders (customerHistory.ts seeds them).
  'authenticationMethodsPolicyConfigurations', 'policyLabels', 'sensitivityLabels', 'roleManagementPolicies',
  'deviceManagementConfigurationPolicies', 'deviceCompliancePolicies',
  // W5c2 follow-up 6 (SIM-A2, SIM-B2/B4/B9): S1's named locations and Intune
  // device configurations replace the generic placeholders.
  'namedLocations', 'deviceConfigurations',
];

/** synthetic-customer W6 (S3): the m365-azure profile's generic Azure generators not in REPLACED_BY_HISTORY. */
const AZURE_GENERATORS = ['storageAccounts', 'automationAccounts', 'managedIdentities', 'firewalls'];

/**
 * W5c2 follow-up 6 (SIM-A2): S1's Conditional Access named locations (S1 sim
 * id family). CA06 ("Block sign-in from outside US") excludes the US country
 * location; the admin egress range is the office's RFC 5737 range.
 */
export const S1_NAMED_LOCATIONS = [
  { seedId: '51510000-00b1-4000-8000-000000000001', name: 'S1 United States', kind: 'country', countries: ['US'] },
  { seedId: '51510000-00b1-4000-8000-000000000002', name: 'S1 Quarrystone office egress', kind: 'ip', cidrs: ['198.51.100.0/24'] },
];

export function loadCustomerConfig(slug) {
  return JSON.parse(readFileSync(configPath(slug), 'utf8'));
}

export function loadCustomer(cfg) {
  return JSON.parse(readFileSync(path.resolve(ROOT, cfg.customer), 'utf8'));
}

/**
 * synthetic-customer W6 (S2): a customer whose customer.json lists its fleet
 * explicitly (`devices.inventory`: device_name, os, kind, owner_person_id,
 * ownership) gets exactly that list, in order. Android phones carry
 * `cfg.osVersions.android`; `ownership: 'personal'` marks a BYOD device.
 */
function planInventory(cfg, customer) {
  const byPerson = new Map(customer.accounts.map((a) => [a.person_id, a]));
  const version = { Windows: cfg.osVersions.windows, iOS: cfg.osVersions.ios, Android: cfg.osVersions.android };
  return customer.devices.inventory.map((d, i) => ({
    seedId: `managedDevice-${i + 1}`,
    entraId: `device-${i + 1}`,
    deviceName: d.device_name,
    os: d.os,
    osVersion: version[d.os],
    kind: d.kind,
    upn: d.owner_person_id ? byPerson.get(d.owner_person_id).upn : null,
    ownership: d.ownership,
    compliant: !customer.devices.noncompliant.includes(d.device_name),
    encrypted: !customer.devices.unencrypted.includes(d.device_name),
  }));
}

/** Device list: staff PCs, programming stations, kiosks, iOS - in managedDevice-N order. */
export function planDevices(cfg, customer) {
  if (Array.isArray(customer.devices.inventory)) return planInventory(cfg, customer);
  const staff = customer.accounts.filter((a) => a.kind === 'staff');
  const dv = customer.devices;
  const b = dv.windows11_breakdown;
  const nonProd = staff.filter((a) => a.department !== 'Production');
  const prod = staff.filter((a) => a.department === 'Production');
  const pcOwners = [...nonProd, ...prod].slice(0, b.staff);
  const programmers = staff.filter((a) => a.department === 'Programming');
  const out = [];
  const name = (pattern, n) => pattern.replace(/N+/, (m) => String(n).padStart(m.length, '0'));
  const push = (kind, os, deviceName, owner) => out.push({ kind, os, deviceName, upn: owner ? owner.upn : null });
  for (let i = 0; i < b.staff; i++) push('staff', 'Windows', name(dv.naming.staff, i + 1), pcOwners[i]);
  for (let i = 0; i < b.machining_programming; i++) push('programming', 'Windows', name(dv.naming.programming, i + 1), programmers[i % programmers.length]);
  for (let i = 0; i < b.kiosk; i++) push('kiosk', 'Windows', name(dv.naming.kiosk, i + 1), null);
  for (let i = 0; i < dv.ios; i++) push('ios', 'iOS', name(dv.naming.ios, i + 1), staff[i]);
  return out.map((d, i) => ({
    seedId: `managedDevice-${i + 1}`,
    entraId: `device-${i + 1}`,
    deviceName: d.deviceName,
    os: d.os,
    osVersion: d.os === 'iOS' ? cfg.osVersions.ios : cfg.osVersions.windows,
    kind: d.kind,
    upn: d.upn,
    compliant: !cfg.devices.noncompliant.includes(d.deviceName),
    encrypted: !cfg.devices.unencrypted.includes(d.deviceName),
  }));
}

function caPolicyBody(p, customer) {
  // synthetic-customer W6 (S3): a policy with `break_glass_excluded: false`
  // excludes nobody (S3 has no break-glass group and no exclusion).
  const excluded = p.break_glass_excluded !== false;
  const bg = excluded ? customer.accounts.filter((a) => a.kind === 'break_glass').map((a) => a.seed_id) : [];
  const bgGroups = excluded ? [customer.groups.find((g) => g.name.endsWith('Break-Glass')).group_id] : [];
  const users = (extra = {}) => ({ includeUsers: ['All'], excludeUsers: bg, excludeGroups: bgGroups, ...extra });
  const apps = { includeApplications: ['All'] };
  const roles = customer.pim.eligible_roles.map((r) => r.template_id);
  const cuiGroup = customer.cui_enclave.group_id;
  const grant = (builtInControls, operator = 'OR', extra = {}) => ({ operator, builtInControls, ...extra });
  // synthetic-customer W6 (S2): a policy that names its `template` is built
  // from that template; S1's policies (no template) keep their numbered bodies.
  const byTemplate = {
    mfa_all_users: { conditions: { users: users(), applications: apps }, grantControls: grant(['mfa']) },
    block_legacy_auth: { conditions: { users: users(), applications: apps, clientAppTypes: ['exchangeActiveSync', 'other'] }, grantControls: grant(['block']) },
    mfa_admin_roles: { conditions: { users: { includeUsers: [], includeRoles: roles, excludeUsers: bg, excludeGroups: bgGroups }, applications: apps }, grantControls: grant(['mfa']) },
  };
  if (p.template) return { displayName: p.name, state: p.state, ...byTemplate[p.template] };
  const n = Number(p.policy_id.replace('caPolicy-', ''));
  const byNumber = {
    1: { conditions: { users: users(), applications: apps }, grantControls: grant(['mfa']) },
    2: { conditions: { users: { includeUsers: [], includeRoles: roles, excludeUsers: bg, excludeGroups: bgGroups }, applications: apps }, grantControls: grant([], 'OR', { authenticationStrength: { id: '00000000-0000-0000-0000-000000000004', displayName: 'Phishing-resistant MFA' } }) },
    3: { conditions: { users: users(), applications: apps, clientAppTypes: ['exchangeActiveSync', 'other'] }, grantControls: grant(['block']) },
    4: { conditions: { users: { includeUsers: [], includeGroups: [cuiGroup], excludeUsers: bg, excludeGroups: bgGroups }, applications: { includeApplications: ['Office365'] } }, grantControls: grant(['compliantDevice']) },
    5: { conditions: { users: users(), applications: apps, platforms: { includePlatforms: ['windows', 'iOS'] } }, grantControls: grant(['compliantDevice']) },
    6: { conditions: { users: users(), applications: apps, locations: { includeLocations: ['All'], excludeLocations: [S1_NAMED_LOCATIONS.find((l) => l.kind === 'country').seedId] } }, grantControls: grant(['block']) },
    7: { conditions: { users: users(), applications: apps, signInRiskLevels: ['high'] }, grantControls: grant(['block']) },
    8: { conditions: { users: users(), applications: { includeApplications: ['MicrosoftAdminPortals'] } }, grantControls: grant(['mfa', 'compliantDevice'], 'AND') },
    9: { conditions: { users: users(), applications: apps, clientAppTypes: ['browser'] }, sessionControls: { signInFrequency: { value: 12, type: 'hours', isEnabled: true }, persistentBrowser: { mode: 'never', isEnabled: true } } },
  };
  return { displayName: p.name, state: p.state, ...byNumber[n] };
}

export function buildCustomerScenario(cfg, customer) {
  if (customer.slug !== cfg.slug) throw new Error(`customer.json slug "${customer.slug}" != config slug "${cfg.slug}"`);
  const seedOf = new Map(customer.accounts.map((a) => [a.person_id, a.seed_id]));
  const devices = planDevices(cfg, customer);
  const steps = [];

  for (const a of customer.accounts) {
    const body = { displayName: a.display_name, userPrincipalName: a.upn, jobTitle: a.job_title, department: a.department };
    if (a.lifecycle && a.lifecycle.account_enabled === false) body.accountEnabled = false;
    if (a.employee_type) body.employeeType = a.employee_type;
    steps.push({ kind: 'uri', method: 'PATCH', uri: `/v1.0/users/${a.seed_id}`, body, note: `${a.kind}${a.lifecycle ? ` (${a.lifecycle.event})` : ''}` });
  }
  for (const g of customer.groups) {
    const keep = g.group_id === 'group-1';
    const body = keep ? { description: g.purpose } : { displayName: g.name, description: g.purpose };
    steps.push({ kind: 'uri', method: 'PATCH', uri: `/v1.0/groups/${g.group_id}`, body, note: keep ? "CUI enclave: displayName stays the seeded 'CUI-Authorized-Users' (EO filters on it)" : '' });
  }
  for (const d of devices) {
    const body = { deviceName: d.deviceName, userPrincipalName: d.upn ?? '' };
    if (!d.compliant) body.complianceState = 'noncompliant';
    if (!d.encrypted) body.isEncrypted = false;
    if (d.ownership === 'personal') body.managedDeviceOwnerType = 'personal';
    steps.push({ kind: 'uri', method: 'PATCH', uri: `/v1.0/deviceManagement/managedDevices/${d.seedId}`, body, note: d.kind });
  }
  for (const p of customer.conditional_access) {
    steps.push({ kind: 'uri', method: 'PATCH', uri: `/v1.0/identity/conditionalAccess/policies/${p.policy_id}`, body: caPolicyBody(p, customer), note: p.break_glass_excluded === false ? 'break-glass NOT excluded (S3 deficiency)' : 'break-glass excluded' });
  }

  const n = customer.pim.eligible_principals.length;
  // synthetic-customer W6 (S3): no PIM eligibility at all (no principals).
  const eligible = n === 0 ? [] : customer.pim.eligible_roles.map((r, i) => ({ principalSeedId: seedOf.get(customer.pim.eligible_principals[i % n]), role: r.role, roleTemplateId: r.template_id }));
  // The context is keyed by the scenario's seed set (S1 'customer-history';
  // synthetic-customer W6: S2 'customer-history-s2').
  const seedContext = {
    [cfg.seedSets[0]]: {
      slug: customer.slug,
      domain: customer.organization.domain,
      accounts: customer.accounts.map((a) => ({
        seedId: a.seed_id,
        upn: a.upn,
        displayName: a.display_name,
        kind: a.kind,
        department: a.department,
        jobTitle: a.job_title,
        // W5c1-b: the security roles a person holds, and an admin account's owner (the PIM approver).
        ...(a.roles?.length ? { roles: a.roles } : {}),
        ...(a.owner_person_id ? { ownerSeedId: seedOf.get(a.owner_person_id) } : {}),
        ...(a.lifecycle ? { lifecycle: { event: a.lifecycle.event, days_before_anchor: a.lifecycle.days_before_anchor, account_enabled: a.lifecycle.account_enabled } } : {}),
        // synthetic-customer W6 (S2): contractor marker and the on-premises AD attributes of a synced account.
        ...(a.employee_type ? { employeeType: a.employee_type } : {}),
        ...(a.on_premises ? { onPremises: a.on_premises } : {}),
        // synthetic-customer W6 (S3): days since an idle account last signed in; the shared login.
        ...(a.inactive_days ? { inactiveDays: a.inactive_days } : {}),
        ...(a.shared ? { shared: true } : {}),
      })),
      groups: customer.groups.map((g) => ({ seedId: g.group_id, name: g.name, memberSeedIds: g.member_person_ids.map((p) => seedOf.get(p)) })),
      devices,
      pim: {
        eligible,
        breakGlassSeedIds: customer.accounts.filter((a) => a.kind === 'break_glass').map((a) => a.seed_id),
        globalAdministratorTemplateId: customer.pim.eligible_roles.find((r) => r.role === 'Global Administrator').template_id,
      },
      dlpPolicies: customer.dlp_policies,
      sensitivityLabel: customer.sensitivity_label,
      licensing: cfg.licensing,
      azure: customer.azure_government,
      // synthetic-customer W1: /me = the administrator's separate admin account; /organization's display name.
      operatorSeedId: customer.accounts.find((a) => a.kind === 'admin' && a.owner_person_id === customer.organization.roles.administrator.person_id).seed_id,
      organization: { displayName: customer.organization.legal_name },
      // W5c2 follow-up 6 (SIM-A2): the named locations CA06 references.
      // synthetic-customer W6: a customer.json that lists its own (S2) uses those.
      namedLocations: customer.named_locations ?? S1_NAMED_LOCATIONS,
      // synthetic-customer W6 (S2): the hybrid identity facts and the app-protection (MAM) policy names.
      ...(customer.hybrid_identity ? { hybrid: customer.hybrid_identity } : {}),
      ...(customer.mam ? { mam: customer.mam } : {}),
      ...(customer.hybrid_identity ? { caPolicyIds: customer.conditional_access.map((p) => p.policy_id) } : {}),
      // synthetic-customer W6 (S3, deficient by design): standing role holders,
      // the CA ids, the devices carrying critical CVEs and the empty subscription.
      ...(customer.deficient_by_design
        ? {
            deficient: {
              standing: customer.pim.standing.map((s) => ({ principalSeedId: seedOf.get(s.person_id), role: s.role, roleTemplateId: s.template_id })),
              caPolicyIds: customer.conditional_access.map((p) => p.policy_id),
              criticalCveDevices: customer.devices.critical_cve_devices,
              subscriptionId: customer.azure_subscription_id,
            },
          }
        : {}),
    },
  };

  const countOverrides = {
    users: customer.accounts.length,
    groups: customer.groups.length,
    managedDevices: devices.length,
    caPolicies: customer.conditional_access.length,
    ...Object.fromEntries(REPLACED_BY_HISTORY.map((k) => [k, 0])),
    // synthetic-customer W6 (S3): no Azure resource at all, so the stance's
    // generic Azure generators are zeroed too (the facade emits nothing).
    ...(customer.azure_government === null ? Object.fromEntries(AZURE_GENERATORS.map((k) => [k, 0])) : {}),
    // synthetic-customer W6 (S3): the generic generator's 3 FIDO2 methods would
    // contradict S3's no-FIDO2 registration state; S3's seed set lists every method.
    ...(customer.deficient_by_design ? { authMethods: 0 } : {}),
  };

  return {
    name: cfg.slug,
    description: cfg.description,
    stance: cfg.stance,
    countOverrides,
    seedSets: cfg.seedSets,
    seedContext,
    steps,
  };
}

// CLI entry.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const slug = process.argv[2];
  if (!slug) {
    console.error('usage: node scripts/build-customer-scenario.mjs <slug> [--check]');
    process.exit(2);
  }
  const cfg = loadCustomerConfig(slug);
  const scenario = buildCustomerScenario(cfg, loadCustomer(cfg));
  const text = JSON.stringify(scenario, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    let same = false;
    try { same = readFileSync(scenarioPath(slug), 'utf8') === text; } catch { same = false; }
    console.log(same ? `${slug}.json up to date` : `${slug}.json DRIFT: run node scripts/build-customer-scenario.mjs ${slug}`);
    process.exit(same ? 0 : 1);
  }
  writeFileSync(scenarioPath(slug), text, 'utf8');
  console.log(`customer:build -> wrote ${scenarioPath(slug)} (${scenario.steps.length} steps, ${scenario.countOverrides.users} users)`);
}

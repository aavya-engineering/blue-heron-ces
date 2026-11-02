// Generator-owned reference data: where each repo sits in the workspace, its GitHub name, and the
// plain-English gloss for each component. Used by gen.mjs (README, BUILD-ORDER) and check.mjs.

/** repo id (manifest `repo`) -> folder relative to the workspace root, and GitHub repository name. */
export const REPO_INFO = {
  'ces-mono': { dir: '.', github: 'ces-mono' },
  'ces-tenant': { dir: 'ces-tenant', github: 'ces-tenant' },
  'ces-muster': { dir: 'ces-muster', github: 'ces-muster' },
  'ces-tester': { dir: 'ces-tester', github: 'ces-tester' },
  'tenant-stacksim': { dir: 'tenant-stacksim', github: 'ces-stacksim' },
  // The run package lives beside the workspace, not inside it; no component uses it today.
  'ces-muster-run': { dir: null, github: null },
};

export const ORG_URL = 'https://github.com/blue-heron-defense-CES';

/** Plain-English gloss per component id. Missing ids fall back to the kind. */
export const COMPONENT_GLOSS = {
  'ces-tenant': 'Tenant connection library: the tenant registry, how each module signs in, and the PowerShell session factory.',
  'ces-shared': 'Shared library: contracts, the SQLite store (ces.db), module secrets and HTTP auth helpers.',
  'ces-stamper': 'Stamper: applies the mission plan to the tenant and records what it did (GUI and CLI).',
  'ces-eo': 'EO (EvidenceOps): evidence store, assessment, SSP and SPRS outputs.',
  'ces-ao': 'AO (AdminOps): runs approved admin commands against the tenant and writes AdminOps evidence.',
  'ces-ec': 'EC (Evidence Collector): manual evidence intake and a hash-verified integrity ledger.',
  'ces-ui-kit': 'Shared UI kit the three module consoles are built from.',
  'ces-stamper-ui': "Stamper's web console.",
  'ces-ao-ui': "AO's web console.",
  'ces-eo-ui': "EO's web console.",
  'tenant-stacksim': 'Simulator: a fake Microsoft 365 GCC High tenant. Build and test against it first.',
  'ces-tester': 'End-to-end test harness and demo engine; drives the modules against the simulator.',
  'ces-muster': 'Muster: the data-collection UI; it collects customer data and writes the plan.',
  'muster-api': "Muster's API server (accounts, engagements, plan compile, push to EO).",
};

/** Terms used in the generated documents, defined once for each legend. */
export const LEGEND = [
  ['AO', 'AdminOps, the module that runs approved admin commands (component ces-ao).'],
  ['EO', 'EvidenceOps, the evidence and assessment module (component ces-eo).'],
  ['EC', 'Evidence Collector, manual evidence intake (component ces-ec).'],
  ['Stamper', 'the module that applies the plan to the tenant (component ces-stamper).'],
  ['Muster', 'the data-collection module that writes the plan (components ces-muster, muster-api).'],
  ['SSP', 'System Security Plan, the document EO generates.'],
  ['SPRS', 'Supplier Performance Risk System, the DoD score EO computes.'],
  ['GCC High', 'Microsoft 365 Government Community Cloud High, the target tenant type.'],
  ['DP-1, DP-2', 'the two operator confirmations of the cost gate: DP-1 is the plan-time opt-in (cost-acks.json, ces-shared/src/types/cost-gate.types.ts), DP-2 the run-time typed confirmation (ces-stamper/src/adapters/CostGateDp2.ts).'],
  ['SBOM', 'software bill of materials, one CycloneDX file per install root in sbom/.'],
  ['DPAPI', 'Windows Data Protection API, which encrypts the module-secret store; see secrets.inventory.yaml.'],
  ['workspace root', 'the ces-mono clone; the other repos sit in folders inside it.'],
];

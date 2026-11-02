// Shared fixture builder for the handoff tests: a tiny workspace, run package and kit in a temp dir.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export const SHA_A = 'a'.repeat(40);
export const SHA_B = 'b'.repeat(40);

export function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

export const MANIFEST = `schemaVersion: 1
release: { id: "fx-1", cut: "2026-11-01", status: draft }
toolchain:
  - { name: node, version: "24.12.0", why: "runtime", check: "node --version" }
components:
  - id: ces-tenant
    repo: ces-tenant
    path: "."
    commit: "${SHA_B}"
    kind: library
    build: "npm ci && npm run build"
    deps: []
    ports: []
    test: "npm test"
  - id: ces-shared
    repo: ces-mono
    path: ces-shared
    commit: "${SHA_A}"
    kind: library
    build: "npm ci && npm run build -w ces-shared"
    deps: [ces-tenant]
    ports: []
    test: "npm test -w ces-shared"
  - id: ces-eo
    repo: ces-mono
    path: ces-eo
    commit: "${SHA_A}"
    kind: server
    build: "npm run build -w ces-eo"
    deps: [ces-shared, ces-tenant]
    ports:
      - { port: 4002, service: "EO", bind: "0.0.0.0", configKey: EO_PORT }
    test: "npm test -w ces-eo"
`;

export const CONTRACTS = `schemaVersion: 1
contracts:
  - id: plan
    kind: file
    version: "1.0.0"
    producer: ces-shared
    consumers: [ces-eo]
    source: "ces-shared/src/plan.ts:2"
    compat: "N and N-1"
  - id: db
    kind: db
    version: "unversioned"
    producer: ces-shared
    consumers: [ces-eo]
    source: "ces-shared/src/plan.ts:1"
    compat: "none"
`;

export const SCHEMA = `schemaVersion: 1
settings:
  - name: CES_PIPELINE_ROOT
    component: [ces-shared]
    required: false
    default: "unset = ~/.ces"
    allowed: "a folder path"
    secret: false
    owner: operator
    scope: all
    description: "Where CES keeps its data."
    source: "ces-shared/src/storage.ts:1"
  - name: CES_EO_AUTH_TOKEN
    component: [ces-eo]
    required: false
    default: null
    allowed: "any string"
    secret: true
    owner: contractor
    scope: all
    description: "EO bearer token."
    source: "ces-eo/src/index.ts:1"
  - name: EO_PORT
    component: [ces-eo]
    required: true
    default: 4002
    allowed: "1-65535"
    secret: false
    owner: operator
    scope: all
    description: "EO port."
    source: "ces-eo/src/index.ts:2"
`;

export const INVENTORY = `schemaVersion: 1
secrets:
  - name: CES_EO_AUTH_TOKEN
    purpose: "EO bearer token"
    component: [ces-eo]
    store: "DPAPI module-secret store"
    generatedBy: "New-CesModuleSecrets.ps1"
    howToCreate: "run the script"
    rotation: "per release"
    scope: all
    sharedByBHD: false
`;

export const IDENTITY_PS1 = `param()
$patterns = @(
  '(?i)[A-Z]:\\\\+Users\\\\+',
  '(?i)example-corp\\.test',
  '(?m)^Author: '
) + $Extra
`;

/** Build a fixture: { root, ws, pkg, kit }. opts.schema=false leaves config.schema.yaml out. */
export function makeFixture(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-fx-'));
  const ws = path.join(root, 'ces');
  const pkg = path.join(root, 'pkg', 'ces-muster-run');
  const kit = path.join(pkg, 'handoff');
  write(path.join(ws, 'package.json'), JSON.stringify({ name: 'ws', private: true, workspaces: ['ces-shared', 'ces-eo'] }));
  write(path.join(ws, 'ces-shared', 'package.json'), JSON.stringify({ name: 'ces-shared' }));
  write(path.join(ws, 'ces-shared', 'src', 'plan.ts'), "// db: CREATE TABLE IF NOT EXISTS t\nexport const PLAN_VERSION = '1.0.0';\n");
  write(path.join(ws, 'ces-shared', 'src', 'storage.ts'), "const r = process.env.CES_PIPELINE_ROOT;\n");
  write(path.join(ws, 'ces-shared', 'src', 'storage.test.ts'), "process.env.CES_TEST_ONLY = '1';\n");
  write(path.join(ws, 'ces-eo', 'package.json'), JSON.stringify({ name: 'ces-eo', dependencies: { 'ces-shared': '*', 'ces-tenant': 'file:../ces-tenant' } }));
  write(path.join(ws, 'ces-eo', 'src', 'index.ts'), "const t = secretEnv()['CES_EO_AUTH_TOKEN'];\nconst p = process.env.EO_PORT;\nconst kind = 'CES_PRODUCED';\ndelete env.CES_GONE;\n");
  write(path.join(ws, 'ces-tenant', '.git'), 'gitdir: elsewhere\n');
  write(path.join(ws, 'ces-tenant', 'package.json'), JSON.stringify({ name: 'ces-tenant' }));
  write(path.join(pkg, 'scripts', 'identity-scan.ps1'), IDENTITY_PS1);
  write(path.join(kit, 'handoff.manifest.yaml'), opts.manifest ?? MANIFEST);
  write(path.join(kit, 'contracts.yaml'), opts.contracts ?? CONTRACTS);
  if (opts.schema !== false) write(path.join(kit, 'config.schema.yaml'), opts.schema ?? SCHEMA);
  if (opts.inventory !== false) write(path.join(kit, 'secrets.inventory.yaml'), opts.inventory ?? INVENTORY);
  return { root, ws, pkg, kit };
}

/** git stub: every repo is at the commit the fixture manifest names. */
export const gitStub = (dir) => (dir.endsWith('ces-tenant') ? SHA_B : SHA_A);

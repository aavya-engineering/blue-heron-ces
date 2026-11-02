// Small hand-written validators for the kit's YAML files (no dependencies).
// Each validator returns { errors: string[], warnings: string[] }. Unknown keys are warnings
// (so a sibling agent can add a field without breaking the check); missing or wrong-typed
// required fields are errors.

export const REPOS = ['ces-mono', 'ces-muster', 'ces-tester', 'tenant-stacksim', 'ces-tenant', 'ces-muster-run'];
export const KINDS = ['library', 'server', 'ui', 'cli', 'simulator', 'test-harness'];
export const CONTRACT_KINDS = ['file', 'api', 'db', 'event'];
export const OWNERS = ['BHD', 'contractor', 'operator'];
export const SCOPES = ['dev', 'sim', 'live', 'all'];
export const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SHA = /^[0-9a-f]{40}$/;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
export const UNVERSIONED = 'unversioned';

function ctx() {
  const errors = [];
  const warnings = [];
  return {
    errors,
    warnings,
    err: (m) => errors.push(m),
    warn: (m) => warnings.push(m),
  };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim() !== '';

function knownKeys(c, where, obj, keys) {
  for (const k of Object.keys(obj)) if (!keys.includes(k)) c.warn(`${where}: unknown key "${k}"`);
}

function reqStr(c, where, obj, key) {
  if (!isStr(obj[key])) c.err(`${where}: "${key}" must be a non-empty string`);
}

function reqEnum(c, where, obj, key, allowed) {
  if (!allowed.includes(obj[key])) c.err(`${where}: "${key}" must be one of ${allowed.join('|')} (got ${JSON.stringify(obj[key])})`);
}

function strArray(c, where, obj, key, { required = true } = {}) {
  const v = obj[key];
  if (v === undefined || v === null) {
    if (required) c.err(`${where}: "${key}" must be a list`);
    return [];
  }
  if (!Array.isArray(v)) {
    c.err(`${where}: "${key}" must be a list`);
    return [];
  }
  v.forEach((x, i) => { if (!isStr(x)) c.err(`${where}: ${key}[${i}] must be a non-empty string`); });
  return v;
}

function schemaVersion(c, doc) {
  if (doc.schemaVersion !== 1) c.err(`schemaVersion must be 1 (got ${JSON.stringify(doc.schemaVersion)})`);
}

export function validateManifest(doc) {
  const c = ctx();
  if (!isObj(doc)) { c.err('manifest must be a mapping'); return c; }
  knownKeys(c, 'manifest', doc, ['schemaVersion', 'release', 'toolchain', 'components']);
  schemaVersion(c, doc);
  const r = doc.release;
  if (!isObj(r)) c.err('release must be a mapping');
  else {
    knownKeys(c, 'release', r, ['id', 'cut', 'status']);
    reqStr(c, 'release', r, 'id');
    if (!(typeof r.cut === 'string' && ISO_DATE.test(r.cut))) c.err('release: "cut" must be an ISO date (YYYY-MM-DD)');
    reqEnum(c, 'release', r, 'status', ['draft', 'pinned']);
  }
  if (!Array.isArray(doc.toolchain)) c.err('toolchain must be a list');
  else {
    const seen = new Set();
    doc.toolchain.forEach((t, i) => {
      const w = `toolchain[${i}]`;
      if (!isObj(t)) { c.err(`${w} must be a mapping`); return; }
      knownKeys(c, w, t, ['name', 'version', 'why', 'check']);
      for (const k of ['name', 'version', 'why', 'check']) reqStr(c, w, t, k);
      if (seen.has(t.name)) c.err(`${w}: duplicate toolchain name "${t.name}"`);
      seen.add(t.name);
    });
  }
  if (!Array.isArray(doc.components) || doc.components.length === 0) c.err('components must be a non-empty list');
  else {
    const ids = new Set();
    doc.components.forEach((m, i) => {
      if (isObj(m) && isStr(m.id)) {
        if (ids.has(m.id)) c.err(`components[${i}]: duplicate id "${m.id}"`);
        ids.add(m.id);
      }
    });
    doc.components.forEach((m, i) => {
      const w = `components[${i}]${isObj(m) && m.id ? ` (${m.id})` : ''}`;
      if (!isObj(m)) { c.err(`${w} must be a mapping`); return; }
      knownKeys(c, w, m, ['id', 'repo', 'path', 'commit', 'kind', 'build', 'cwd', 'deps', 'ports', 'test']);
      if (!(typeof m.id === 'string' && KEBAB.test(m.id))) c.err(`${w}: "id" must be kebab-case`);
      reqEnum(c, w, m, 'repo', REPOS);
      reqStr(c, w, m, 'path');
      if (!(typeof m.commit === 'string' && (SHA.test(m.commit) || m.commit === 'HEAD-at-cut'))) c.err(`${w}: "commit" must be a 40-hex sha or "HEAD-at-cut"`);
      reqEnum(c, w, m, 'kind', KINDS);
      reqStr(c, w, m, 'build');
      if (m.cwd !== undefined && m.cwd !== null && !isStr(m.cwd)) c.err(`${w}: "cwd" must be a string when given`);
      for (const d of strArray(c, w, m, 'deps')) if (!ids.has(d)) c.err(`${w}: dep "${d}" is not a component id`);
      if (m.ports !== undefined && m.ports !== null) {
        if (!Array.isArray(m.ports)) c.err(`${w}: "ports" must be a list`);
        else m.ports.forEach((pt, j) => {
          const pw = `${w}.ports[${j}]`;
          if (!isObj(pt)) { c.err(`${pw} must be a mapping`); return; }
          knownKeys(c, pw, pt, ['port', 'service', 'bind', 'configKey']);
          if (!(Number.isInteger(pt.port) && pt.port > 0 && pt.port < 65536)) c.err(`${pw}: "port" must be an integer 1-65535`);
          reqStr(c, pw, pt, 'service');
          reqStr(c, pw, pt, 'bind');
          reqStr(c, pw, pt, 'configKey');
        });
      }
      reqStr(c, w, m, 'test');
    });
  }
  return c;
}

export function validateContracts(doc, componentIds) {
  const c = ctx();
  if (!isObj(doc)) { c.err('contracts must be a mapping'); return c; }
  knownKeys(c, 'contracts', doc, ['schemaVersion', 'contracts']);
  schemaVersion(c, doc);
  if (!Array.isArray(doc.contracts)) { c.err('contracts must be a list'); return c; }
  const seen = new Set();
  doc.contracts.forEach((k, i) => {
    const w = `contracts[${i}]${isObj(k) && k.id ? ` (${k.id})` : ''}`;
    if (!isObj(k)) { c.err(`${w} must be a mapping`); return; }
    knownKeys(c, w, k, ['id', 'kind', 'version', 'producer', 'consumers', 'source', 'compat']);
    if (!(typeof k.id === 'string' && KEBAB.test(k.id))) c.err(`${w}: "id" must be kebab-case`);
    if (seen.has(k.id)) c.err(`${w}: duplicate id`);
    seen.add(k.id);
    reqEnum(c, w, k, 'kind', CONTRACT_KINDS);
    reqStr(c, w, k, 'version');
    reqStr(c, w, k, 'producer');
    if (componentIds && isStr(k.producer) && !componentIds.has(k.producer)) c.err(`${w}: producer "${k.producer}" is not a component id`);
    for (const x of strArray(c, w, k, 'consumers')) if (componentIds && !componentIds.has(x)) c.err(`${w}: consumer "${x}" is not a component id`);
    if (!(typeof k.source === 'string' && /^[^:]+:\d+$/.test(k.source))) c.err(`${w}: "source" must be "<path>:<line>"`);
    reqStr(c, w, k, 'compat');
  });
  return c;
}

export function validateConfigSchema(doc, componentIds) {
  const c = ctx();
  if (!isObj(doc)) { c.err('config schema must be a mapping'); return c; }
  knownKeys(c, 'config.schema', doc, ['schemaVersion', 'settings']);
  schemaVersion(c, doc);
  if (!Array.isArray(doc.settings)) { c.err('settings must be a list'); return c; }
  const seen = new Set();
  doc.settings.forEach((s, i) => {
    const w = `settings[${i}]${isObj(s) && s.name ? ` (${s.name})` : ''}`;
    if (!isObj(s)) { c.err(`${w} must be a mapping`); return; }
    knownKeys(c, w, s, ['name', 'component', 'required', 'default', 'allowed', 'secret', 'owner', 'scope', 'description', 'source']);
    if (!(typeof s.name === 'string' && ENV_NAME.test(s.name))) c.err(`${w}: "name" must match ${ENV_NAME}`);
    if (seen.has(s.name)) c.err(`${w}: duplicate name`);
    seen.add(s.name);
    for (const x of strArray(c, w, s, 'component')) if (componentIds && !componentIds.has(x)) c.err(`${w}: component "${x}" is not a manifest component id`);
    if (typeof s.required !== 'boolean') c.err(`${w}: "required" must be true or false`);
    if (typeof s.secret !== 'boolean') c.err(`${w}: "secret" must be true or false`);
    if (!('default' in s)) c.warn(`${w}: no "default" key`);
    reqEnum(c, w, s, 'owner', OWNERS);
    reqEnum(c, w, s, 'scope', SCOPES);
    reqStr(c, w, s, 'description');
    reqStr(c, w, s, 'source');
  });
  return c;
}

export function validateInventory(doc, componentIds) {
  const c = ctx();
  if (!isObj(doc)) { c.err('secrets inventory must be a mapping'); return c; }
  knownKeys(c, 'secrets.inventory', doc, ['schemaVersion', 'secrets']);
  schemaVersion(c, doc);
  if (!Array.isArray(doc.secrets)) { c.err('secrets must be a list'); return c; }
  const seen = new Set();
  doc.secrets.forEach((s, i) => {
    const w = `secrets[${i}]${isObj(s) && s.name ? ` (${s.name})` : ''}`;
    if (!isObj(s)) { c.err(`${w} must be a mapping`); return; }
    for (const k of Object.keys(s)) if (/^(value|secretValue|secret_value|password)$/i.test(k)) c.err(`${w}: key "${k}" is not allowed (the inventory carries no values)`);
    knownKeys(c, w, s, ['name', 'purpose', 'component', 'store', 'generatedBy', 'howToCreate', 'rotation', 'scope', 'sharedByBHD']);
    reqStr(c, w, s, 'name');
    if (seen.has(s.name)) c.err(`${w}: duplicate name`);
    seen.add(s.name);
    for (const k of ['purpose', 'store', 'generatedBy', 'howToCreate', 'rotation']) reqStr(c, w, s, k);
    for (const x of strArray(c, w, s, 'component')) if (componentIds && !componentIds.has(x)) c.err(`${w}: component "${x}" is not a manifest component id`);
    reqEnum(c, w, s, 'scope', SCOPES);
    if (typeof s.sharedByBHD !== 'boolean') c.err(`${w}: "sharedByBHD" must be true or false`);
  });
  return c;
}

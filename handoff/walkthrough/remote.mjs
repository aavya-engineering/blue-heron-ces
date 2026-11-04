// Shape B, "remote" (PLAN.md section 11.2): the page runs on any machine and reaches the CES modules only over
// HTTP(S) at the addresses in `urls`, which may sit under path prefixes behind one reverse proxy.
//
// - detectMode: "ports" (shape A) when `mode` says so, or when every URL is loopback and the module roots are set;
//   "remote" otherwise.
// - makeHttp: the walkthrough's own HTTP(S) client. It trusts `tls.caFile` (a PEM file) through a per-request agent;
//   `tls.ignoreErrors: true` is the fallback. Nothing process-wide is changed (no NODE_TLS_REJECT_UNAUTHORIZED).
// - startForwarders: one small HTTP listener per module on 127.0.0.1, on a port the operating system picks (never a
//   held one). Each forwards to <module address><path>, so the browser sees every module at the root of its own
//   origin, exactly as on the kit ports: the consoles' root-absolute /api, /app and /assets calls, the SPAs' baked
//   "/app" router base, Server-Sent Events, downloads and relative redirects all behave as in shape A. The Stamper and
//   EvidenceOps forwarders add `Authorization: Bearer <token>` from config when the request carries none, and answer
//   only requests that carry this run's key header (set on the walkthrough's browser contexts), because they hold the
//   module owner's token. Request log lines record method, path, upstream and status, never headers or query strings.
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as crypto from 'node:crypto';
import * as path from 'node:path';

export const MODULES = ['muster', 'stamper', 'ao', 'eo'];
export const KEY_HEADER = 'x-walkthrough-key';
export const MODULE_HEADER = 'x-walkthrough-module';

const trim = (u) => String(u ?? '').replace(/\/+$/, '');

/** Empty, or an example placeholder such as "<its password>". */
export function isUnset(v) {
  return typeof v !== 'string' || v.trim() === '' || v.trim().startsWith('<');
}

function isLoopbackUrl(u) {
  try {
    const h = new URL(u).hostname.replace(/^\[|\]$/g, '');
    return h === 'localhost' || h === '::1' || /^127\./.test(h);
  } catch {
    return false;
  }
}

/** "ports" (shape A) or "remote" (shape B). */
export function detectMode(cfg) {
  if (cfg.mode === 'ports' || cfg.mode === 'remote') return cfg.mode;
  const urls = Object.values(cfg.urls ?? {}).filter((u) => typeof u === 'string' && /^https?:/.test(u));
  const rootsSet = cfg.roots && ['tenantRoot', 'pipelineRoot', 'storageRoot'].every((k) => !isUnset(cfg.roots[k]));
  return urls.length > 0 && urls.every(isLoopbackUrl) && rootsSet ? 'ports' : 'remote';
}

/** The built ces-tester folder the engine and Playwright load from (top-level `testerRoot`, or shape A's roots). */
export function testerRootOf(cfg) {
  return cfg.testerRoot ?? cfg.roots?.testerRoot;
}

/** The module address a forwarder or a readout targets. */
export function remoteBase(cfg, module) {
  const u = cfg.urls;
  switch (module) {
    case 'muster': return trim(u.musterSpa);
    case 'muster-api': return trim(u.musterApi);
    case 'stamper': return `${trim(u.stamper)}${u.stamperBasePath ?? ''}`;
    case 'ao': return trim(u.ao);
    case 'eo': return trim(u.eo);
    case 'stacksim': return trim(u.stacksim);
    case 'ec': return trim(u.ec);
    default: throw new Error(`no address for module ${module}`);
  }
}

/** The bearer the walkthrough adds for a module, or '' (AdminOps and Muster need none). */
export function bearerFor(cfg, module) {
  const t = module === 'stamper' ? cfg.tokens?.stamper : module === 'eo' ? cfg.tokens?.eo : module === 'ao' ? cfg.tokens?.ao : '';
  return isUnset(t) ? '' : t.trim();
}

/** TLS settings from config. `caFile` is resolved against the config file's folder. */
export function tlsOf(cfg, configDir) {
  const t = cfg.tls ?? {};
  let ca;
  let caFile;
  let error;
  if (!isUnset(t.caFile)) {
    caFile = path.resolve(configDir, t.caFile);
    try {
      ca = fs.readFileSync(caFile, 'utf8');
    } catch (err) {
      error = `cannot read tls.caFile ${caFile}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return { ca, caFile, ignoreErrors: t.ignoreErrors === true, error };
}

/** The walkthrough's own HTTP(S) client (health probes, readouts, the Stamper variable seed). */
export function makeHttp(tls) {
  const httpsAgent = new https.Agent({ keepAlive: true, ...(tls.ca ? { ca: tls.ca } : {}), rejectUnauthorized: !tls.ignoreErrors });
  const httpAgent = new http.Agent({ keepAlive: true });
  const agentFor = (u) => (u.protocol === 'https:' ? httpsAgent : httpAgent);
  const lib = (u) => (u.protocol === 'https:' ? https : http);

  /** One request; resolves { status, headers, text, json() } or { status: 0, error }. Never throws. */
  function request(url, { method = 'GET', headers = {}, body, timeoutMs = 15_000 } = {}) {
    return new Promise((resolve) => {
      let u;
      try {
        u = new URL(url);
      } catch (err) {
        resolve({ status: 0, text: '', error: `bad URL ${url}` });
        return;
      }
      const data = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(String(body));
      const req = lib(u).request(u, { method, agent: agentFor(u), headers: { ...headers, ...(data ? { 'content-length': data.length } : {}) } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json: () => JSON.parse(text) });
        });
        res.on('error', (err) => resolve({ status: 0, text: '', error: err.message }));
      });
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`no answer within ${timeoutMs} ms`)));
      req.on('error', (err) => resolve({ status: 0, text: '', error: err.message }));
      if (data) req.write(data);
      req.end();
    });
  }

  /** GET JSON from a module through its address, with its bearer; undefined unless 2xx JSON. */
  async function moduleJson(cfg, module, route, { method = 'GET', body, timeoutMs = 60_000 } = {}) {
    const t = bearerFor(cfg, module);
    const r = await request(`${remoteBase(cfg, module)}${route}`, {
      method,
      timeoutMs,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { accept: 'application/json', [MODULE_HEADER]: module, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(t ? { authorization: `Bearer ${t}` } : {}) },
    });
    if (r.status < 200 || r.status >= 300) return undefined;
    try {
      return r.json();
    } catch {
      return undefined;
    }
  }

  return { request, moduleJson, agents: { http: httpAgent, https: httpsAgent }, close: () => { httpsAgent.destroy(); httpAgent.destroy(); } };
}

/**
 * The per-module forwarders (see the file header). Resolves { origins, key, entries, stop }.
 * `origins[module]` is the http://127.0.0.1:<port> origin the browser and the engine use for that module.
 */
export async function startForwarders({ getCfg, httpClient, log, logFile }) {
  const cfg0 = getCfg();
  const key = crypto.randomBytes(24).toString('hex');
  const entries = [];
  const servers = [];
  const origins = {};
  const gated = new Set(['stamper', 'eo']);
  const out = logFile ? fs.createWriteStream(logFile, { flags: 'a' }) : null;
  const record = (e) => {
    entries.push(e);
    if (entries.length > 20000) entries.shift();
    if (out) out.write(`${JSON.stringify(e)}\n`);
  };

  for (const module of MODULES) {
    const base = remoteBase(cfg0, module);
    const apiBase = remoteBase(cfg0, 'muster-api');
    const server = http.createServer((req, res) => {
      const t0 = Date.now();
      const local = origins[module];
      const inUrl = new URL(req.url ?? '/', local);
      if (gated.has(module) && req.headers[KEY_HEADER] !== key) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('walkthrough forwarder: this listener answers only the walkthrough\'s own browser windows');
        record({ at: new Date().toISOString(), module, method: req.method, path: inUrl.pathname, upstream: null, status: 403, ms: 0, refused: 'no run key' });
        return;
      }
      // muster-api serves /api and, beside it, /auth (sign-in): both go to muster-api's address.
      const toApi = module === 'muster' && /^\/(api|auth)(\/|$)/.test(inUrl.pathname);
      const upstreamBase = toApi ? apiBase : base;
      const target = new URL(`${upstreamBase}${inUrl.pathname}${inUrl.search}`);
      const headers = { ...req.headers };
      for (const h of ['host', 'connection', 'keep-alive', KEY_HEADER, MODULE_HEADER, 'proxy-connection', 'upgrade']) delete headers[h];
      headers.host = target.host;
      if (headers.origin) headers.origin = new URL(upstreamBase).origin;
      if (typeof headers.referer === 'string' && headers.referer.startsWith(local)) headers.referer = `${base}${headers.referer.slice(local.length)}`;
      headers[MODULE_HEADER] = module;
      const bearer = bearerFor(getCfg(), module);
      if (bearer && !headers.authorization) headers.authorization = `Bearer ${bearer}`;
      const lib = target.protocol === 'https:' ? https : http;
      const agent = target.protocol === 'https:' ? httpClient.agents.https : httpClient.agents.http;
      const up = lib.request(target, { method: req.method, headers, agent }, (upRes) => {
        const h = { ...upRes.headers };
        if (typeof h.location === 'string') {
          for (const [b, o] of [[base, local], [apiBase, local]]) {
            if (h.location.startsWith(`${b}/`) || h.location === b) { h.location = `${o}${h.location.slice(b.length) || '/'}`; break; }
          }
        }
        if (Array.isArray(h['set-cookie'])) h['set-cookie'] = h['set-cookie'].map((c) => c.replace(/;\s*Domain=[^;]*/i, ''));
        res.writeHead(upRes.statusCode ?? 502, h);
        upRes.pipe(res);
        upRes.on('end', () => record({ at: new Date().toISOString(), module, method: req.method, path: inUrl.pathname, upstream: `${target.origin}${target.pathname}`, status: upRes.statusCode, ms: Date.now() - t0 }));
      });
      up.on('error', (err) => {
        record({ at: new Date().toISOString(), module, method: req.method, path: inUrl.pathname, upstream: `${target.origin}${target.pathname}`, status: 502, ms: Date.now() - t0, error: err.message.slice(0, 200) });
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(`walkthrough forwarder: ${module} at ${target.origin} did not answer (${err.message})`);
        } else res.destroy();
      });
      req.on('aborted', () => up.destroy());
      res.on('close', () => { if (!res.writableEnded) up.destroy(); });
      req.pipe(up);
    });
    server.requestTimeout = 0;
    server.timeout = 0;
    server.keepAliveTimeout = 5_000;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    origins[module] = `http://127.0.0.1:${server.address().port}`;
    servers.push(server);
    log?.(`  remote: ${module} at ${base} is reached through ${origins[module]} (this machine only${gated.has(module) ? ', run key required' : ''})`);
  }

  return {
    origins,
    key,
    entries,
    stop: async () => {
      for (const s of servers) {
        s.closeAllConnections?.();
        await new Promise((r) => s.close(() => r()));
      }
      out?.end();
    },
  };
}

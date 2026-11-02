/**
 * W5 cycle 5 (SC-3a): the examine-coverage reads (SIM-W4c1..W4c7) and their coverage-map rows.
 * - the fetcher: each read's request (list, per-object path, paging, window filter), the query the store
 *   records, its endpoint (never a routed registry endpoint), and the read order;
 * - the store: logs get a window, state reads are point in time, an empty envelope is `empty`;
 * - the index: the twelve open S1 items are covered by the hashed record of the right read, the
 *   requirement-scoped rows apply only on their requirement, and empty or failed reads attach nothing.
 * Fixture: tests/fixtures/w5c5-examine-reads/sim-shapes.json (the simulator's S1 shapes).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { SignalResult } from 'ces-shared/types/signal';
import {
  ComplianceSignalFetcher, EXAMINE_READ_ENDPOINTS, WINDOWS_DEVICES_URI, TOU_AGREEMENTS_URI, ACCESS_REVIEW_DEFINITIONS_URI,
  REMOTE_ACTION_AUDITS_URI, SITES_URI, MALWARE_INFORMATION_URI,
} from '../../../src/eo/ingestion/ComplianceSignalFetcher.js';
import { PowerShellFallbackAdapter } from '../../../src/eo/ingestion/PowerShellFallbackAdapter.js';
import { windowOf, itemCountOf, storeStatusOf } from '../../../src/eo/evidence/store/recordFetchedSignals.js';
import { SignalToControlMapper } from '../../../src/eo/mapping/SignalToControlMapper.js';
import { evaluatorRegistry } from '../../../src/eo/mapping/evaluators/index.js';
import {
  buildEvidenceIndex, coverageRuleFor, loadExamineCoverageMap, loadExamineLists, evidenceKindOfStoreSource, type IndexControl,
} from '../../../src/eo/packager/EvidenceIndex.js';
import { methodForStoreSource } from '../../../src/eo/packager/MethodLabeler.js';
import type { EvidenceRecord } from '../../../src/eo/evidence/store/types.js';

const FX = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../fixtures/w5c5-examine-reads/sim-shapes.json'), 'utf8'));
const NOW = Date.parse('2026-10-28T16:00:00.000Z');
const SRC_REGISTRY = path.resolve(__dirname, '../../../../ces-shared/src/data/control-signal-registry.json');
const NEW_SOURCES = ['defenderProtectionStates', 'windowsMalwareInformation', 'touAcceptances', 'accessReviews', 'remoteActionAudits', 'intuneWipeAuditEvents', 'sitePermissions'];

function session(reply: (cmd: string) => string | Error) {
  const cmds: string[] = [];
  return {
    cmds,
    execute: async (_engine: string, cmd: string) => {
      cmds.push(cmd);
      const r = reply(cmd);
      if (r instanceof Error) throw r;
      return { stdout: r, stderr: '', exitCode: 0, durationMs: 0 };
    },
  };
}
const stubPs = { runExchangeCommands: async (): Promise<SignalResult[]> => [], runPurviewCommands: async (): Promise<SignalResult[]> => [] };
/** The S1 reply for each composite command, keyed by a fragment of its request. */
const S1_REPLY = (cmd: string): string => {
  const pick: Array<[string, unknown]> = [
    ['windowsProtectionState', FX.reads.defenderProtectionStates],
    ['windowsMalwareInformation', FX.reads.windowsMalwareInformation],
    ['termsOfUse', FX.reads.touAcceptances],
    ['accessReviews', FX.reads.accessReviews],
    ['remoteActionAudits', FX.reads.remoteActionAudits],
    ['Get-MgDeviceManagementAuditEvent', FX.reads.intuneWipeAuditEvents],
  ];
  const hit = pick.find(([k]) => cmd.includes(k));
  return JSON.stringify(hit ? hit[1] : { value: [] });
};
const SITES_UNSERVED = (cmd: string): string | Error =>
  cmd.includes('/v1.0/sites') ? new Error('ResolverTable: no resolver registered for URI "/v1.0/sites?search=*"') : S1_REPLY(cmd);

describe('W5c5 examine reads: requests and recorded queries', () => {
  it('each read sends its list and per-object requests with paging, and the store query says so', async () => {
    const s = session(() => JSON.stringify({ value: [] }));
    const f = new ComplianceSignalFetcher(s as any, stubPs as any);
    const out = await f.fetchExamineCoverageReads(NOW);
    expect(out.map(x => x.signalId)).toEqual(NEW_SOURCES);
    const PAGING = "$u = $r.'@odata.nextLink'";
    const byId = new Map(out.map((x, i) => [x.signalId, { sig: x, cmd: s.cmds[i], query: f.describeRead(x).query }]));

    const ps = byId.get('defenderProtectionStates')!;
    expect(ps.cmd).toContain(WINDOWS_DEVICES_URI.replace(/'/g, "''"));
    expect(ps.cmd).toContain("'/beta/deviceManagement/managedDevices/' + $d.id + '/windowsProtectionState'");
    expect(ps.cmd).toContain('catch { }');
    expect(ps.query).toBe(`GET ${WINDOWS_DEVICES_URI}; per device: GET /beta/deviceManagement/managedDevices/{id}/windowsProtectionState`);

    const mw = byId.get('windowsMalwareInformation')!;
    expect(mw.cmd).toContain(`${MALWARE_INFORMATION_URI}?$filter=lastDetectionDateTime%20ge%202026-07-30T16:00:00.000Z`);
    expect(mw.cmd).toContain('/deviceMalwareStates');

    expect(byId.get('touAcceptances')!.cmd).toContain(`'${TOU_AGREEMENTS_URI}'`);
    expect(byId.get('touAcceptances')!.cmd).toContain("+ $a.id + '/acceptances'");
    const ar = byId.get('accessReviews')!;
    expect(ar.cmd).toContain(`'${ACCESS_REVIEW_DEFINITIONS_URI}'`);
    expect(ar.cmd).toContain("+ $d.id + '/instances/' + $i.id + '/decisions'");
    expect(byId.get('remoteActionAudits')!.query).toBe(`GET ${REMOTE_ACTION_AUDITS_URI}?$filter=requestDateTime%20ge%202025-10-28T16:00:00.000Z`);
    const ae = byId.get('intuneWipeAuditEvents')!;
    expect(ae.cmd).toContain("@('Wipe ManagedDevice', 'Retire ManagedDevice') -contains $_.activityType");
    expect(ae.query).toContain('activityDateTime ge 2025-10-28T16:00:00.000Z');
    expect(byId.get('sitePermissions')!.cmd).toContain(`'${SITES_URI}'`);
    expect(byId.get('sitePermissions')!.cmd).toContain("+ $s.id + '/permissions'");

    for (const { sig, cmd } of byId.values()) {
      if (sig.signalId !== 'intuneWipeAuditEvents') expect(cmd).toContain(PAGING);
      expect(cmd).toContain('ConvertTo-Json -Depth 10 -Compress');
      expect(sig.endpoint).toBe(Object.values(EXAMINE_READ_ENDPOINTS).find(e => e === sig.endpoint));
    }
  });

  it('logs carry their window; state reads are point in time', async () => {
    const f = new ComplianceSignalFetcher(session(S1_REPLY) as any, stubPs as any);
    const out = await f.fetchExamineCoverageReads(NOW);
    const win = (id: string) => windowOf(f.describeRead(out.find(x => x.signalId === id)!).query, '2026-10-28T16:00:00.000Z').start;
    expect(win('windowsMalwareInformation')).toBe('2026-07-30T16:00:00.000Z');
    expect(win('remoteActionAudits')).toBe('2025-10-28T16:00:00.000Z');
    expect(win('intuneWipeAuditEvents')).toBe('2025-10-28T16:00:00.000Z');
    for (const id of ['defenderProtectionStates', 'touAcceptances', 'accessReviews', 'sitePermissions']) expect(win(id)).toBeNull();
  });

  it('S1: six reads return rows; the site list is not served, so site permissions is an error; muster-partial reads are empty', async () => {
    const s1 = await new ComplianceSignalFetcher(session(SITES_UNSERVED) as any, stubPs as any).fetchExamineCoverageReads(NOW);
    const st = (x: SignalResult) => storeStatusOf(x, itemCountOf(x.rawData));
    expect(Object.fromEntries(s1.map(x => [x.signalId, st(x)]))).toEqual({
      defenderProtectionStates: 'success', windowsMalwareInformation: 'success', touAcceptances: 'success', accessReviews: 'success',
      remoteActionAudits: 'success', intuneWipeAuditEvents: 'success', sitePermissions: 'error',
    });
    const mp = await new ComplianceSignalFetcher(session(() => JSON.stringify({ value: [] })) as any, stubPs as any).fetchExamineCoverageReads(NOW);
    expect(mp.every(x => st(x) === 'empty')).toBe(true);
  });

  it('a 403 is not_assessed with the endpoint named', async () => {
    const out = await new ComplianceSignalFetcher(session(() => new Error('403 Forbidden')) as any, stubPs as any).fetchExamineCoverageReads(NOW);
    expect(out.every(x => x.status === 'not_assessed')).toBe(true);
    expect(out[0].findings?.[0]).toContain(EXAMINE_READ_ENDPOINTS.PROTECTION_STATES);
  });

  it('the batch runs after the vulnerabilities read and before the Exchange commands; the audit batch stays last', async () => {
    const order: string[] = [];
    const ps = {
      runExchangeCommands: async () => { order.push('exchange'); return []; },
      runPurviewCommands: async () => [],
    };
    const f = new ComplianceSignalFetcher(session(() => '[]') as any, ps as any);
    const ids = (await f.fetchAllSignals()).map(x => x.signalId);
    expect(ids.indexOf('defenderProtectionStates')).toBe(ids.indexOf('vulnerabilities') + 1);
    expect(ids.indexOf('sitePermissions')).toBe(ids.indexOf('defenderProtectionStates') + 6);
    expect(ids.slice(-4)).toEqual(['directoryAudits', 'signInLogs', 'riskDetections', 'crossTenantPolicy']);
    expect(order).toEqual(['exchange']);
  });

  it('the Purview batch reads the alert policies as a JSON array, empty included', async () => {
    const ad = new PowerShellFallbackAdapter({ certThumbprint: 'T', appId: 'A', domain: 'd.example' } as any);
    const seen: string[] = [];
    (ad as any).runPwsh = async (c: string) => { seen.push(c); return c.includes('Get-ProtectionAlert') ? '[]' : '{}'; };
    const out = await ad.runPurviewCommands();
    const pa = out.find(x => x.signalId === 'protectionAlerts')!;
    expect(seen.find(c => c.includes('Get-ProtectionAlert'))).toContain('ConvertTo-Json -InputObject @(Get-ProtectionAlert');
    expect(pa.endpoint).toBe('protectionAlerts');
    expect(storeStatusOf(pa, itemCountOf(pa.rawData))).toBe('empty');
  });
});

describe('W5c5 examine reads: no control status reads them', () => {
  it('no registry route (shared or source) matches any new read, so the mapper passes none to an evaluator', async () => {
    const f = new ComplianceSignalFetcher(session(S1_REPLY) as any, stubPs as any);
    const reads = await f.fetchExamineCoverageReads(NOW);
    const pa: SignalResult = { signalId: 'protectionAlerts', source: 'powershell', endpoint: 'protectionAlerts', timestamp: '2026-10-28T16:00:00.000Z', rawData: FX.reads.protectionAlerts, status: 'success' };
    for (const mapper of [new SignalToControlMapper(), new SignalToControlMapper(SRC_REGISTRY)]) {
      const assessed = mapper.mapSignalsToControls([...reads, pa], evaluatorRegistry);
      const used = new Set(assessed.flatMap(a => (a.signals ?? []).map(s => s.signalId)));
      for (const id of [...NEW_SOURCES, 'protectionAlerts']) expect(used.has(id)).toBe(false);
    }
  });

  it('method and kind labels: records examined, the live protection state tested; kinds as indexed', () => {
    expect(NEW_SOURCES.concat('protectionAlerts').map(s => [s, methodForStoreSource(s), evidenceKindOfStoreSource(s)])).toEqual([
      ['defenderProtectionStates', 'test', 'security-monitoring'],
      ['windowsMalwareInformation', 'examine', 'security-monitoring'],
      ['touAcceptances', 'examine', 'account-inventory'],
      ['accessReviews', 'examine', 'account-inventory'],
      ['remoteActionAudits', 'examine', 'audit-log'],
      ['intuneWipeAuditEvents', 'examine', 'audit-log'],
      ['sitePermissions', 'examine', 'account-inventory'],
      ['protectionAlerts', 'examine', 'configuration'],
    ]);
  });
});

// ------------------------------------------------------------------ the index

const OPEN_S1 = [
  ['AC.L1-3.1.1', 11], ['AC.L1-3.1.22', 4], ['AC.L2-3.1.9', 5], ['AU.L2-3.3.4', 5], ['AU.L2-3.3.7', 5], ['MP.L1-3.8.3', 8],
  ['SI.L1-3.14.2', 4], ['SI.L1-3.14.2', 9], ['SI.L1-3.14.4', 5], ['SI.L1-3.14.4', 9], ['SI.L1-3.14.5', 5], ['SI.L1-3.14.5', 9],
] as const;
const CONTROLS: IndexControl[] = [...new Set(OPEN_S1.map(([c]) => c)), 'AC.L2-3.1.10'].map(control_id => ({ control_id, status: 'met', evidenceDetails: [] }));
const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
let seq = 0;
function record(sourceId: string, payload: unknown, status: EvidenceRecord['status'] = 'success', collectedAt = '2026-10-28T16:05:00.000Z'): EvidenceRecord {
  seq++;
  return {
    seq, recordId: `rec-w5c5-${seq}`, tenantId: 'sim-tenant-s1-mach', tenantSlug: 's1-mach', sourceId,
    collector: { name: 'ces-eo', identity: 'ces-eo@fixture' } as EvidenceRecord['collector'], host: 'graph.microsoft.us',
    endpoint: sourceId, query: `GET ${sourceId}`, window: { start: null, end: collectedAt }, collectedAt, status,
    itemCount: status === 'success' ? 1 : 0, payloadSha256: sha(payload), controlIds: [], objectiveIds: [],
    retentionPolicy: 'r', retainUntil: '2032-10-28T16:05:00.000Z', prevRecordSha256: '0'.repeat(64), recordSha256: sha([sourceId, seq]),
  } as EvidenceRecord;
}
const S1_RECORDS = (): EvidenceRecord[] => [
  ...['defenderProtectionStates', 'windowsMalwareInformation', 'touAcceptances', 'accessReviews', 'remoteActionAudits', 'intuneWipeAuditEvents', 'configurationPolicies']
    .map(s => record(s, FX.reads[s])),
  record('protectionAlerts', FX.reads.protectionAlerts),
  record('sitePermissions', null, 'error'),
];
const build = (records: EvidenceRecord[]) => buildEvidenceIndex({ controls: CONTROLS, records, generatedAt: '2026-10-28T16:10:00.000Z' });
const item = (ix: ReturnType<typeof build>, c: string, n: number) => ix.examineCoverage.find(x => x.controlId === c)!.items.find(i => i.index === n)!;

describe('W5c5 coverage-map rows on the evidence index', () => {
  it('S1: eleven of the twelve open items are covered by the right read; site permissions (unserved list) stays open', () => {
    const ix = build(S1_RECORDS());
    const by = Object.fromEntries(OPEN_S1.map(([c, n]) => [`${c} #${n}`, item(ix, c, n).coveredBy?.sourceId ?? 'not covered']));
    expect(by).toEqual({
      'AC.L1-3.1.1 #11': 'accessReviews',
      'AC.L1-3.1.22 #4': 'not covered',
      'AC.L2-3.1.9 #5': 'touAcceptances',
      'AU.L2-3.3.4 #5': 'protectionAlerts',
      'AU.L2-3.3.7 #5': 'configurationPolicies',
      'MP.L1-3.8.3 #8': 'remoteActionAudits',
      'SI.L1-3.14.2 #4': 'defenderProtectionStates', 'SI.L1-3.14.2 #9': 'defenderProtectionStates',
      'SI.L1-3.14.4 #5': 'defenderProtectionStates', 'SI.L1-3.14.4 #9': 'defenderProtectionStates',
      'SI.L1-3.14.5 #5': 'defenderProtectionStates', 'SI.L1-3.14.5 #9': 'defenderProtectionStates',
    });
    for (const [c, n] of OPEN_S1) {
      const i = item(ix, c, n);
      if (i.status !== 'covered') continue;
      expect(i.coveredBy!.sha256).toMatch(/^[0-9a-f]{64}$/);
      const e = ix.entries.find(x => x.controlId === c && x.recordId === i.coveredBy!.recordId)!;
      expect(e).toMatchObject({ attachment: 'examine-item', method: 'examine', kind: 'evidence-store' });
      expect(e.examineItems).toContain(n);
      // The two whole exports (alert policies, settings catalog) are tenant-wide (ruling R1); the rest are the record the item asks for.
      const wide = c === 'AU.L2-3.3.4' || c === 'AU.L2-3.3.7';
      expect(i.coveredBy!.scope).toBe(wide ? 'tenant-wide' : 'requirement');
      expect('note' in i.coveredBy!).toBe(wide);
      expect('note' in e).toBe(wide);
    }
  });

  it('a scoped row applies only on its requirement: the same text on AC.L2-3.1.10 stays open', () => {
    const ix = build(S1_RECORDS());
    const text = 'system configuration settings and associated documentation';
    const i = item(ix, 'AC.L2-3.1.10', 5);
    expect(i.text.toLowerCase()).toBe(text);
    expect(i.status).toBe('not covered');
    const map = loadExamineCoverageMap();
    expect(coverageRuleFor(map, text)).toBeUndefined();
    expect(coverageRuleFor(map, text, '3.1.10')).toBeUndefined();
    expect(coverageRuleFor(map, text, '3.3.4')?.storeSources).toEqual(['protectionAlerts']);
    expect(coverageRuleFor(map, text, '3.3.7')?.storeSources).toEqual(['configurationPolicies']);
    expect(coverageRuleFor(map, text, '3.8.3')?.storeSources).toEqual(['remoteActionAudits', 'intuneWipeAuditEvents']);
  });

  it('the wipe audit events stand in when the remote-action read returned nothing', () => {
    const recs = S1_RECORDS().map(r => (r.sourceId === 'remoteActionAudits' ? { ...r, status: 'empty' as const } : r));
    expect(item(build(recs), 'MP.L1-3.8.3', 8).coveredBy?.sourceId).toBe('intuneWipeAuditEvents');
  });

  it('muster-partial: the new reads are empty, so none of their items is covered; the settings catalog still covers AU.L2-3.3.7 #5', () => {
    const recs = [
      ...NEW_SOURCES.map(s => record(s, { value: [] }, 'empty')),
      record('protectionAlerts', [], 'empty'),
      record('configurationPolicies', { value: [{ id: 'configurationPolicy-1', name: 'CMMC-Firewall-Policy' }] }),
    ];
    const ix = build(recs);
    for (const [c, n] of OPEN_S1) {
      expect(item(ix, c, n).status).toBe(c === 'AU.L2-3.3.7' ? 'covered' : 'not covered');
    }
  });

  it('the table: every row names a real item, once per scope; scoped rows name real requirements that carry the text', () => {
    const map = loadExamineCoverageMap();
    const lists = loadExamineLists();
    const seen = new Set<string>();
    for (const r of map.items) {
      const key = `${r.text.trim().toLowerCase()}|${(r.requirements ?? []).join(',')}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      for (const req of r.requirements ?? []) {
        const l = lists.requirements.find(x => x.requirement_id === req)!;
        expect(l.examine.map(t => t.trim().toLowerCase())).toContain(r.text.trim().toLowerCase());
      }
    }
    expect(map.items).toHaveLength(66);
  });
});

// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'fs';
import * as path from 'path';
import { getStamperTenantSubdir, getStamperTenantRoot } from 'ces-shared/storage';

// ---- Evidence directory ----

export const EVIDENCE_DIR = process.env.STAMPER_EVIDENCE_DIR || getStamperTenantSubdir('dev', 'evidence');

/** Tenant-scoped base directory: {CES_PIPELINE_ROOT}/Stamper/plan-data/<slug>/ */
export function tenantBaseDir(tenantSlug: string): string {
  return getStamperTenantRoot(tenantSlug);
}

/** Tenant-scoped evidence directory: {CES_PIPELINE_ROOT}/Stamper/plan-data/<slug>/evidence/ */
export function evidenceDirForTenant(tenantSlug: string): string {
  return getStamperTenantSubdir(tenantSlug, 'evidence');
}

/** Tenant-scoped plans directory: {CES_PIPELINE_ROOT}/Stamper/plan-data/<slug>/plans/ */
export function tenantPlansDir(tenantSlug: string): string {
  return getStamperTenantSubdir(tenantSlug, 'plans');
}

/** Tenant-scoped logs directory: {CES_PIPELINE_ROOT}/Stamper/plan-data/<slug>/logs/ */
export function tenantLogsDir(tenantSlug: string): string {
  return getStamperTenantSubdir(tenantSlug, 'logs');
}

/** Tenant-scoped state directory: {CES_PIPELINE_ROOT}/Stamper/plan-data/<slug>/state/ */
export function tenantStateDir(tenantSlug: string): string {
  const dir = getStamperTenantSubdir(tenantSlug, 'state');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---- Types ----

export interface EvidenceMatch {
  file: string;       // relative path within evidence dir, e.g. "infra/resource-group.txt"
  category: string;   // evidence category, e.g. "infra"
  entryIds: string[]; // matched registry entry_ids
  resourceName: string;
  detail: string;     // human-readable summary of what evidence proves
}

export interface CategorySummary {
  done: number;
  pending: number;
}

export interface ReadinessResult {
  matches: EvidenceMatch[];
  accomplishedIds: string[];
  byCategory: Record<string, CategorySummary>;
  totalRegistryEntries: number;
  totalAccomplished: number;
}

// ---- Evidence Mapping ----

interface EvidenceMapping {
  entryIds: string[];
  label: string;
  extract: (raw: string) => { resourceName: string; detail: string };
}

/**
 * Parse evidence content.
 * If file extension is .json, parse and validate StructuredEvidence schema.
 * If .txt, return raw content for backward compatibility (no schema validation).
 */
function parseFirstJson(raw: string, filePath?: string): any {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // If .json file, validate StructuredEvidence schema
  if (filePath && filePath.endsWith('.json')) {
    try {
      const parsed = JSON.parse(trimmed);
      // Extract rawResponse from StructuredEvidence wrapper
      return parsed.rawResponse ? JSON.parse(parsed.rawResponse) : parsed;
    } catch {
      // JSON parse failed — return null
      return null;
    }
  }

  // .txt file or no filePath — legacy behavior
  // Try parsing the whole thing first
  try { return JSON.parse(trimmed); } catch { /* fall through */ }

  // Find the end of first JSON object by brace counting
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(trimmed.substring(0, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

const EVIDENCE_MAP: Record<string, EvidenceMapping> = {
  'infra/resource-group.json': {
    entryIds: ['AZ-FOUND-001'],
    label: 'Azure Resource Group',
    extract(raw) {
      const obj = parseFirstJson(raw, 'infra/resource-group.json');
      return { resourceName: obj?.name || '?', detail: `Location: ${obj?.location || '?'}` };
    },
  },
  'security/cmmc-policy-initiative.json': {
    entryIds: ['AZ-FOUND-002'],
    label: 'CMMC L2 Policy Initiative',
    extract(raw) {
      const obj = parseFirstJson(raw);
      return { resourceName: obj?.name || 'cmmc-l2 policy', detail: `Scope: ${obj?.properties?.scope || 'subscription'}` };
    },
  },
  'security/defender-plans.json': {
    entryIds: ['AZ-FOUND-003'],
    label: 'Defender for Cloud Plans',
    extract(raw) {
      const obj = parseFirstJson(raw);
      const name = obj?.name || 'Defender';
      return { resourceName: name, detail: `Tier: ${obj?.pricingTier || '?'}` };
    },
  },
  'logging/law-deployment.json': {
    entryIds: ['AZ-LOG-001'],
    label: 'Log Analytics Workspace',
    extract(raw) {
      const obj = parseFirstJson(raw);
      return { resourceName: obj?.name || '?', detail: `Retention: ${obj?.retentionInDays || '?'} days` };
    },
  },
  'storage/storage-deployment.json': {
    entryIds: ['AZ-LOG-002', 'AZ-LOG-002a', 'AZ-LOG-002b', 'AZ-LOG-002c'],
    label: 'Immutable Log Storage + CMK',
    extract(raw) {
      const obj = parseFirstJson(raw);
      return { resourceName: obj?.name || '?', detail: `SKU: ${obj?.sku?.name || '?'}, TLS: ${obj?.minimumTlsVersion || '?'}` };
    },
  },
  'logging/sentinel-enabled.json': {
    entryIds: ['AZ-SEN-001'],
    label: 'Sentinel Onboarding',
    extract(raw) {
      const obj = parseFirstJson(raw);
      return { resourceName: 'Sentinel', detail: obj?.type || 'SecurityInsights' };
    },
  },
  'storage/keyvault-deployment.json': {
    entryIds: ['AZ-KV-001'],
    label: 'Key Vault (purge-protected)',
    extract(raw) {
      const obj = parseFirstJson(raw);
      const pp = obj?.properties?.enablePurgeProtection;
      return { resourceName: obj?.name || '?', detail: `Purge protection: ${pp}, SKU: ${obj?.properties?.sku?.name || '?'}` };
    },
  },
  'storage/cmk-key-created.json': {
    entryIds: ['AZ-KV-003'],
    label: 'CMK Key (RSA-HSM)',
    extract(raw) {
      const obj = parseFirstJson(raw);
      const kty = obj?.key?.kty || '?';
      const name = obj?.key?.kid ? obj.key.kid.split('/').slice(-2, -1)[0] : (obj?.name || '?');
      return { resourceName: name, detail: `Type: ${kty}` };
    },
  },
  'network/vnet-deployment.json': {
    entryIds: ['AZ-NET-001', 'AZ-NET-002'],
    label: 'VNet + PE Subnet',
    extract(raw) {
      const obj = parseFirstJson(raw);
      const name = obj?.newVNet?.name || obj?.name || '?';
      return { resourceName: name, detail: 'VNet + snet-pe subnet' };
    },
  },
  'network/nsg-pe.json': {
    entryIds: ['AZ-NSG-001'],
    label: 'NSG for PE Subnet',
    extract(raw) {
      const obj = parseFirstJson(raw);
      return { resourceName: obj?.name || '?', detail: 'DenyInternetInbound rule' };
    },
  },
  'network/pe-keyvault.json': {
    entryIds: ['AZ-PE-001'],
    label: 'Private Endpoint — Key Vault',
    extract(raw) {
      const obj = parseFirstJson(raw);
      return { resourceName: obj?.name || '?', detail: 'PE for Key Vault' };
    },
  },
  'network/pe-storage.json': {
    entryIds: ['AZ-PE-002'],
    label: 'Private Endpoint — Storage',
    extract(raw) {
      const obj = parseFirstJson(raw);
      return { resourceName: obj?.name || '?', detail: 'PE for Blob Storage' };
    },
  },
  'automation/automation-account.json': {
    entryIds: ['AZ-AUTO-001', 'AZ-AUTO-002'],
    label: 'Automation Account + Managed Identity',
    extract(raw) {
      const obj = parseFirstJson(raw);
      return { resourceName: obj?.name || '?', detail: `State: ${obj?.state || '?'}` };
    },
  },
  'automation/aa-rbac-assignments.json': {
    entryIds: ['AZ-AUTO-003'],
    label: 'Automation RBAC Assignments',
    extract(raw) {
      const obj = parseFirstJson(raw);
      const count = Array.isArray(obj) ? obj.length : (obj?.value?.length || '?');
      return { resourceName: 'RBAC', detail: `${count} role assignments` };
    },
  },
  'policy/diagnostic-settings.json': {
    entryIds: ['AZ-DIAG-002', 'AZ-DIAG-003', 'AZ-DIAG-005', 'AZ-DIAG-006'],
    label: 'Diagnostic Settings',
    extract(raw) {
      const obj = parseFirstJson(raw);
      return { resourceName: obj?.name || 'diagnostics', detail: 'Log routing to LAW' };
    },
  },
};

// ---- Category labels for all infra registry entry_id prefixes ----

function categoryFromEntryId(entryId: string): string {
  // Azure infrastructure — foundation (layer 0)
  if (entryId.startsWith('AZ-PREFLIGHT') || entryId.startsWith('AZ-CTX') ||
      entryId.startsWith('AZ-FOUND') || entryId.startsWith('AZ-ID')) return 'azure_foundation';

  // Azure infrastructure — deployed resources (layers 6-7)
  if (entryId.startsWith('AZ-')) return 'azure_resources';

  // M365 CMMC control families
  const family = entryId.split('.')[0];
  const CMMC_FAMILIES: Record<string, string> = {
    AC: 'access_control',
    AT: 'awareness_training',
    AU: 'audit_accountability',
    CA: 'security_assessment',
    CM: 'config_management',
    IA: 'identification_auth',
    IR: 'incident_response',
    MA: 'maintenance',
    MP: 'media_protection',
    PE: 'physical_protection',
    PS: 'personnel_security',
    RA: 'risk_assessment',
    SC: 'system_comms',
    SI: 'system_integrity',
  };
  return CMMC_FAMILIES[family] || 'other';
}

// ---- Reverse mapping: entry_id → evidence file path ----

/** Build reverse map: entry_id → relative evidence file path */
function buildReverseMap(): Map<string, string> {
  const reverseMap = new Map<string, string>();
  // Track how many entry_ids share each file path
  const fileRefCounts = new Map<string, number>();
  for (const [relPath, mapping] of Object.entries(EVIDENCE_MAP)) {
    fileRefCounts.set(relPath, mapping.entryIds.length);
  }

  for (const [relPath, mapping] of Object.entries(EVIDENCE_MAP)) {
    const shared = (fileRefCounts.get(relPath) ?? 1) > 1;
    for (const entryId of mapping.entryIds) {
      if (shared) {
        // Shared file: use category/entry-id-lowercase.txt
        const cat = categoryFromEntryId(entryId);
        reverseMap.set(entryId, `${cat}/${entryId.toLowerCase()}.txt`);
      } else {
        // 1:1 mapping: use the descriptive filename
        reverseMap.set(entryId, relPath);
      }
    }
  }
  return reverseMap;
}

const reverseEntryMap = buildReverseMap();

/**
 * Return the relative evidence file path for a given registry entry_id.
 * - 1:1 mapped entries use their descriptive filename from EVIDENCE_MAP
 * - Shared entries use {category}/{entry-id-lowercase}.txt
 * - Unmapped entries auto-generate {category}/{entry-id-lowercase}.txt
 */
export function evidenceFileForEntry(entryId: string, _label?: string): string {
  const mapped = reverseEntryMap.get(entryId);
  if (mapped) return mapped;
  // Auto-generate for entries not in the map
  const cat = categoryFromEntryId(entryId);
  return `${cat}/${entryId.toLowerCase()}.txt`;
}

// ---- Analyzer ----

export class EvidenceReadinessAnalyzer {
  private evidenceDir: string;

  constructor(evidenceDir: string) {
    this.evidenceDir = evidenceDir;
  }

  /**
   * Analyze evidence directory against known infra registry entries.
   * @param allRegistryEntryIds — if provided, used to calculate "not yet done" counts
   */
  analyze(allRegistryEntryIds?: string[]): ReadinessResult {
    const matches: EvidenceMatch[] = [];
    const accomplishedIds = new Set<string>();

    // Check each evidence mapping (descriptive filenames)
    for (const [relPath, mapping] of Object.entries(EVIDENCE_MAP)) {
      // Check for both .json and .txt, prioritize .json
      const relPathJson = relPath;
      const relPathTxt = relPath.replace(/\.json$/, '.txt');
      const fullPathJson = path.join(this.evidenceDir, relPathJson);
      const fullPathTxt = path.join(this.evidenceDir, relPathTxt);

      let fullPath = '';
      let usedPath = '';

      if (fs.existsSync(fullPathJson)) {
        fullPath = fullPathJson;
        usedPath = relPathJson;
      } else if (fs.existsSync(fullPathTxt)) {
        fullPath = fullPathTxt;
        usedPath = relPathTxt;
      } else {
        continue;
      }

      let raw: string;
      try {
        raw = fs.readFileSync(fullPath, 'utf-8');
      } catch {
        continue;
      }

      if (!raw.trim()) continue;

      const { resourceName, detail } = mapping.extract(raw);
      const category = usedPath.split('/')[0];

      matches.push({
        file: usedPath,
        category,
        entryIds: mapping.entryIds,
        resourceName,
        detail,
      });

      for (const id of mapping.entryIds) {
        accomplishedIds.add(id);
      }
    }

    // Also scan for entry-id-based filenames (written by Stamper during execution)
    for (const [entryId, relPath] of reverseEntryMap.entries()) {
      if (accomplishedIds.has(entryId)) continue; // already matched via descriptive filename

      // Check for both .json and .txt, prioritize .json
      const relPathJson = relPath.replace(/\.txt$/, '.json');
      const relPathTxt = relPath.replace(/\.json$/, '.txt');
      const fullPathJson = path.join(this.evidenceDir, relPathJson);
      const fullPathTxt = path.join(this.evidenceDir, relPathTxt);

      let fullPath = '';
      let usedPath = '';

      if (fs.existsSync(fullPathJson)) {
        fullPath = fullPathJson;
        usedPath = relPathJson;
      } else if (fs.existsSync(fullPathTxt)) {
        fullPath = fullPathTxt;
        usedPath = relPathTxt;
      } else {
        continue;
      }

      let raw: string;
      try {
        raw = fs.readFileSync(fullPath, 'utf-8');
      } catch {
        continue;
      }
      if (!raw.trim()) continue;

      accomplishedIds.add(entryId);
      const category = usedPath.split('/')[0];
      // Check if a match already covers this file
      const existingMatch = matches.find(m => m.file === relPath);
      if (existingMatch) {
        if (!existingMatch.entryIds.includes(entryId)) {
          existingMatch.entryIds.push(entryId);
        }
      } else {
        matches.push({
          file: relPath,
          category,
          entryIds: [entryId],
          resourceName: entryId,
          detail: 'Evidence captured by Stamper',
        });
      }
    }

    // Scan for any auto-generated entry-id files not in the reverse map
    // (covers entries that were never in EVIDENCE_MAP at all)
    if (fs.existsSync(this.evidenceDir)) {
      try {
        const dirs = fs.readdirSync(this.evidenceDir, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name);
        for (const dir of dirs) {
          const dirPath = path.join(this.evidenceDir, dir);
          const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.txt'));
          for (const file of files) {
            // Match entry-id pattern: az-xxx-nnn.txt or cmmc family xx.l2-n.n.n.txt
            const baseName = file.replace(/\.txt$/, '').toUpperCase();
            const isCmmcFamily = /^[A-Z]{2}\.L\d/.test(baseName);
            if (!baseName.startsWith('AZ-') && !isCmmcFamily) continue;
            if (accomplishedIds.has(baseName)) continue;

            const filePath = path.join(dirPath, file);
            let raw: string;
            try {
              raw = fs.readFileSync(filePath, 'utf-8');
            } catch { continue; }
            if (!raw.trim()) continue;

            accomplishedIds.add(baseName);
            const relPath = `${dir}/${file}`;
            matches.push({
              file: relPath,
              category: dir,
              entryIds: [baseName],
              resourceName: baseName,
              detail: 'Evidence captured by Stamper',
            });
          }
        }
      } catch { /* best-effort scan */ }
    }

    // Build category breakdown
    const byCategory: Record<string, CategorySummary> = {};
    const allIds = allRegistryEntryIds || [];

    // Initialize categories from all registry entry_ids
    for (const id of allIds) {
      const cat = categoryFromEntryId(id);
      if (!byCategory[cat]) byCategory[cat] = { done: 0, pending: 0 };
      if (accomplishedIds.has(id)) {
        byCategory[cat].done++;
      } else {
        byCategory[cat].pending++;
      }
    }

    // If no registry entry_ids provided, build from evidence only
    if (allIds.length === 0) {
      for (const m of matches) {
        const cat = categoryFromEntryId(m.entryIds[0]);
        if (!byCategory[cat]) byCategory[cat] = { done: 0, pending: 0 };
        byCategory[cat].done += m.entryIds.length;
      }
    }

    const accomplishedArray = Array.from(accomplishedIds);

    return {
      matches,
      accomplishedIds: accomplishedArray,
      byCategory,
      totalRegistryEntries: allIds.length || accomplishedArray.length,
      totalAccomplished: accomplishedArray.length,
    };
  }
}

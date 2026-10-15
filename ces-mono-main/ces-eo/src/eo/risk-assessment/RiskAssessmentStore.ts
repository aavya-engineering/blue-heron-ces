// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  RiskAssessmentConfig,
  RiskRegister,
  RiskEntry,
  AnnualSnapshot,
  AnnualReviewState,
} from '../../shared/types/risk-assessment.types.js';
import {
  RiskAssessmentConfigSchema,
  RiskRegisterSchema,
  RiskEntrySchema,
  AnnualSnapshotSchema,
  AnnualReviewStateSchema,
} from '../../shared/types/risk-assessment.types.js';
import { NIST_SP_800_30_SCALE } from './NistScoringMatrix.js';
import { deriveScopeStatement } from './ScopeStatementDeriver.js';
import { getCesRepository } from 'ces-shared/persistence/node';

// G2: risk-assessment domain objects persist in the unified SQLite repository, tenant-isolated by
// tenantSlug, replacing {storageRoot}/risk-assessment/{tenantSlug}/*.json. See ADR-002. The DEFAULT
// threat-catalog reference file (shared/data/threat-catalog-default.json) is reference data and
// remains a file read (out of scope).
const RISK_CONFIG_COLLECTION = 'eo_risk_config';
const RISK_REGISTER_COLLECTION = 'eo_risk_register';
const RISK_SNAPSHOTS_COLLECTION = 'eo_risk_snapshots';
const RISK_REVIEW_STATE_COLLECTION = 'eo_risk_review_state';
const RISK_INGESTION_COLLECTION = 'eo_risk_ingestion';

// Load default threat catalog from JSON
const __dirname = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const DEFAULT_THREAT_CATALOG_PATH = path.join(__dirname, '..', '..', 'shared', 'data', 'threat-catalog-default.json');

function loadDefaultThreatCatalog(): { adversarial: Array<{ source: string; events: string[] }>; non_adversarial: Array<{ source: string; events: string[] }> } {
  try {
    const raw = fs.readFileSync(DEFAULT_THREAT_CATALOG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { adversarial: [], non_adversarial: [] };
  }
}

/**
 * Stores and retrieves risk assessment data per tenant.
 *
 * Storage layout: {storageRoot}/risk-assessment/{tenantSlug}/
 *   - Config: _config.json
 *   - Register: register.json
 *   - Snapshots: snapshots/{year}.json
 */
export class RiskAssessmentStore {
  private readonly storageRoot: string;

  constructor(storageRoot: string) {
    this.storageRoot = storageRoot;
  }

  private get repo() {
    return getCesRepository();
  }

  /** Per-tenant key for the risk-assessment config singleton. */
  private configKey(tenantSlug: string): string {
    return `${tenantSlug}:_config`;
  }

  /** Per-tenant key for the risk register singleton. */
  private registerKey(tenantSlug: string): string {
    return `${tenantSlug}:register`;
  }

  /** Per-tenant key for an annual snapshot. */
  private snapshotKey(tenantSlug: string, year: number): string {
    return `${tenantSlug}:${year}`;
  }

  // --- Config Methods ---

  loadConfig(tenantSlug: string, missionPlanPath?: string, infraManifestPath?: string): RiskAssessmentConfig {
    const rec = this.repo.get<unknown>(RISK_CONFIG_COLLECTION, this.configKey(tenantSlug), { tenantSlug });
    let config: RiskAssessmentConfig;

    if (rec) {
      try {
        config = RiskAssessmentConfigSchema.parse(rec.data);
      } catch {
        // Fall through to defaults
        const defaultCatalog = loadDefaultThreatCatalog();
        config = RiskAssessmentConfigSchema.parse({
          threatCatalog: defaultCatalog,
          scoringScale: NIST_SP_800_30_SCALE,
        });
      }
    } else {
      // Return default config with pre-populated threat catalog
      const defaultCatalog = loadDefaultThreatCatalog();
      config = RiskAssessmentConfigSchema.parse({
        threatCatalog: defaultCatalog,
        scoringScale: NIST_SP_800_30_SCALE,
      });
    }

    // Auto-derive scope statement if it's empty and we have mission plan + infra manifest
    if (config.scopeStatement === '' && missionPlanPath && infraManifestPath) {
      try {
        if (fs.existsSync(missionPlanPath) && fs.existsSync(infraManifestPath)) {
          const missionPlanData = JSON.parse(fs.readFileSync(missionPlanPath, 'utf-8'));
          const infraManifestData = JSON.parse(fs.readFileSync(infraManifestPath, 'utf-8'));
          const derivedScope = deriveScopeStatement(missionPlanData, infraManifestData, tenantSlug);
          if (derivedScope) {
            config.scopeStatement = derivedScope;
            console.log(`[RiskAssessmentStore] Auto-derived scope statement for ${tenantSlug}`);
          }
        } else {
          if (!fs.existsSync(missionPlanPath)) {
            console.warn(`[RiskAssessmentStore] Failed to derive scope statement: mission plan not found at ${missionPlanPath}`);
          }
          if (!fs.existsSync(infraManifestPath)) {
            console.warn(`[RiskAssessmentStore] Failed to derive scope statement: infrastructure manifest not found at ${infraManifestPath}`);
          }
        }
      } catch (err) {
        console.warn('[RiskAssessmentStore] Failed to derive scope statement:', err);
      }
    }

    return config;
  }

  saveConfig(tenantSlug: string, config: RiskAssessmentConfig): void {
    this.repo.put(RISK_CONFIG_COLLECTION, {
      id: this.configKey(tenantSlug),
      ces: { tenantSlug },
      data: config,
    });
  }

  // --- Register Methods ---

  loadRegister(tenantSlug: string): RiskRegister {
    const rec = this.repo.get<any>(RISK_REGISTER_COLLECTION, this.registerKey(tenantSlug), { tenantSlug });
    if (rec) {
      try {
        const raw = rec.data;
        // Try strict parse first
        const strict = RiskRegisterSchema.safeParse(raw);
        if (strict.success) return strict.data;

        // Strict parse failed — salvage valid entries individually
        const entries: RiskEntry[] = [];
        if (Array.isArray(raw.entries)) {
          for (const entry of raw.entries) {
            const result = RiskEntrySchema.safeParse(entry);
            if (result.success) {
              entries.push(result.data);
            } else {
              console.warn(`[RiskAssessmentStore] Dropping invalid entry ${entry?.id ?? '(no id)'}: ${result.error.issues[0]?.message}`);
            }
          }
        }
        return {
          entries,
          lastUpdated: raw.lastUpdated ?? new Date().toISOString(),
          lastFullReviewDate: raw.lastFullReviewDate,
          nextReviewDue: raw.nextReviewDue ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        };
      } catch {
        // JSON parse failed entirely — fall through to defaults
      }
    }
    // Return empty register with nextReviewDue set to now + 12 months
    const now = new Date();
    const nextReview = new Date(now);
    nextReview.setUTCMonth(nextReview.getUTCMonth() + 12);
    return RiskRegisterSchema.parse({
      entries: [],
      lastUpdated: now.toISOString(),
      nextReviewDue: nextReview.toISOString(),
    });
  }

  saveRegister(tenantSlug: string, register: RiskRegister): void {
    this.repo.put(RISK_REGISTER_COLLECTION, {
      id: this.registerKey(tenantSlug),
      ces: { tenantSlug },
      data: register,
    });
  }

  addEntry(tenantSlug: string, entry: Omit<RiskEntry, 'id' | 'firstIdentified'>): RiskEntry {
    const register = this.loadRegister(tenantSlug);
    const now = new Date().toISOString();
    const fullEntry: RiskEntry = {
      ...entry,
      id: randomUUID(),
      firstIdentified: now,
    };
    register.entries.push(fullEntry);
    register.lastUpdated = now;
    this.saveRegister(tenantSlug, register);
    return fullEntry;
  }

  updateEntry(tenantSlug: string, entryId: string, updates: Partial<RiskEntry>): RiskEntry | null {
    const register = this.loadRegister(tenantSlug);
    const index = register.entries.findIndex(e => e.id === entryId);
    if (index === -1) return null;

    register.entries[index] = { ...register.entries[index], ...updates };
    register.lastUpdated = new Date().toISOString();
    this.saveRegister(tenantSlug, register);
    return register.entries[index];
  }

  deleteEntry(tenantSlug: string, entryId: string): boolean {
    const register = this.loadRegister(tenantSlug);
    const index = register.entries.findIndex(e => e.id === entryId);
    if (index === -1) return false;

    register.entries.splice(index, 1);
    register.lastUpdated = new Date().toISOString();
    this.saveRegister(tenantSlug, register);
    return true;
  }

  getEntry(tenantSlug: string, entryId: string): RiskEntry | null {
    const register = this.loadRegister(tenantSlug);
    return register.entries.find(e => e.id === entryId) ?? null;
  }

  // --- Snapshot Methods ---

  listSnapshots(tenantSlug: string): Array<{ year: number; snapshotId: string; signedOffDate: string }> {
    const results: Array<{ year: number; snapshotId: string; signedOffDate: string }> = [];

    for (const rec of this.repo.list<unknown>(RISK_SNAPSHOTS_COLLECTION, { tenantSlug })) {
      try {
        const snapshot = AnnualSnapshotSchema.parse(rec.data);
        results.push({
          year: snapshot.assessmentYear,
          snapshotId: snapshot.snapshotId,
          signedOffDate: snapshot.signedOffDate,
        });
      } catch {
        // skip invalid records
      }
    }

    return results.sort((a, b) => b.year - a.year);
  }

  loadSnapshot(tenantSlug: string, year: number): AnnualSnapshot | null {
    const rec = this.repo.get<unknown>(RISK_SNAPSHOTS_COLLECTION, this.snapshotKey(tenantSlug, year), { tenantSlug });
    if (!rec) return null;
    try {
      return AnnualSnapshotSchema.parse(rec.data);
    } catch {
      return null;
    }
  }

  createSnapshot(tenantSlug: string, snapshot: Omit<AnnualSnapshot, 'snapshotId'>): AnnualSnapshot {
    if (this.snapshotExists(tenantSlug, snapshot.assessmentYear)) {
      throw new Error(`Snapshot for year ${snapshot.assessmentYear} already exists. Snapshots are immutable.`);
    }

    const fullSnapshot: AnnualSnapshot = {
      ...snapshot,
      snapshotId: randomUUID(),
    };

    this.repo.put(RISK_SNAPSHOTS_COLLECTION, {
      id: this.snapshotKey(tenantSlug, snapshot.assessmentYear),
      ces: { tenantSlug },
      data: fullSnapshot,
    });
    return fullSnapshot;
  }

  snapshotExists(tenantSlug: string, year: number): boolean {
    return this.repo.get(RISK_SNAPSHOTS_COLLECTION, this.snapshotKey(tenantSlug, year), { tenantSlug }) !== undefined;
  }

  // --- Annual Review State Methods ---

  /** Per-tenant key for the in-progress annual review state singleton. */
  private reviewStateKey(tenantSlug: string): string {
    return `${tenantSlug}:_annual_review_in_progress`;
  }

  loadAnnualReviewState(tenantSlug: string): AnnualReviewState | null {
    const rec = this.repo.get<unknown>(RISK_REVIEW_STATE_COLLECTION, this.reviewStateKey(tenantSlug), { tenantSlug });
    if (!rec) return null;
    try {
      return AnnualReviewStateSchema.parse(rec.data);
    } catch {
      return null;
    }
  }

  saveAnnualReviewState(tenantSlug: string, state: AnnualReviewState): void {
    this.repo.put(RISK_REVIEW_STATE_COLLECTION, {
      id: this.reviewStateKey(tenantSlug),
      ces: { tenantSlug },
      data: state,
    });
  }

  deleteAnnualReviewState(tenantSlug: string): void {
    this.repo.delete(RISK_REVIEW_STATE_COLLECTION, this.reviewStateKey(tenantSlug), { tenantSlug });
  }

  // --- Ingestion Run Log Methods ---

  /** Per-tenant key for an ingestion-run record (keyed by its timestamp). */
  private ingestionRunKey(tenantSlug: string, timestamp: string): string {
    return `${tenantSlug}:${timestamp}`;
  }

  saveIngestionRun(tenantSlug: string, report: { timestamp: string; results: Array<{ source: string; new: number; updated: number; skipped: number; errors: string[] }>; totalNew: number; totalUpdated: number; totalErrors: number; trigger?: string; durationMs?: number }): void {
    this.repo.put(RISK_INGESTION_COLLECTION, {
      id: this.ingestionRunKey(tenantSlug, report.timestamp),
      ces: { tenantSlug },
      data: report,
    });
  }

  listIngestionRuns(tenantSlug: string, limit = 50): Array<{ timestamp: string; totalNew: number; totalUpdated: number; totalErrors: number; trigger?: string }> {
    const records = this.repo
      .list<any>(RISK_INGESTION_COLLECTION, { tenantSlug })
      .map((r) => r.data)
      // Most-recent first, matching the old reverse-sorted-filename behavior.
      .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));

    const results: Array<{ timestamp: string; totalNew: number; totalUpdated: number; totalErrors: number; trigger?: string }> = [];
    for (const raw of records.slice(0, limit)) {
      results.push({
        timestamp: raw.timestamp,
        totalNew: raw.totalNew ?? 0,
        totalUpdated: raw.totalUpdated ?? 0,
        totalErrors: raw.totalErrors ?? 0,
        trigger: raw.trigger,
      });
    }
    return results;
  }

  loadIngestionRun(tenantSlug: string, timestamp: string): object | null {
    const rec = this.repo.get<object>(RISK_INGESTION_COLLECTION, this.ingestionRunKey(tenantSlug, timestamp), { tenantSlug });
    return rec ? rec.data : null;
  }
}

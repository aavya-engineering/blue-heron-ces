// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO's read-side client for the Evidence Collector (EC) service (plan M4a).
 *
 * Modelled on `adminops/AdminOpsEvidenceReader.ts`: EC items are read over HTTP (EC is a
 * standalone process, not a library EO links against — tool-boundary rule), strictly
 * validated against the shared contract, and fed into control detail / the evidence
 * package. Never throws: an unreachable EC, an unset secret, or an empty store all
 * resolve to an empty result so a manual-evidence outage never breaks /api/assess.
 *
 * EC never assigns verdicts (`EcEvidenceItemSchema` has no `verdict` field and rejects
 * unknown keys). Mirroring that on the EO side: `ecItemsToSources` always emits
 * `result: 'no_query'`, the one `AssessmentSource.result` value `ControlAssessor`'s
 * `determineStatus` treats as neither positive nor negative — an EC upload is evidence
 * "present for review", never automatic SAT. `ControlAssessor.merge` also appends EC
 * sources only *after* computing status from the other sources, so this is a structural
 * guarantee, not just a convention of this result value.
 */
import type { AssessmentSource } from 'ces-shared/types/controls';
import { EcEvidenceItemSchema, type EcEvidenceItem } from 'ces-shared/types/evidence-collector';

export interface EcReaderDeps {
  /** Base URL of the EC service, e.g. http://127.0.0.1:4001 */
  ecUrl: string;
  /** Bearer secret (EVIDENCE_OPS_SECRET). No secret => reads return empty (never throws). */
  secret?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 3000;

export interface EcItemContent {
  buffer: Buffer;
  contentType: string;
  sha256: string | null;
}

export class EcEvidenceReader {
  private readonly ecUrl: string;
  private readonly secret?: string;
  private readonly timeoutMs: number;

  constructor(deps: EcReaderDeps) {
    this.ecUrl = deps.ecUrl.replace(/\/+$/, '');
    this.secret = deps.secret;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * GET /api/items?tenant=&controlId= — manual uploads / attestations only (index results
   * are ledger-only and never appear here). Empty array when: no secret configured, EC
   * unreachable/errors, or the store is genuinely empty. A row that fails the strict
   * contract parse (e.g. carries a `verdict`) is excluded and logged, mirroring
   * AdminOpsEvidenceReader's E5 behaviour.
   */
  async readItems(tenantSlug: string, controlId?: string): Promise<EcEvidenceItem[]> {
    if (!this.secret) return [];
    const url = new URL(`${this.ecUrl}/api/items`);
    url.searchParams.set('tenant', tenantSlug);
    if (controlId) url.searchParams.set('controlId', controlId);

    try {
      const resp = await this.fetchWithTimeout(url.toString(), {
        headers: { Authorization: `Bearer ${this.secret}` },
      });
      if (!resp.ok) return [];
      const body: unknown = await resp.json();
      if (!Array.isArray(body)) return [];

      const items: EcEvidenceItem[] = [];
      for (const raw of body) {
        const parsed = EcEvidenceItemSchema.safeParse(raw);
        if (parsed.success) {
          items.push(parsed.data);
        } else {
          const issues = parsed.error.issues.map(i => i.path.join('.') || '(root)').join(', ');
          console.warn(`[EcEvidenceReader] item excluded (strict contract parse failed): ${issues}`);
        }
      }
      return items;
    } catch {
      return [];
    }
  }

  /**
   * GET /api/items/:itemId/content?tenant= — raw bytes for one item. `null` on any
   * failure (unreachable, 404, no secret) — never throws.
   */
  async readItemContent(tenantSlug: string, itemId: string): Promise<EcItemContent | null> {
    if (!this.secret) return null;
    const url = new URL(`${this.ecUrl}/api/items/${encodeURIComponent(itemId)}/content`);
    url.searchParams.set('tenant', tenantSlug);

    try {
      const resp = await this.fetchWithTimeout(url.toString(), {
        headers: { Authorization: `Bearer ${this.secret}` },
      });
      if (!resp.ok) return null;
      const arrayBuffer = await resp.arrayBuffer();
      return {
        buffer: Buffer.from(arrayBuffer),
        contentType: resp.headers.get('content-type') ?? 'application/octet-stream',
        sha256: resp.headers.get('x-ec-sha256'),
      };
    } catch {
      return null;
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Maps EC evidence items to per-control AssessmentSources for `ControlAssessor.merge`.
 * `result: 'no_query'` always — see the module doc comment for why this is the one
 * result value that never flips a control's computed status.
 */
export function ecItemsToSources(items: EcEvidenceItem[]): Map<string, AssessmentSource[]> {
  const map = new Map<string, AssessmentSource[]>();
  for (const item of items) {
    const source: AssessmentSource = {
      type: 'ec_capture',
      timestamp: item.collectedAt,
      detail: `${item.source}: ${item.filename} (${item.itemId})`,
      result: 'no_query',
    };
    for (const controlId of item.controlIds) {
      const existing = map.get(controlId) ?? [];
      existing.push(source);
      map.set(controlId, existing);
    }
  }
  return map;
}

/** Per-control EC item ids, so they can be folded into `ControlAssessment.evidenceArtifactIds`. */
export function ecItemIdsByControl(items: EcEvidenceItem[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const item of items) {
    for (const controlId of item.controlIds) {
      const existing = map.get(controlId) ?? [];
      existing.push(item.itemId);
      map.set(controlId, existing);
    }
  }
  return map;
}

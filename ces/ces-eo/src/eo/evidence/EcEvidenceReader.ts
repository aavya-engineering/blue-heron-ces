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

// R-F1 (2026-10-31): 3 s let a slow first EC read count zero items without an error, and nine controls
// lost their evidence for that assess. The assess path now reads with readItemsOrThrow.
const DEFAULT_TIMEOUT_MS = 15000;

/** EC is configured (a secret is set) but its item list could not be read: unreachable, timed out, non-2xx or not a list. */
export class EcUnavailableError extends Error {
  constructor(reason: string) {
    super(`EC item list unavailable: ${reason}`);
    this.name = 'EcUnavailableError';
  }
}

/**
 * PH-11 (R-F5 / R-F8 S1 E7): fetch rejects with the bare message "fetch failed" and puts the reason (ECONNREFUSED,
 * ECONNRESET, UND_ERR_SOCKET, ...) in `cause`. The reason names the cause so the next failure can be diagnosed.
 */
export function fetchFailureReason(err: unknown): string {
  const message = String((err as Error | null)?.message ?? err);
  const cause = (err as { cause?: { code?: unknown; name?: unknown; message?: unknown } } | null)?.cause;
  if (!cause || typeof cause !== 'object') return message;
  const label = String(cause.code ?? cause.name ?? 'cause');
  return cause.message ? `${message} (${label}: ${String(cause.message)})` : `${message} (${label})`;
}

/** PH-11: the cause codes of a request written onto a socket the server had closed (reset, broken pipe, closed). */
const STALE_SOCKET_CODES = new Set(['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET']);

export function isStaleSocketFailure(err: unknown): boolean {
  const code = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === 'string' && STALE_SOCKET_CODES.has(code);
}

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
    try {
      return await this.readItemsOrThrow(tenantSlug, controlId);
    } catch {
      return [];
    }
  }

  /**
   * As readItems, but an unreadable list throws EcUnavailableError instead of looking empty. The assess
   * route uses this: a missing input must fail the assessment, not lower the score. No secret => [].
   */
  async readItemsOrThrow(tenantSlug: string, controlId?: string): Promise<EcEvidenceItem[]> {
    if (!this.secret) return [];
    const url = new URL(`${this.ecUrl}/api/items`);
    url.searchParams.set('tenant', tenantSlug);
    if (controlId) url.searchParams.set('controlId', controlId);

    let body: unknown;
    try {
      const resp = await this.fetchWithTimeout(url.toString(), {
        headers: { Authorization: `Bearer ${this.secret}` },
      });
      if (!resp.ok) throw new EcUnavailableError(`HTTP ${resp.status}`);
      body = await resp.json();
    } catch (err) {
      if (err instanceof EcUnavailableError) throw err;
      // An aborted fetch rejects with a DOMException named AbortError (not always `instanceof Error`).
      const aborted = (err as { name?: string } | null)?.name === 'AbortError';
      throw new EcUnavailableError(aborted ? `no answer within ${this.timeoutMs} ms` : fetchFailureReason(err));
    }
    if (!Array.isArray(body)) throw new EcUnavailableError('the response is not a list');
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

  /**
   * PH-11 (R-F8 S1 + S2 E7, reproduced: LOG-PH11-EO.md §3b): a GET that fails because fetch wrote it onto a
   * kept-alive socket EC had already closed (EC's idle close landed while EO's loop was blocked, e.g. by
   * collector C11) is sent once more. The failed socket is gone by then, so the retry opens a fresh connection.
   * Only that stale-socket class is retried, once; a refused connection, a timeout or an HTTP error never is.
   */
  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchOnce(url, init);
    } catch (err) {
      if (!isStaleSocketFailure(err)) throw err;
      return this.fetchOnce(url, init);
    }
  }

  private async fetchOnce(url: string, init: RequestInit): Promise<Response> {
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
    const ref = ecCatalogRef(item);
    const source: AssessmentSource = {
      type: 'ec_capture',
      timestamp: item.collectedAt,
      detail: `${item.source}: ${item.filename} (${item.itemId})`,
      result: 'no_query',
      ...(ref ? { rawOutput: JSON.stringify(ref) } : {}),
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

/**
 * EVC.5: the evidence-catalog ids an EC item carries (DEC-2), as they travel through EO.
 * Display and traceability only: never a status, a score or a verified artifact (DEC-7).
 */
export interface EcCatalogRef {
  itemId: string;
  filename: string;
  form_id?: string;
  emx_ids?: string[];
  form_id_matched_by?: 'form_id' | 'definition_id';
  catalog?: 'validated' | 'unavailable';
}

/** The item's catalog ref, or undefined when the item carries no catalog ids (legacy items). */
export function ecCatalogRef(item: EcEvidenceItem): EcCatalogRef | undefined {
  if (item.form_id === undefined && item.emx_ids === undefined) return undefined;
  return {
    itemId: item.itemId,
    filename: item.filename,
    ...(item.form_id !== undefined ? { form_id: item.form_id } : {}),
    ...(item.emx_ids !== undefined ? { emx_ids: item.emx_ids } : {}),
    ...(item.form_id_matched_by !== undefined ? { form_id_matched_by: item.form_id_matched_by } : {}),
    ...(item.catalog !== undefined ? { catalog: item.catalog } : {}),
  };
}

/** Catalog refs carried on a control's `ec_capture` sources (the `rawOutput` JSON). */
export function ecCatalogRefsFromSources(sources: AssessmentSource[] | undefined): EcCatalogRef[] {
  const refs: EcCatalogRef[] = [];
  for (const s of sources ?? []) {
    if (s.type !== 'ec_capture' || !s.rawOutput) continue;
    try {
      const parsed = JSON.parse(s.rawOutput) as EcCatalogRef;
      if (parsed && typeof parsed.itemId === 'string') refs.push(parsed);
    } catch {
      // not a catalog ref
    }
  }
  return refs;
}

/**
 * FIN-11: the distinct EC item ids on a control's `ec_capture` sources, catalog-tagged or not. The source detail
 * ends "(<itemId>)" (ecItemsToSources); a catalog ref in `rawOutput` names it too.
 */
export function ecItemIdsFromSources(sources: AssessmentSource[] | undefined): string[] {
  const ids = new Set<string>();
  for (const s of sources ?? []) {
    if (s.type !== 'ec_capture') continue;
    let id: string | undefined;
    if (s.rawOutput) {
      try {
        const parsed = JSON.parse(s.rawOutput) as { itemId?: unknown };
        if (typeof parsed?.itemId === 'string') id = parsed.itemId;
      } catch {
        // not a catalog ref
      }
    }
    id ??= /\(([^()]+)\)\s*$/.exec(s.detail)?.[1];
    if (id) ids.add(id);
  }
  return [...ids];
}

// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// provisioningInputs.ts — FC-MU-2 (MS-5 live, founder decision 2026-09-27):
// the production functions behind the three Stamper provisioning inputs of the
// Tenant Config intake (tcpProvisioningNodes.ts). The widgets and the session
// driver call these same functions.
//
//   - generateInitialPassword: a strong random password (crypto RNG), returned
//     to the caller ONCE with a one-time reference. Only the reference is ever
//     recorded; the value is never written to Dexie or to any artifact.
//   - storeTouFile: validates a PDF, stores its bytes on the session
//     (provisioning_inputs.tou_file, off facts[]), returns the fact answer
//     `file:<name>;sha256:<hex>`.
//   - readProvisioningInputs: what the Infra Manifest emits, from the session's
//     facts + stored file (the stored file must match the fact's sha256).
import { db } from '@/shared/db/schema';
import type { InterviewFact, InterviewSession } from '@/shared/types/engagement';
import { PROVISIONING_NODE_IDS } from '@/features/interview/tcpProvisioningNodes';
import { parsePlanInputAnswer } from '@/features/interview/siPlanInputNodes';

// No look-alike characters (0/O, 1/l/I) so the operator can transcribe it once.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGIT = '23456789';
const SYMBOL = '!#$%*+-=?@^_~';
const ALL = UPPER + LOWER + DIGIT + SYMBOL;
export const INITIAL_PASSWORD_LENGTH = 24;

/** A uniform index in [0, n) from the crypto RNG (rejection sampling, no modulo bias). */
function randomIndex(n: number): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface GeneratedSecret {
  /** Shown to the operator once. NEVER persist this. */
  password: string;
  /** What the session records and the Infra Manifest carries. */
  ref: string;
}

/**
 * Generate the initial password: 24 characters with at least one upper, lower,
 * digit and symbol (meets Entra ID complexity). Returns the value for a single
 * display plus a fresh one-time reference.
 */
export function generateInitialPassword(): GeneratedSecret {
  const chars = [UPPER, LOWER, DIGIT, SYMBOL].map((set) => set[randomIndex(set.length)]);
  while (chars.length < INITIAL_PASSWORD_LENGTH) chars.push(ALL[randomIndex(ALL.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return { password: chars.join(''), ref: `secretref:one-time:${uuid()}` };
}

/** Largest terms-of-use PDF Muster accepts (bytes). */
export const TOU_MAX_BYTES = 5 * 1024 * 1024;

export interface StoredTouFile {
  name: string;
  base64: string;
  sha256: string;
  size: number;
}

export class TouFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TouFileError';
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** The fact answer for a stored ToU file. */
export function touFileRef(name: string, sha256: string): string {
  return `file:${name};sha256:${sha256}`;
}

/**
 * Validate and store the terms-of-use PDF on the session. Returns the fact
 * answer (`file:<name>;sha256:<hex>`) the caller records for TCP.MU.002.
 */
export async function storeTouFile(sessionId: string, name: string, bytes: Uint8Array): Promise<string> {
  const clean = name.replace(/[;\r\n]/g, '_').trim();
  if (!clean.toLowerCase().endsWith('.pdf')) throw new TouFileError('the terms-of-use file must be a PDF');
  if (bytes.length === 0 || bytes.length > TOU_MAX_BYTES) {
    throw new TouFileError(`the terms-of-use file must be 1 byte to ${TOU_MAX_BYTES / 1024 / 1024} MB`);
  }
  const magic = String.fromCharCode(...bytes.subarray(0, 5));
  if (magic !== '%PDF-') throw new TouFileError('the file is not a PDF (no %PDF- header)');
  const session = await db.interview_sessions.get(sessionId);
  if (!session) throw new TouFileError(`session not found: ${sessionId}`);
  const sha256 = await sha256Hex(bytes);
  const tou_file: StoredTouFile = { name: clean, base64: toBase64(bytes), sha256, size: bytes.length };
  await db.interview_sessions.update(sessionId, {
    provisioning_inputs: { ...(session.provisioning_inputs ?? {}), tou_file },
  });
  return touFileRef(clean, sha256);
}

/** What the Infrastructure Manifest emits from the intake. */
export interface ProvisioningInputs {
  approverUpn?: string;
  touFile?: { name: string; base64: string; sha256: string };
  initialPasswordRef?: string;
  /** Human labels of inputs not supplied (listed as defaulted on the Plan tab). */
  missing: string[];
}

/** The latest valid answer per provisioning node. */
function latest(facts: InterviewFact[], id: string, kind: 'upn' | 'file' | 'secret'): string | undefined {
  for (let i = facts.length - 1; i >= 0; i--) {
    const f = facts[i];
    if (f.question_id !== id || f.confidence === 'unknown') continue;
    return parsePlanInputAnswer(kind, f.answer).ok ? f.answer.trim() : undefined;
  }
  return undefined;
}

export function readProvisioningInputs(facts: InterviewFact[], session: Pick<InterviewSession, 'provisioning_inputs'>): ProvisioningInputs {
  const out: ProvisioningInputs = { missing: [] };
  out.approverUpn = latest(facts, PROVISIONING_NODE_IDS.approverUpn, 'upn');
  if (!out.approverUpn) out.missing.push(`${PROVISIONING_NODE_IDS.approverUpn}: PIM approver UPN (not supplied)`);

  const touRef = latest(facts, PROVISIONING_NODE_IDS.touFile, 'file');
  const stored = session.provisioning_inputs?.tou_file;
  if (touRef && stored && touRef === touFileRef(stored.name, stored.sha256)) {
    out.touFile = { name: stored.name, base64: stored.base64, sha256: stored.sha256 };
  } else {
    out.missing.push(
      `${PROVISIONING_NODE_IDS.touFile}: terms-of-use file (${touRef ? 'referenced file not stored on this session' : 'not uploaded'})`
    );
  }

  out.initialPasswordRef = latest(facts, PROVISIONING_NODE_IDS.initialPassword, 'secret');
  if (!out.initialPasswordRef) {
    out.missing.push(`${PROVISIONING_NODE_IDS.initialPassword}: initial password (not generated)`);
  }
  return out;
}

// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// planOutputFiles.ts — P2C.1: the headless runner's document outputs
// (scripts/mx/plan-from-discovery.ts), next to its plan files:
//   policies/<base>.md + policies/<base>.docx   the 20 MG-16 documents
//   reports/<file>                              the MG-11 / MG-18 reports
//                                               (renderReports: JSON + Planner's
//                                               download format each)
// MG-12: and the hand-off envelopes beside the plan files:
//   si-baseline-<slug>-<ts>.json, tcp-<slug>-<ts>.json, readiness-posture-<slug>-<ts>.json
//   (muster-api's push names; the MP references each by id and hash)
// W3.3a (B9): and the policy hand-off envelopes, from the rendered policy set:
//   policy-inputs-profile-<slug>-<ts>.json, policy-set-manifest-<slug>-<ts>.json
//   (the MP references each by id, hash and file name)
// Node only (fs).
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  conventionPatterns,
  policyFileBase,
  policyFiles,
  unresolvedTokens,
  type PolicySet,
} from '../policy/policyDocuments';
import {
  buildPolicyHandoffArtifacts,
  HANDOFF_KINDS,
  handoffFileName,
  POLICY_HANDOFF_KINDS,
  referenceHandoffArtifacts,
  type HandoffArtifacts,
  type HandoffKind,
} from '../artifactRefs';

export interface PolicyOutputSummary {
  documents: number;
  /** Written file names, relative to the output folder (policies/…). */
  files: string[];
  /** base name -> unresolved tokens left in its markdown (naming-convention patterns excluded). */
  unresolved: Record<string, string[]>;
  /** The naming-convention patterns quoted verbatim (not tokens). */
  conventionPatterns: string[];
  /** Personnel drafted from role holders and not yet confirmed (not rendered). */
  personnelDrafts: string[];
  /** Policy input sources by provenance (counts). */
  sources: Record<string, number>;
}

export async function writePolicyOutputs(outDir: string, set: PolicySet): Promise<PolicyOutputSummary> {
  const dir = path.join(outDir, 'policies');
  fs.mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  const unresolved: Record<string, string[]> = {};
  const patterns = conventionPatterns(set.context);
  for (const [base, f] of Object.entries(await policyFiles(set))) {
    fs.writeFileSync(path.join(dir, `${base}.md`), f.markdown, 'utf8');
    fs.writeFileSync(path.join(dir, `${base}.docx`), f.docx);
    files.push(`policies/${base}.md`, `policies/${base}.docx`);
    const left = unresolvedTokens(f.markdown, patterns);
    if (left.length > 0) unresolved[base] = left;
  }
  const sources: Record<string, number> = {};
  for (const s of set.profile.sources) sources[s.provenance] = (sources[s.provenance] ?? 0) + 1;
  return {
    documents: set.documents.length,
    files,
    unresolved,
    conventionPatterns: patterns,
    personnelDrafts: set.profile.drafts.map((d) => d.question_id),
    sources,
  };
}

/** renderReports' file name -> content, written under reports/. Returns the relative names. */
export function writeReportOutputs(outDir: string, reports: Record<string, string>): string[] {
  const dir = path.join(outDir, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  return Object.entries(reports).map(([name, content]) => {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
    return `reports/${name}`;
  });
}

/** MG-12: the compile's hand-off envelopes, as muster-api's push stores them. Returns kind -> absolute path. */
export function writeHandoffOutputs(
  outDir: string,
  slug: string,
  ts: string,
  handoff: HandoffArtifacts
): Partial<Record<HandoffKind, string>> {
  fs.mkdirSync(outDir, { recursive: true });
  const out: Partial<Record<HandoffKind, string>> = {};
  for (const kind of HANDOFF_KINDS) {
    const envelope = handoff[kind];
    if (!envelope) continue;
    const p = path.join(outDir, handoffFileName(kind, slug, ts));
    fs.writeFileSync(p, JSON.stringify(envelope, null, 2), 'utf8');
    out[kind] = p;
  }
  return out;
}

/**
 * W3.3a: the policy-inputs profile and the hashed policy-set manifest of a
 * rendered set, as hand-off envelopes beside the plan files. The MP (in
 * place) gets inputs.policy_inputs_profile_ref / policy_set_manifest_ref with
 * the hash and the file name. The caller writes the MP afterwards. Returns
 * kind -> absolute path.
 */
export async function writePolicyHandoffOutputs(
  outDir: string,
  slug: string,
  ts: string,
  set: PolicySet,
  missionPlan: unknown,
  cesId: string
): Promise<Partial<Record<HandoffKind, string>>> {
  const documents: Record<string, string> = {};
  for (const doc of set.documents) documents[policyFileBase(doc)] = doc.markdown;
  const handoff = await buildPolicyHandoffArtifacts({ profileOutput: set.profile.output, documents }, cesId);
  const fileNames: Partial<Record<HandoffKind, string>> = {};
  for (const kind of POLICY_HANDOFF_KINDS) fileNames[kind] = handoffFileName(kind, slug, ts);
  referenceHandoffArtifacts(missionPlan, handoff, fileNames);
  return writeHandoffOutputs(outDir, slug, ts, handoff);
}

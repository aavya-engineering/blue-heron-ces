// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// tcpProvisioningNodes.ts — FC-MU-2 (MS-5 live, founder decision 2026-09-27):
// the three Stamper provisioning inputs no artifact produced before, asked in
// the Tenant Config intake (cluster 'plan-input:tcp') and emitted in the
// Infrastructure Manifest (tcpAdapter.decorateInfraManifest):
//
//   TCP.MU.001  PIM approver UPN          → stamper_variable_map.approverUPN
//   TCP.MU.002  terms-of-use file (PDF)   → stamper_variable_map.touFileName / touFileBase64
//   TCP.MU.003  initial password          → secret_references[] (one-time reference)
//
// These are Muster-side questions: the primed TCP Question Bank (Planner-owned,
// vendored) has no such questions, so they are NOT in TCP_NODE_SPECS and the
// bank parity test does not cover them. Same node contract as every plan input:
// mapped_requirements [] (score-leak safe), plan_input set, optional for finish.
//
// The password is GENERATED (provisioningInputs.generateInitialPassword), never
// typed; the session records only its one-time reference. The ToU file bytes
// live on the session (provisioning_inputs.tou_file), the fact records name +
// sha256 — the bytes never enter facts[] (which flow into exports).
import type { QuestionNode } from './questionGraph';

export const PROVISIONING_NODE_IDS = {
  approverUpn: 'TCP.MU.001',
  touFile: 'TCP.MU.002',
  initialPassword: 'TCP.MU.003',
} as const;

export const TCP_PROVISIONING_NODES: QuestionNode[] = [
  {
    id: PROVISIONING_NODE_IDS.approverUpn,
    text: 'Who approves privileged role activations (PIM)? Enter the approver’s sign-in name (UPN).',
    options: [],
    input: 'upn',
    cluster: 'plan-input:tcp',
    mapped_requirements: [],
    plan_input: { contract: 'infrastructure_manifest', field: 'stamper_variable_map.approverUPN' },
  },
  {
    id: PROVISIONING_NODE_IDS.touFile,
    text: 'Upload the terms-of-use document users must accept (PDF).',
    options: [],
    input: 'file',
    cluster: 'plan-input:tcp',
    mapped_requirements: [],
    plan_input: { contract: 'infrastructure_manifest', field: 'stamper_variable_map.touFileBase64' },
  },
  {
    id: PROVISIONING_NODE_IDS.initialPassword,
    text: 'Generate the initial password for accounts the build creates (shown once, never stored).',
    options: [],
    input: 'secret',
    cluster: 'plan-input:tcp',
    mapped_requirements: [],
    plan_input: { contract: 'infrastructure_manifest', field: 'secret_references.initialPassword' },
  },
];

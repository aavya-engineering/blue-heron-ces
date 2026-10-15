// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Shared package barrel — prefer subpath imports for tree-shaking.
// e.g. import { TenantConfig } from 'ces-shared/config'

export { TenantConfig, loadTenantConfig, resolveEndpointVariables, resolveTenantJsonPath } from './config/TenantConfig.js';
export { ensureEcRunning } from './launcher/EcLauncher.js';
export type { EnsureEcRunningOptions, EnsureEcRunningResult, SpawnFn, HealthCheckFn, SleepFn } from './launcher/EcLauncher.js';
export type {
  EvidenceStorageConfig,
  BlobUploadResult,
  BlobListEntry,
  BlobListResult,
  BlobDownloadResult,
} from './blob/blobUpload.js';
export {
  uploadEvidenceBlob,
  downloadBlob,
  listBlobs,
  listEvidenceBlobs,
  downloadEvidenceBlob,
} from './blob/blobUpload.js';

// EC contract (M1, evidence-collector PLAN.md).
export {
  EC_CONTRACT_VERSION,
  SUPPORTED_EC_CONTRACT_VERSIONS,
  EcHealthStatus,
  EcMode,
  EcHealthSchema,
  EcRunType,
  EcRunStatus,
  EcRunSchema,
  EcFindingSeverity,
  EcFindingStatus,
  EcFindingSchema,
  EcEvidenceSource,
  EcEvidenceItemSchema,
  EcLedgerOrigin,
  EcLedgerEntrySchema,
} from './types/evidence-collector.contract.js';
export type {
  EcHealthStatusType,
  EcModeType,
  EcHealth,
  EcRunTypeType,
  EcRunStatusType,
  EcRun,
  EcFindingSeverityType,
  EcFindingStatusType,
  EcFinding,
  EcEvidenceSourceType,
  EcEvidenceItem,
  EcLedgerOriginType,
  EcLedgerEntry,
} from './types/evidence-collector.contract.js';

// EC storage roots (M1).
export { getEcModuleRoot, getEcTenantRoot } from './storage/node.js';

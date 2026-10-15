// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// App configuration

export const APP_CONFIG = {
  DEV_MODE: import.meta.env.DEV,
  APP_NAME: 'CES',
  VERSION: '1.0.0',
  SCHEMA_VERSION: '4.0',
  DATA_VERSION: '1.0.0',
};

// Direct export for convenience
export const DEV_MODE = import.meta.env.DEV;

export const PATHS = {
  DATA: '/data',
  SCHEMAS: '/schemas',
};

// TODO: derive tenant slug automatically from TCP primary_domain
export const STAMPER_BASE_PATH = '../stamper/plan-data/vfsgov-xtra';
export const STAMPER_EXPORT_KEY = 'ces-stamper-export-path';

export const STORAGE_KEYS = {
  APP_STORE: 'ces-app-store',
  SIT_STORE: 'ces-sit-store',
  CUI_STORE: 'ces-cui-store',
  BTC_STORE: 'ces-btc-store',
  TCP_STORE: 'ces-tcp-store',
  RRT_STORE: 'ces-rrt-store',
  POLICY_STORE: 'ces-policy-store',
  LOE_RATE_STORE: 'ces-loe-rates',
};

export const WORKFLOW_STAGES = {
  CUSTOMER_SELECTION: 'customer_selection',
  SIT: 'sit',
  SIT_REVIEW: 'sit_review',
  TCP: 'tcp',
  TCP_REVIEW: 'tcp_review',
  CUI: 'cui',
  CUI_REVIEW: 'cui_review',
  BTC: 'btc',
  BTC_REVIEW: 'btc_review',
  RRT: 'rrt',
  RRT_REVIEW: 'rrt_review',
  MPT: 'mpt',
  COMPLETE: 'complete',
} as const;

export type WorkflowStage = (typeof WORKFLOW_STAGES)[keyof typeof WORKFLOW_STAGES];

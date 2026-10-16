// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

export { StamperConfig, type StamperConfigOptions } from './config/StamperConfig.js';
export {
  SessionManager,
  ENGINE_SESSION_MAP,
  type SessionType,
  type SessionState,
  type PSResult,
} from './core/SessionManager.js';
export {
  PowerShellAdapter,
  type ExecutionPhase,
  type SubCommandStreamEvent,
  type SubCommandStreamCallback,
} from './adapters/PowerShellAdapter.js';
export { CommandRegistry } from './registry/CommandRegistry.js';
export type { CommandEntry, CommandRegistryData } from './registry/command-registry.types.js';
export type { ExeTask, ExecutionResult, SubCommand, CaptureSpec } from './types/schema.types.js';

// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

export function generateId(prefix: string = ''): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 9);
  return prefix ? `${prefix}_${timestamp}_${randomPart}` : `${timestamp}_${randomPart}`;
}

export function generateSnapshotId(): string {
  return generateId('snapshot');
}

export function generateArtifactId(artifactType: string): string {
  return generateId(artifactType);
}

export function generateHash(data: string): string {
  // Simple hash for browser - in production, use crypto-js or similar
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(16, '0');
}

export function generateSHA256(data: string): string {
  // Placeholder - in real implementation, use SubtleCrypto API
  // For now, use simple hash
  return generateHash(data).padStart(64, '0');
}

/**
 * Generate a globally unique CES ID (Campaign Engagement Session ID).
 * Format: ces-{12-char-hex-hash}
 * Uses SHA-256 hash of customerName + timestamp for global uniqueness.
 */
export async function generateCesId(customerName: string, timestamp: string): Promise<string> {
  const input = customerName + timestamp;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `ces-${hashHex.substring(0, 12)}`;
}

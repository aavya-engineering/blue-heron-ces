// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as crypto from 'crypto';
import * as https from 'https';
import { URL } from 'url';
import { EvidenceStorageConfig } from '../config/ClientConfig.js';

export interface BlobUploadResult {
  success: boolean;
  url: string;
  error?: string;
}

export interface BlobListResult {
  success: boolean;
  blobs: string[];   // relative paths within the container
  error?: string;
}

export interface BlobDownloadResult {
  success: boolean;
  content: string;
  error?: string;
}

/**
 * Upload a text blob to Azure Blob Storage using SharedKey authentication.
 * Used to persist evidence files directly to the tenant's EO storage account
 * in real time as each sub-command completes.
 */
export async function uploadEvidenceBlob(
  config: EvidenceStorageConfig,
  blobPath: string,
  content: string
): Promise<BlobUploadResult> {
  const blobUrl = `${config.blob_endpoint}${config.container}/${blobPath}`;
  const parsed = new URL(blobUrl);

  const contentBytes = Buffer.from(content, 'utf-8');
  const now = new Date().toUTCString();
  const version = '2021-06-08';

  // Determine Content-Type based on file extension
  const contentType = blobPath.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8';

  const canonicalHeaders =
    `x-ms-blob-type:BlockBlob\n` +
    `x-ms-date:${now}\n` +
    `x-ms-version:${version}`;

  const canonicalResource = `/${config.account_name}/${config.container}/${blobPath}`;

  const stringToSign = [
    'PUT',                           // HTTP method
    '',                              // Content-Encoding
    '',                              // Content-Language
    String(contentBytes.length),     // Content-Length
    '',                              // Content-MD5
    contentType,                     // Content-Type
    '',                              // Date
    '',                              // If-Modified-Since
    '',                              // If-Match
    '',                              // If-None-Match
    '',                              // If-Unmodified-Since
    '',                              // Range
    canonicalHeaders,
    canonicalResource,
  ].join('\n');

  const sig = crypto
    .createHmac('sha256', Buffer.from(config.account_key, 'base64'))
    .update(stringToSign, 'utf8')
    .digest('base64');

  return new Promise<BlobUploadResult>((resolve) => {
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname,
        method: 'PUT',
        timeout: 15000,
        headers: {
          'Content-Type': contentType,
          'Content-Length': contentBytes.length,
          'x-ms-blob-type': 'BlockBlob',
          'x-ms-date': now,
          'x-ms-version': version,
          'Authorization': `SharedKey ${config.account_name}:${sig}`,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, url: blobUrl });
          } else {
            const errorMatch = body.match(/<Message>(.*?)<\/Message>/);
            const errorMsg = errorMatch ? errorMatch[1] : `HTTP ${res.statusCode}: ${body.substring(0, 200)}`;
            resolve({ success: false, url: blobUrl, error: errorMsg });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, url: blobUrl, error: 'Request timed out (15s)' });
    });

    req.on('error', (err) => {
      resolve({ success: false, url: blobUrl, error: err.message });
    });

    req.write(contentBytes);
    req.end();
  });
}

/** SharedKey signature helper for GET and LIST operations (no body). */
function signRequest(
  config: EvidenceStorageConfig,
  method: string,
  canonicalResource: string,
  now: string,
  version: string,
): string {
  const canonicalHeaders =
    `x-ms-date:${now}\n` +
    `x-ms-version:${version}`;

  const stringToSign = [
    method,  // HTTP method
    '',      // Content-Encoding
    '',      // Content-Language
    '',      // Content-Length (empty for GET)
    '',      // Content-MD5
    '',      // Content-Type
    '',      // Date
    '',      // If-Modified-Since
    '',      // If-Match
    '',      // If-None-Match
    '',      // If-Unmodified-Since
    '',      // Range
    canonicalHeaders,
    canonicalResource,
  ].join('\n');

  return crypto
    .createHmac('sha256', Buffer.from(config.account_key, 'base64'))
    .update(stringToSign, 'utf8')
    .digest('base64');
}

/**
 * List blobs in the tenant's evidence container under base_path prefix.
 * Returns relative blob names (full path within the container).
 */
export async function listEvidenceBlobs(
  config: EvidenceStorageConfig,
): Promise<BlobListResult> {
  const prefix = config.base_path.endsWith('/')
    ? config.base_path
    : config.base_path + '/';
  const queryParams = `restype=container&comp=list&prefix=${encodeURIComponent(prefix)}`;
  const listUrl = `${config.blob_endpoint}${config.container}?${queryParams}`;
  const parsed = new URL(listUrl);

  const now = new Date().toUTCString();
  const version = '2021-06-08';

  // Canonical resource includes query parameters for list operations
  const canonicalResource =
    `/${config.account_name}/${config.container}\ncomp:list\nprefix:${prefix}\nrestype:container`;

  const sig = signRequest(config, 'GET', canonicalResource, now, version);

  return new Promise<BlobListResult>((resolve) => {
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + '?' + queryParams,
        method: 'GET',
        timeout: 15000,
        headers: {
          'x-ms-date': now,
          'x-ms-version': version,
          'Authorization': `SharedKey ${config.account_name}:${sig}`,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            // Parse XML blob names: <Name>...</Name> inside <Blob> elements
            const blobs: string[] = [];
            const regex = /<Blob>[\s\S]*?<Name>(.*?)<\/Name>[\s\S]*?<\/Blob>/g;
            let match;
            while ((match = regex.exec(body)) !== null) {
              blobs.push(match[1]);
            }
            resolve({ success: true, blobs });
          } else {
            const errorMatch = body.match(/<Message>(.*?)<\/Message>/);
            const errorMsg = errorMatch ? errorMatch[1] : `HTTP ${res.statusCode}: ${body.substring(0, 200)}`;
            resolve({ success: false, blobs: [], error: errorMsg });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, blobs: [], error: 'Request timed out (15s)' });
    });

    req.on('error', (err) => {
      resolve({ success: false, blobs: [], error: err.message });
    });

    req.end();
  });
}

/**
 * Download a single blob's content from the tenant's evidence storage.
 */
export async function downloadEvidenceBlob(
  config: EvidenceStorageConfig,
  blobPath: string,
): Promise<BlobDownloadResult> {
  const blobUrl = `${config.blob_endpoint}${config.container}/${blobPath}`;
  const parsed = new URL(blobUrl);

  const now = new Date().toUTCString();
  const version = '2021-06-08';

  const canonicalResource = `/${config.account_name}/${config.container}/${blobPath}`;
  const sig = signRequest(config, 'GET', canonicalResource, now, version);

  return new Promise<BlobDownloadResult>((resolve) => {
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname,
        method: 'GET',
        timeout: 15000,
        headers: {
          'x-ms-date': now,
          'x-ms-version': version,
          'Authorization': `SharedKey ${config.account_name}:${sig}`,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, content: body });
          } else {
            const errorMatch = body.match(/<Message>(.*?)<\/Message>/);
            const errorMsg = errorMatch ? errorMatch[1] : `HTTP ${res.statusCode}: ${body.substring(0, 200)}`;
            resolve({ success: false, content: '', error: errorMsg });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, content: '', error: 'Request timed out (15s)' });
    });

    req.on('error', (err) => {
      resolve({ success: false, content: '', error: err.message });
    });

    req.end();
  });
}

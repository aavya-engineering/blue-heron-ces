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
import type { EvidenceStorageConfig } from '../config/TenantConfig.js';

export type { EvidenceStorageConfig } from '../config/TenantConfig.js';

export interface BlobUploadResult {
  success: boolean;
  url: string;
  error?: string;
}

export interface BlobListEntry {
  name: string;
  properties: { contentLength?: string; lastModified?: string };
}

export interface BlobListResult {
  success: boolean;
  blobs: string[];
  error?: string;
}

export interface BlobDownloadResult {
  success: boolean;
  content: string;
  error?: string;
}

const API_VERSION = '2021-06-08';

function validateBlobPrefix(prefix: string): void {
  if (prefix.includes('..')) {
    throw new Error('Blob prefix must not contain path traversal sequences (..)');
  }
  if (prefix.startsWith('/')) {
    throw new Error('Blob prefix must not start with /');
  }
}

/** SharedKey signature helper for GET and LIST operations (no body). */
function signRequest(
  config: EvidenceStorageConfig,
  method: string,
  canonicalResource: string,
  now: string,
): string {
  const canonicalHeaders =
    `x-ms-date:${now}\n` +
    `x-ms-version:${API_VERSION}`;

  const stringToSign = [
    method,
    '', '', '', '', '', '', '', '', '', '', '',
    canonicalHeaders,
    canonicalResource,
  ].join('\n');

  return crypto
    .createHmac('sha256', Buffer.from(config.account_key, 'base64'))
    .update(stringToSign, 'utf8')
    .digest('base64');
}

/**
 * Upload a text blob to Azure Blob Storage using SharedKey authentication.
 */
export async function uploadEvidenceBlob(
  config: EvidenceStorageConfig,
  blobPath: string,
  content: string
): Promise<BlobUploadResult> {
  validateBlobPrefix(blobPath);
  const fullPath = config.base_path ? `${config.base_path}/${blobPath}` : blobPath;
  const blobUrl = `${config.blob_endpoint}${config.container}/${fullPath}`;
  const parsed = new URL(blobUrl);

  const contentBytes = Buffer.from(content, 'utf-8');
  const now = new Date().toUTCString();

  // Determine Content-Type based on file extension (Stamper enhancement)
  const contentType = blobPath.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8';

  const canonicalHeaders =
    `x-ms-blob-type:BlockBlob\n` +
    `x-ms-date:${now}\n` +
    `x-ms-version:${API_VERSION}`;

  const canonicalResource = `/${config.account_name}/${config.container}/${fullPath}`;

  const stringToSign = [
    'PUT',
    '',
    '',
    String(contentBytes.length),
    '',
    contentType,
    '',
    '',
    '',
    '',
    '',
    '',
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
          'x-ms-version': API_VERSION,
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
            const errorMatch = body.match(/<Message>(.*?)<\/Message>/s);
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

/**
 * Download a blob by path. Returns content string or null if not found.
 */
export async function downloadBlob(
  config: EvidenceStorageConfig,
  blobPath: string
): Promise<string | null> {
  validateBlobPrefix(blobPath);
  const fullPath = config.base_path ? `${config.base_path}/${blobPath}` : blobPath;
  const blobUrl = `${config.blob_endpoint}${config.container}/${fullPath}`;
  const parsed = new URL(blobUrl);

  const now = new Date().toUTCString();
  const canonicalResource = `/${config.account_name}/${config.container}/${fullPath}`;
  const sig = signRequest(config, 'GET', canonicalResource, now);

  return new Promise<string | null>((resolve) => {
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname,
        method: 'GET',
        timeout: 15000,
        headers: {
          'x-ms-date': now,
          'x-ms-version': API_VERSION,
          'Authorization': `SharedKey ${config.account_name}:${sig}`,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode === 404) {
            resolve(null);
          } else if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body);
          } else {
            resolve(null);
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });

    req.on('error', () => resolve(null));
    req.end();
  });
}

/**
 * List blobs under a prefix. Returns array of blob entries with name and properties.
 */
export async function listBlobs(
  config: EvidenceStorageConfig,
  prefix: string
): Promise<BlobListEntry[]> {
  validateBlobPrefix(prefix);
  const fullPrefix = config.base_path ? `${config.base_path}/${prefix}` : prefix;
  const containerUrl = `${config.blob_endpoint}${config.container}`;
  const parsed = new URL(containerUrl);

  const now = new Date().toUTCString();
  const canonicalResource = `/${config.account_name}/${config.container}\ncomp:list\nprefix:${fullPrefix}\nrestype:container`;
  const sig = signRequest(config, 'GET', canonicalResource, now);

  const queryPath = `${parsed.pathname}?restype=container&comp=list&prefix=${encodeURIComponent(fullPrefix)}`;

  return new Promise<BlobListEntry[]>((resolve) => {
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: queryPath,
        method: 'GET',
        timeout: 15000,
        headers: {
          'x-ms-date': now,
          'x-ms-version': API_VERSION,
          'Authorization': `SharedKey ${config.account_name}:${sig}`,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`[listBlobs] HTTP ${res.statusCode} OK for prefix="${fullPrefix}" — raw XML length=${body.length}`);
            console.log(`[listBlobs] XML snippet: ${body.substring(0, 500)}`);
            const parsed = parseListBlobsXml(body, config.base_path);
            console.log(`[listBlobs] Parsed ${parsed.length} entries from XML`);
            resolve(parsed);
          } else {
            const errorMatch = body.match(/<Message>(.*?)<\/Message>/s);
            const errorMsg = errorMatch ? errorMatch[1] : body.substring(0, 300);
            console.warn(`[listBlobs] HTTP ${res.statusCode} for prefix="${fullPrefix}": ${errorMsg}`);
            resolve([]);
          }
        });
      }
    );

    req.on('timeout', () => {
      console.warn(`[listBlobs] Request timed out for prefix="${fullPrefix}"`);
      req.destroy();
      resolve([]);
    });

    req.on('error', (err) => {
      console.warn(`[listBlobs] Network error for prefix="${fullPrefix}": ${err.message}`);
      resolve([]);
    });
    req.end();
  });
}

function parseListBlobsXml(xml: string, basePath: string): BlobListEntry[] {
  const entries: BlobListEntry[] = [];
  const blobRegex = /<Blob>\s*<Name>(.*?)<\/Name>[\s\S]*?<Properties>([\s\S]*?)<\/Properties>[\s\S]*?<\/Blob>/g;
  let match: RegExpExecArray | null;

  while ((match = blobRegex.exec(xml)) !== null) {
    let name = match[1];
    const props = match[2];

    const stripPrefix = basePath ? `${basePath}/` : '';
    if (stripPrefix && name.startsWith(stripPrefix)) {
      name = name.substring(stripPrefix.length);
    }

    const contentLengthMatch = props.match(/<Content-Length>(.*?)<\/Content-Length>/);
    const lastModifiedMatch = props.match(/<Last-Modified>(.*?)<\/Last-Modified>/);

    entries.push({
      name,
      properties: {
        contentLength: contentLengthMatch?.[1],
        lastModified: lastModifiedMatch?.[1],
      },
    });
  }

  return entries;
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
  const canonicalResource =
    `/${config.account_name}/${config.container}\ncomp:list\nprefix:${prefix}\nrestype:container`;
  const sig = signRequest(config, 'GET', canonicalResource, now);

  return new Promise<BlobListResult>((resolve) => {
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + '?' + queryParams,
        method: 'GET',
        timeout: 15000,
        headers: {
          'x-ms-date': now,
          'x-ms-version': API_VERSION,
          'Authorization': `SharedKey ${config.account_name}:${sig}`,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
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
  const canonicalResource = `/${config.account_name}/${config.container}/${blobPath}`;
  const sig = signRequest(config, 'GET', canonicalResource, now);

  return new Promise<BlobDownloadResult>((resolve) => {
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname,
        method: 'GET',
        timeout: 15000,
        headers: {
          'x-ms-date': now,
          'x-ms-version': API_VERSION,
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

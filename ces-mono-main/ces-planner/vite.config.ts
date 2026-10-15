// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {
  getPlannerCustomersRoot,
  getPlannerArtifactDirectory,
  getTimestampedJsonFilename,
  sanitizeCustomerName,
} from '../ces-shared/src/storage/PipelineStorage';
// G2: dev-server artifact mirror writes go through the unified file-artifact interface,
// so no caller writes raw JSON directly to disk.
import { writeJsonArtifact, writeTextArtifact } from '../ces-shared/src/persistence/fileArtifacts';

/** Return Stamper-convention filename with ISO timestamp (colons/dots replaced for Windows) */
function getStamperFilename(type: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${type}-${timestamp}.json`;
}

function resolveCustomerArtifactPath(artifactPath: string): string {
  if (path.isAbsolute(artifactPath)) {
    return path.resolve(artifactPath);
  }

  const normalized = artifactPath.replace(/\\/g, '/');
  const withoutCustomersPrefix = normalized.startsWith('customers/')
    ? normalized.slice('customers/'.length)
    : normalized;

  return path.resolve(getPlannerCustomersRoot(), withoutCustomersPrefix);
}

// Plugin to save artifacts to disk during development
function artifactPersistencePlugin(): Plugin {
  return {
    name: 'artifact-persistence',
    configureServer(server) {
      // List all generated artifacts — scans customers/ recursively
      server.middlewares.use('/api/list-artifacts', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        try {
          const customersDir = getPlannerCustomersRoot();
          const artifacts: Array<{
            type: string;
            filename: string;
            path: string;
            size: number;
            createdAt: string;
            customerName: string;
            category: string;
          }> = [];

          if (fs.existsSync(customersDir)) {
            const customerDirs = fs.readdirSync(customersDir);
            for (const customerDir of customerDirs) {
              const customerPath = path.join(customersDir, customerDir);
              if (!fs.statSync(customerPath).isDirectory()) continue;

              // Scan category subdirs (inputs, outputs) and root files
              const entries = fs.readdirSync(customerPath);
              for (const entry of entries) {
                const entryPath = path.join(customerPath, entry);
                if (fs.statSync(entryPath).isDirectory()) {
                  // Category directory (inputs or outputs)
                  const category = entry;
                  const files = fs.readdirSync(entryPath);
                  for (const filename of files) {
                    if (!filename.endsWith('.json')) continue;
                    const filepath = path.join(entryPath, filename);
                    const stats = fs.statSync(filepath);
                    // Extract type from filename: {type}_{artifactId}.json
                    const typePart = filename.replace(/_.+$/, '');
                    artifacts.push({
                      type: typePart,
                      filename,
                      path: `customers/${customerDir}/${category}/${filename}`,
                      size: stats.size,
                      createdAt: stats.birthtime.toISOString(),
                      customerName: customerDir,
                      category,
                    });
                  }
                } else if (entry.endsWith('.json')) {
                  // Root-level file (e.g. customer record)
                  const stats = fs.statSync(entryPath);
                  const typePart = entry.replace(/_.+$/, '');
                  artifacts.push({
                    type: typePart,
                    filename: entry,
                    path: `customers/${customerDir}/${entry}`,
                    size: stats.size,
                    createdAt: stats.birthtime.toISOString(),
                    customerName: customerDir,
                    category: '',
                  });
                }
              }
            }
          }

          // Sort by creation date descending
          artifacts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ artifacts }));
        } catch (err) {
          console.error('Error listing artifacts:', err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err) }));
        }
      });

      // Delete an artifact
      server.middlewares.use('/api/delete-artifact', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const { path: artifactPath } = JSON.parse(body);

            // Security: ensure path is within customers folder
            const fullPath = resolveCustomerArtifactPath(artifactPath);
            const customersDir = getPlannerCustomersRoot();
            if (!fullPath.startsWith(customersDir)) {
              res.statusCode = 403;
              res.end(JSON.stringify({ error: 'Access denied' }));
              return;
            }

            if (fs.existsSync(fullPath)) {
              fs.unlinkSync(fullPath);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true }));
            } else {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'File not found' }));
            }
          } catch (err) {
            console.error('Error deleting artifact:', err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
      });

      // Download an artifact
      server.middlewares.use('/api/download-artifact', async (req, res) => {
        const url = new URL(req.url!, `http://${req.headers.host}`);
        const artifactPath = url.searchParams.get('path');

        if (!artifactPath) {
          res.statusCode = 400;
          res.end('Missing path parameter');
          return;
        }

        try {
          const fullPath = resolveCustomerArtifactPath(artifactPath);
          const customersDir = getPlannerCustomersRoot();
          if (!fullPath.startsWith(customersDir)) {
            res.statusCode = 403;
            res.end('Access denied');
            return;
          }

          if (fs.existsSync(fullPath)) {
            const content = fs.readFileSync(fullPath);
            const filename = path.basename(fullPath);
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.end(content);
          } else {
            res.statusCode = 404;
            res.end('File not found');
          }
        } catch (err) {
          console.error('Error downloading artifact:', err);
          res.statusCode = 500;
          res.end(String(err));
        }
      });

      // Save artifact — uses customers/{customerName}/{category}/ structure
      server.middlewares.use('/api/save-artifact', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const { type, data, customerName, category, artifactId } = JSON.parse(body);

            const safeName = sanitizeCustomerName(customerName || 'unknown');

            // Build target directory: {CES_PIPELINE_ROOT}/Planner/customers/{name}/{category}/
            // 'customer' type artifacts go to the customer root dir
            const targetDir = getPlannerArtifactDirectory({
              customerName: safeName,
              category: type === 'customer' ? undefined : category || 'inputs',
            });

            if (!fs.existsSync(targetDir)) {
              fs.mkdirSync(targetDir, { recursive: true });
            }

            // Filename: cesId-prefixed when available, else the timestamped name.
            // Keeps our persistent customers/{name}/{category}/ folder + timestamping
            // helper, and adds his cesId stamp (data.ces.cesId) as a filename prefix.
            const cesId = data?.ces?.cesId || null;
            const base = getTimestampedJsonFilename(type, artifactId);
            const filename = cesId ? `${cesId}_${base}` : base;
            const filepath = path.join(targetDir, filename);

            // Check if file exists - don't overwrite
            if (fs.existsSync(filepath)) {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, path: filepath, skipped: true }));
              return;
            }

            writeJsonArtifact(filepath, data);

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, path: filepath }));
          } catch (err) {
            console.error('Error saving artifact:', err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
      });

      // Save artifacts to Stamper directory with Stamper naming convention
      server.middlewares.use('/api/save-to-stamper', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        let body = '';
        req.on('data', (chunk: string) => (body += chunk));
        req.on('end', async () => {
          try {
            const {
              artifacts,
              targetDir,
            }: { artifacts: Array<{ type: string; path: string }>; targetDir: string } =
              JSON.parse(body);

            // Security: ensure targetDir is not within customers/ directory
            const resolvedTarget = path.resolve(__dirname, targetDir);
            console.log('[save-to-stamper] targetDir:', targetDir, '-> resolved:', resolvedTarget);
            const customersDir = getPlannerCustomersRoot();
            if (resolvedTarget.startsWith(customersDir)) {
              res.statusCode = 403;
              res.end(JSON.stringify({ error: 'Target directory cannot be within customers/' }));
              return;
            }

            // Create target directory if it doesn't exist
            if (!fs.existsSync(resolvedTarget)) {
              fs.mkdirSync(resolvedTarget, { recursive: true });
            }

            const savedFiles: Array<{ type: string; filename: string; path: string }> = [];

            for (const artifact of artifacts) {
              const sourcePath = resolveCustomerArtifactPath(artifact.path);
              if (!fs.existsSync(sourcePath)) {
                res.statusCode = 404;
                res.end(
                  JSON.stringify({ error: `Source file not found: ${artifact.path}` }),
                );
                return;
              }

              const content = fs.readFileSync(sourcePath, 'utf-8');
              const stamperFilename = getStamperFilename(artifact.type);

              // All Stamper artifacts go into the plans/ subdirectory
              const destDir = path.join(resolvedTarget, 'plans');
              if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
              }
              const destPath = path.join(destDir, stamperFilename);

              writeTextArtifact(destPath, content); // content is already-serialized artifact JSON

              savedFiles.push({
                type: artifact.type,
                filename: stamperFilename,
                path: destPath,
              });
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, savedFiles }));
          } catch (err) {
            console.error('Error saving to stamper:', err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), artifactPersistencePlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/shared': path.resolve(__dirname, './src/shared'),
      '@/features': path.resolve(__dirname, './src/features'),
    },
  },
  publicDir: 'public',
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom', 'react-router-dom'],
          'state': ['zustand'],
          'db': ['dexie', 'dexie-react-hooks'],
          'validation': ['ajv', 'ajv-formats', 'js-yaml'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['dexie', 'ajv', 'ajv-formats', 'js-yaml'],
  },
});

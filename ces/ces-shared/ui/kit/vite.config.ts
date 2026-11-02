// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const kitRoot = fileURLToPath(new URL('.', import.meta.url));

// AD-1: library build of the kit to ui/kit/dist (ES module, React external).
// `--mode gallery` builds the static gallery page (gallery/index.html) to dist-gallery instead.
export default defineConfig(({ mode }) =>
  mode === 'gallery'
    ? {
        root: kitRoot,
        base: './',
        plugins: [react()],
        build: {
          outDir: 'dist-gallery',
          emptyOutDir: true,
          rollupOptions: {
            input: fileURLToPath(new URL('./gallery/index.html', import.meta.url)),
          },
        },
      }
    : {
        root: kitRoot,
        plugins: [react()],
        build: {
          outDir: 'dist',
          emptyOutDir: true,
          sourcemap: true,
          lib: {
            entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
            formats: ['es'],
            fileName: () => 'index.js',
            cssFileName: 'kit',
          },
          rollupOptions: {
            external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
          },
        },
      },
);

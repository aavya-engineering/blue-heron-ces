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

// FIN-31 (modelled on ces-stamper/ui/vite.config.ts): the EO SPA builds into ces-eo/public/app;
// EoServer serves it at /app/ with history fallback (src/eo/server/routers/eo-ui-router.ts). The
// shared stylesheet and logo stay at EO's legacy static root (/ces-ui.css, /ces-logo.svg).
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/app/',
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('../public/app', import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
  },
});

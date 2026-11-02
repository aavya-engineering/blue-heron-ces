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

// FIN-30: the AO SPA builds into ces-ao/ui/dist (already ignored by the repo's `dist/` rule), and
// AoServer serves it at /app/ (createAoUiRouter). The legacy page stays at / until the flip (FIN-34).
// The shared stylesheet and theme assets stay at AO's legacy static root (/ces-ui.css, /ces-logo.svg).
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/app/',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
  },
});

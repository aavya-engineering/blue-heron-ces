// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G-TENANT-M5: the cwd-curried `resolveTenantJsonPath()` and the
// `loadClientConfigFromTenantJson` file loader that used to live here are
// retired — launch-directory-dependent config resolution was exactly the
// root-resolution drift the ces-tenant registry exists to end. Slug-to-config
// resolution now goes through `src/tenant/aoTenants.ts`
// (`loadTenantConfigBySlug`, ces-tenant registry API exclusively).
import type { TenantConfig } from 'ces-shared/config';

export type ClientConfig = TenantConfig;

// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Registry editor screen (legacy ces-stamper/public/registry-editor.html; PC-13). The kit
// RegistryEditor holds the form; this screen loads, saves and resolves through the store.
// Tenant and type: ?tenant= and ?type= (the legacy window URL, see launchRegistryEditor in
// store/popout.ts), else the workflow store's tenant and m365.

import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RegistryEditor } from 'ces-ui-kit';
import { useWorkflowStore } from '../../store/workflow';
import { registryTypeOf, useRegistryStore } from '../../store/registry';

export const REGISTRY_TITLE = 'Registry Editor';

export default function RegistryScreen() {
  const [params] = useSearchParams();
  const storeTenant = useWorkflowStore((s) => s.tenant);
  const tenant = params.get('tenant') || storeTenant || null;
  const initialType = registryTypeOf(params.get('type'));
  const s = useRegistryStore();
  const { init } = s;

  useEffect(() => {
    void init(tenant, initialType);
  }, [tenant, initialType, init]);

  useEffect(() => {
    const previous = document.title;
    document.title = REGISTRY_TITLE;
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <section className="spa-screen spa-registry" data-screen="registry" aria-label={REGISTRY_TITLE}>
      <RegistryEditor
        registryType={s.registryType}
        entries={s.entries}
        tenant={s.tenant}
        onRegistryTypeChange={(type) => void s.loadType(type)}
        onSave={(type, entry) => void s.save(type, entry)}
        onResolveCommand={(_which, command) => s.resolveCommand(command)}
        onEntryShown={(entry) => void s.checkEntry(entry)}
        varStatus={s.varStatus}
        notice={s.notice}
      />
    </section>
  );
}

// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Unified variables screen (legacy ces-stamper/public/unified-variables.html; PC-12). The kit
// VariablesEditor holds the form; this screen loads and saves through the store. Tenant: ?tenant=
// (the legacy window URL, see launchUnifiedVariables in store/popout.ts), else the workflow store.
// Covers both legacy editors (FG-2: plan-variables.html and config-variables.html are dropped).

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { VariablesEditor } from 'ces-ui-kit';
import { useWorkflowStore } from '../../store/workflow';
import { isEditableTenant, useVariablesStore } from '../../store/variables';

export default function VariablesScreen() {
  const [params] = useSearchParams();
  const storeTenant = useWorkflowStore((s) => s.tenant);
  const tenant = params.get('tenant') || storeTenant || null;
  const s = useVariablesStore();
  const { load } = s;

  useEffect(() => {
    void load(tenant);
  }, [tenant, load]);

  // Legacy sets the window title to "Variables — <slug>" once the config loads (L804).
  const loaded = !!s.pathHint;
  useEffect(() => {
    if (!loaded || !tenant) return undefined;
    const previous = document.title;
    document.title = `Variables — ${tenant}`;
    return () => {
      document.title = previous;
    };
  }, [loaded, tenant]);

  return (
    <section className="spa-screen spa-vars" data-screen="variables" aria-label="Unified variables">
      {s.browseFiles ? <LoadPicker files={s.browseFiles} onLoad={s.loadConfigFromPath} onCancel={s.closeBrowse} /> : null}
      {isEditableTenant(s.tenant) ? <PrecedenceNote /> : null}
      <VariablesEditor
        tenant={s.tenant}
        pathHint={s.pathHint}
        config={s.config}
        variables={s.variables}
        resolvable={s.resolvable}
        notice={s.notice}
        onSaveConfig={(config) => void s.saveConfig(config)}
        onSaveConfigAs={(slug, config) => void s.saveConfigAs(slug, config)}
        onLoadConfig={() => void s.browseConfigs()}
        onSaveVariables={(variables) => void s.saveVariables(variables)}
        onResolve={s.resolve}
        onResolveAll={s.resolveAll}
        onLoadSampleTermsOfUse={s.loadSampleTermsOfUse}
      />
    </section>
  );
}

/**
 * FIN-33, founder ruling FD-13: the Tenant Manifest wins; the plan variables saved here fill gaps
 * only. Translation never reads the tenant's variables.json (translateForTenant.ts); execute lays
 * the saved values UNDER the plan's (executeForTenant.ts: `{ ...saved, ...plan.variables }`); assess
 * uses a saved value only where the tenant record and defaults set none (assess.routes.ts).
 */
export const PRECEDENCE_NOTE =
  'Plan variables: values from the Tenant Manifest (carried in the executable plan) always win. ' +
  'A variable saved here only fills gaps: assess and execute use it where no other value is set; translation does not read it.';

function PrecedenceNote() {
  return (
    <p className="path-hint" id="variablesPrecedenceNote" role="note">
      {PRECEDENCE_NOTE}
    </p>
  );
}

interface LoadPickerProps {
  files: readonly { name: string; path: string }[];
  onLoad: (path: string) => Promise<void>;
  onCancel: () => void;
}

/** Replaces the legacy prompt() file chooser of loadTenantFromFile (L945). */
function LoadPicker({ files, onLoad, onCancel }: LoadPickerProps) {
  const [choice, setChoice] = useState(files[0]?.path ?? '');
  return (
    <div className="spa-vars-load" id="loadConfigPicker" role="group" aria-labelledby="loadConfigLabel">
      <label id="loadConfigLabel" htmlFor="loadConfigSelect">
        Available configs
      </label>
      <select id="loadConfigSelect" value={choice} onChange={(event) => setChoice(event.target.value)}>
        {files.map((f) => (
          <option key={f.path} value={f.path}>
            {f.name}
          </option>
        ))}
      </select>
      <button type="button" className="btn btn-primary" id="loadConfigConfirm" disabled={!choice} onClick={() => void onLoad(choice)}>
        Load
      </button>
      <button type="button" className="btn btn-secondary" id="loadConfigCancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

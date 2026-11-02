// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-30: the AdminOps console on the kit, modelled on Stamper's SPA: the kit AppShell gives the
// header "CES Blue Heron Defense — AdminOps" and the theme toggle; the TenantBanner names the tenant
// and whether this server is routed to the simulator. The APPROVALS header button is the kit's and
// renders nothing while two-person approval is off. One screen, as the legacy page is one page.

import { useEffect } from 'react';
import { AppShell, ApprovalsButton, TenantBanner } from 'ces-ui-kit';
import { loadConsole, openApprovals, useAoStore } from './store/ao';
import { CommandList } from './screens/commands/CommandList';
import { RequestForm } from './screens/request/RequestForm';
import { EvidenceRows } from './screens/evidence/EvidenceRows';
import { ApprovalsDialog } from './screens/approvals/ApprovalsDialog';

export const AO_VERSION = 'v2.2.3';
export const NO_TENANT_LABEL = 'No tenant selected';

export default function App() {
  const tenant = useAoStore((s) => s.tenant);
  const tenants = useAoStore((s) => s.tenants);
  const routed = useAoStore((s) => s.stacksimModeActive);
  const twoPersonOn = useAoStore((s) => s.twoPersonOn);
  const pendingCount = useAoStore((s) => s.pendingCount);
  const loadError = useAoStore((s) => s.loadError);
  const kind = tenants.find((t) => t.slug === tenant)?.kind;

  useEffect(() => {
    void loadConsole();
  }, []);

  return (
    <AppShell
      product="AdminOps"
      version={AO_VERSION}
      headerControls={<ApprovalsButton pendingCount={pendingCount} onOpen={() => void openApprovals()} twoPersonApproval={twoPersonOn} />}
      banner={<TenantBanner tenant={tenant || NO_TENANT_LABEL} kind={kind} simulator={routed} />}
      footer={`Blue Heron Defense · CES ${AO_VERSION} · CUI`}
    >
      {loadError ? (
        <div className="ck-alert" role="alert">
          {loadError}
        </div>
      ) : null}
      <div className="ao-layout" data-two-person={twoPersonOn ? 'on' : 'off'}>
        <CommandList />
        <div className="ao-main">
          <RequestForm />
        </div>
      </div>
      <EvidenceRows />
      <ApprovalsDialog />
    </AppShell>
  );
}

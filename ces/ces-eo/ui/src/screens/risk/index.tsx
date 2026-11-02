// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Risk assessment (legacy page-risk-assessment). FIN-31 ported the register and the entry editor;
// FIN-31b ports the rest: the header (scope, methodology, review status and dates), the connection
// banner, and the three inner tabs: Current register (ingestion, annual review, filters, sorting,
// summary, full entry editor), History (snapshots, viewer, comparison) and Setup.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TabNav } from 'ces-ui-kit';
import { eoApi } from '../../api/eo';
import { useSession } from '../../store/session';
import { Notice, TenantRequired } from '../../components/common';
import { CurrentTab } from './CurrentTab';
import { HistoryTab } from './HistoryTab';
import { SetupTab } from './SetupTab';
import { reviewStatus } from './riskModel';

export { LEVELS, compositeRisk } from './riskModel';

const INNER_TABS = [
  { id: 'current', label: 'Current register', controls: 'eo-risk-panel' },
  { id: 'history', label: 'History', controls: 'eo-risk-panel' },
  { id: 'setup', label: 'Setup', controls: 'eo-risk-panel' },
];

function RiskBody({ tenant }: { tenant: string }) {
  const reg = useQuery({ queryKey: ['risk-register', tenant], queryFn: () => eoApi.riskRegister(tenant), retry: false });
  const cfg = useQuery({ queryKey: ['risk-config', tenant], queryFn: () => eoApi.riskConfig(tenant), retry: false });
  const connection = useSession((s) => s.connection);
  const [tab, setTab] = useState('current');
  const dates = [
    reg.data?.lastFullReviewDate ? `Last review: ${new Date(reg.data.lastFullReviewDate).toLocaleDateString()}` : null,
    reg.data?.nextReviewDue ? `Next due: ${new Date(reg.data.nextReviewDue).toLocaleDateString()}` : null,
  ].filter(Boolean).join(' | ');
  return (
    <>
      <Notice kind={connection === 'connected' ? 'success' : 'warn'} id="riskConnectionBanner">
        {connection === 'connected'
          ? 'Connected: live ingestion and tenant storage replication are available.'
          : 'Local-only mode: connect the tenant (Tenant and access screen) for live ingestion and blob replication.'}
      </Notice>
      <div className="eo-row" id="riskHeader">
        <span id="riskScopeStatement">{cfg.data ? cfg.data.scopeStatement || 'No scope statement configured.' : 'Loading scope...'}</span>
        <span className="badge badge-review" id="riskMethodologyBadge">{!cfg.data?.methodology || cfg.data.methodology === 'nist_sp_800_30_rev1' ? 'NIST SP 800-30 Rev. 1' : cfg.data.methodology}</span>
        <span className="badge badge-review" id="riskStatusBadge">{reviewStatus(reg.data?.nextReviewDue)}</span>
        <span className="eo-muted" id="riskReviewDates">{dates || 'No review recorded.'}</span>
      </div>
      {reg.isError ? <Notice kind="error">Failed to load the risk register.</Notice> : null}
      <TabNav label="Risk assessment sections" idPrefix="eo-rtab-" tabs={INNER_TABS} active={tab} onChange={setTab} />
      <div id="eo-risk-panel" role="tabpanel" aria-labelledby={`eo-rtab-${tab}`} className="eo-screen">
        {tab === 'current' ? <CurrentTab tenant={tenant} register={reg.data} /> : tab === 'history' ? <HistoryTab tenant={tenant} /> : <SetupTab tenant={tenant} />}
      </div>
    </>
  );
}

export default function RiskScreen() {
  return <div className="eo-screen"><TenantRequired>{(t) => <RiskBody tenant={t} />}</TenantRequired></div>;
}

// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-31b: the legacy dashboard "Control Compliance Matrix" (renderFamilyTable): one header row per
// family with MET / NOT MET counts that filter its control rows, and per control the practice, id,
// approach (automated / non-stack / excluded), status and SPRS impact (the weight from
// GET /api/sprs/weights, keyed by nist_ref). Read-only: it only displays the stored assessment.

import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { eoApi } from '../../api/eo';
import type { AssessmentControl } from '../../api/types';
import { StatusBadge } from '../../components/common';
import { FAMILIES, approachLabel } from '../../components/families';

type Filter = 'met' | 'not_met' | null;

/** Legacy sprsImpact: '0' when met or weightless, else '-<weight>'. */
export function sprsImpact(status: string, weight: number | undefined): string {
  if (status === 'met') return '0';
  return weight && weight > 0 ? `-${weight}` : '0';
}

export function ControlMatrix({ controls }: { controls: AssessmentControl[] }) {
  const weights = useQuery({ queryKey: ['sprs-weights'], queryFn: eoApi.sprsWeights, retry: false, staleTime: Infinity });
  const [filters, setFilters] = useState<Record<string, Filter>>({});
  const weightOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of weights.data ?? []) m.set(w.nist_ref, w.weight);
    return m;
  }, [weights.data]);

  const toggle = (fam: string, f: Exclude<Filter, null>) => setFilters((x) => ({ ...x, [fam]: x[fam] === f ? null : f }));

  return (
    <div className="eo-table-wrap">
      <table className="eo-table" id="familyTable">
        <caption className="eo-sr-only">Control compliance matrix by family</caption>
        <thead>
          <tr><th scope="col">Name</th><th scope="col">Control</th><th scope="col">Approach</th><th scope="col">MET</th><th scope="col">NOT MET</th><th scope="col">SPRS</th></tr>
        </thead>
        <tbody>
          {FAMILIES.map((fam) => {
            const rows = controls.filter((c) => c.control_id.startsWith(`${fam.abbr}.`));
            if (rows.length === 0) return null;
            const met = rows.filter((c) => c.status === 'met').length;
            const notMet = rows.filter((c) => c.status === 'not_met').length;
            const filter = filters[fam.abbr] ?? null;
            return (
              <Fragment key={fam.abbr}>
                <tr className="eo-family-row" data-family={fam.abbr}>
                  <th scope="row"><strong>{fam.name}</strong></th>
                  <td>{fam.abbr}</td>
                  <td />
                  <td>
                    <button type="button" className="eo-linkbtn" aria-pressed={filter === 'met'} aria-label={`${fam.name}: show only MET (${met})`}
                      onClick={() => toggle(fam.abbr, 'met')}>{met}</button>
                  </td>
                  <td>
                    <button type="button" className="eo-linkbtn" aria-pressed={filter === 'not_met'} aria-label={`${fam.name}: show only NOT MET (${notMet})`}
                      onClick={() => toggle(fam.abbr, 'not_met')}>{notMet}</button>
                  </td>
                  <td />
                </tr>
                {rows.filter((c) => !filter || c.status === filter).map((c) => {
                  const practice = c.practice ?? '';
                  return (
                    <tr key={c.control_id} data-control={c.control_id} data-status={c.status}>
                      <td title={practice}>{practice.length > 60 ? `${practice.slice(0, 57)}...` : practice}</td>
                      <td className="eo-mono">{c.control_id}</td>
                      <td>{approachLabel(c.classification)}</td>
                      <td colSpan={2}><StatusBadge status={c.status} /></td>
                      <td className="eo-mono">{sprsImpact(c.status, c.nist_ref ? weightOf.get(c.nist_ref) : undefined)}</td>
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-30: the cost panel for a recurring-cost op (FIN-13's legacy panel, L882-887 / L938-963).
// DP-1 (the cost acknowledgement, COST-GATE-SPEC §3.4) is enabled only against the cost notice of a
// dry run of this same op; DP-2 (§3.5) is the text typed at run time, "<op id> <monthly figure>".
// The server decides; this panel only collects. Module-specific, so it lives here, not in the kit.

import { useAoStore } from '../../store/ao';
import { costNoticeText, dp2Text, isRecurring } from '../../store/result';
import type { AoCommand } from '../../api';

export function CostPanel({ cmd }: { cmd: AoCommand }) {
  const notice = useAoStore((s) => s.costNotice);
  const ack = useAoStore((s) => s.costAck);
  const noOtherMeans = useAoStore((s) => s.noOtherMeans);
  const confirmCost = useAoStore((s) => s.confirmCost);
  if (!isRecurring(cmd)) return null;
  const valid = !!notice && notice.opId === cmd.id;
  const lastResort = !!cmd.cost_gate?.last_resort;

  return (
    <fieldset className="ao-cost" id="costGatePanel" data-testid="cost-gate-panel">
      <legend>Recurring cost (DP-1 and DP-2)</legend>
      <p id="costNoticeText" data-testid="cost-notice" aria-live="polite">
        {costNoticeText(cmd, notice)}
      </p>
      <label className="ao-check">
        <input
          type="checkbox"
          id="costAckCheck"
          data-testid="cost-ack"
          disabled={!valid}
          checked={valid && ack}
          onChange={(e) => useAoStore.setState({ costAck: e.target.checked })}
        />
        DP-1: I acknowledge this recurring monthly cost
      </label>
      {lastResort ? (
        <>
          <label htmlFor="costNoOtherMeans" className="ao-label">
            Last resort: why no other (free) means will do
          </label>
          <textarea
            id="costNoOtherMeans"
            data-testid="cost-no-other-means"
            rows={2}
            value={noOtherMeans}
            onChange={(e) => useAoStore.setState({ noOtherMeans: e.target.value })}
          />
        </>
      ) : null}
      <label htmlFor="confirmCostInput" className="ao-label">
        DP-2: type the op id and the monthly figure
      </label>
      <input
        type="text"
        id="confirmCostInput"
        data-testid="confirm-cost"
        autoComplete="off"
        placeholder={valid ? `DP-2: type ${dp2Text(notice!)}` : 'DP-2: type the op id and the monthly figure'}
        value={confirmCost}
        onChange={(e) => useAoStore.setState({ confirmCost: e.target.value })}
      />
    </fieldset>
  );
}

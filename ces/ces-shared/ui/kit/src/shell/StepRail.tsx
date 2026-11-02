// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/** Legacy rail states (`rail-node rail-<state>` in ces-stamper/public/index.html). */
export type StepState = 'locked' | 'ready' | 'running' | 'done' | 'failed';

export interface RailStep {
  id: string;
  label: string;
  state: StepState;
}

/** The legacy console's six workflow steps and their initial states (3-5 start locked). */
export const STAMPER_STEPS: readonly RailStep[] = [
  { id: 'tenant', label: 'Tenant', state: 'ready' },
  { id: 'configure', label: 'Configure', state: 'ready' },
  { id: 'assess', label: 'Assess', state: 'ready' },
  { id: 'translate', label: 'Translate', state: 'locked' },
  { id: 'execute', label: 'Execute', state: 'locked' },
  { id: 'evidence', label: 'Evidence', state: 'locked' },
];

export interface StepRailProps {
  steps: readonly RailStep[];
  /** When given, unlocked nodes render as buttons. */
  onSelect?: (id: string) => void;
  /** Node ids are `${idPrefix}${index}`; the legacy ids are railNode0-5. */
  idPrefix?: string;
  label?: string;
}

export function StepRail({ steps, onSelect, idPrefix = 'railNode', label = 'Workflow steps' }: StepRailProps) {
  return (
    <nav className="ck-rail" aria-label={label}>
      <ol className="ck-rail-list">
        {steps.map((step, index) => {
          const content = (
            <>
              <span className="ck-rail-circle" aria-hidden="true">
                {index + 1}
              </span>
              <span className="ck-rail-label">{step.label}</span>
              <span className="ck-sr-only">{`, step ${index + 1}, ${step.state}`}</span>
            </>
          );
          const common = {
            id: `${idPrefix}${index}`,
            className: `ck-rail-node ck-rail-${step.state}`,
            'data-step': step.id,
            'data-state': step.state,
            'aria-current': step.state === 'running' ? ('step' as const) : undefined,
          };
          return (
            <li key={step.id} className={index === 0 ? 'ck-rail-step ck-rail-step-first' : 'ck-rail-step'}>
              {index > 0 ? <span className="ck-rail-connector" aria-hidden="true" /> : null}
              {onSelect ? (
                <button
                  {...common}
                  type="button"
                  disabled={step.state === 'locked'}
                  onClick={() => onSelect(step.id)}
                >
                  {content}
                </button>
              ) : (
                <div {...common}>{content}</div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

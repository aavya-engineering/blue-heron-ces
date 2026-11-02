// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: ReactNode;
  /** Id of the panel this tab shows (sets aria-controls). */
  controls?: string;
}

export interface TabNavProps {
  tabs: readonly TabItem[];
  active: string;
  onChange: (id: string) => void;
  /** Accessible name of the tab list. */
  label: string;
  /** Tab button ids are `${idPrefix}${tab.id}`. */
  idPrefix?: string;
}

/** Legacy console tabs (`.console-tab`, Console / Terminal): mono caps, underline on the active tab. */
export function TabNav({ tabs, active, onChange, label, idPrefix = 'tab-' }: TabNavProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let target = -1;
    if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') target = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = tabs.length - 1;
    if (target < 0) return;
    event.preventDefault();
    refs.current[target]?.focus();
    onChange(tabs[target].id);
  }

  return (
    <div className="ck-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            id={`${idPrefix}${tab.id}`}
            type="button"
            role="tab"
            className={selected ? 'ck-tab ck-tab-active' : 'ck-tab'}
            data-tab={tab.id}
            aria-selected={selected}
            aria-controls={tab.controls}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

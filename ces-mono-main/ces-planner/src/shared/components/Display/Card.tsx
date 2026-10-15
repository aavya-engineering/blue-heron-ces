// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import React from 'react';
import clsx from 'clsx';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  headerAction?: React.ReactNode;
  footer?: React.ReactNode;
}

export function Card({ children, className, title, headerAction, footer }: CardProps) {
  return (
    // ComplianceOne card: flat, 1.5px slate border, sharp corners, Zilla Slab header.
    <div className={clsx('border-[1.5px] border-slate-200 overflow-hidden', !className?.includes('bg-') && 'bg-white', className)}>
      {title && (
        <div className="px-6 py-4 border-b-[1.5px] border-slate-200 flex items-center justify-between">
          <h3 className="font-serif text-lg font-semibold text-slate-900">{title}</h3>
          {headerAction}
        </div>
      )}
      <div className="px-6 py-4">{children}</div>
      {footer && <div className={clsx("px-6 py-4 border-t-[1.5px] border-slate-200", !className?.includes('bg-') && 'bg-slate-50')}>{footer}</div>}
    </div>
  );
}

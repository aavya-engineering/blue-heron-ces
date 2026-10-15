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

interface FormFieldProps {
  label: string;
  children: React.ReactNode;
  error?: string;
  required?: boolean;
  help?: string;
  className?: string;
}

export function FormField({ label, children, error, required, help, className }: FormFieldProps) {
  return (
    <div className={clsx('mb-4', className)}>
      {/* ComplianceOne label: uppercase, tracked, primary-toned. */}
      <label className="block text-xs font-semibold uppercase tracking-[0.5px] text-slate-700 mb-1">
        {label}
        {required && <span className="text-[#dc2626] ml-1">*</span>}
      </label>
      {children}
      {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
      {error && <p className="mt-1 text-xs text-[#dc2626]">{error}</p>}
    </div>
  );
}

// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { Card } from '@/shared/components/Display/Card';

interface ActionCardProps {
  title: string;
  description: string;
  buttonText: string;
  onAction: () => void;
  enabled: boolean;
  completed?: boolean;
  nextStep?: boolean;
  onEditRates?: () => void;
  statusText?: string;
  loading?: boolean;
  pickerLabel?: string;
  pickerOptions?: Array<{ id: number; label: string }>;
  pickerValue?: number | null;
  onPickerChange?: (id: number | null) => void;
}

export function ActionCard({
  title,
  description,
  buttonText,
  onAction,
  enabled,
  completed,
  nextStep,
  onEditRates,
  statusText,
  loading,
  pickerLabel,
  pickerOptions,
  pickerValue,
  onPickerChange,
}: ActionCardProps) {
  return (
    <Card
      title={title}
      className={
        completed
          ? 'bg-green-100'
          : nextStep
            ? 'bg-green-50'
            : !enabled
              ? 'bg-gray-200'
              : undefined
      }
      footer={
        <div className="flex gap-2">
          <button
            onClick={onAction}
            disabled={!enabled || loading}
            className={`flex-1 px-4 py-2 rounded-md font-medium ${
              enabled && !loading
                ? 'bg-primary-600 text-white hover:bg-primary-700'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            {completed ? 'Create New' : buttonText}
          </button>
          {onEditRates && (
            <button
              onClick={onEditRates}
              className="px-4 py-2 rounded-md font-medium border border-gray-300 text-gray-700 hover:bg-gray-50"
              title="Edit LOE Rates"
            >
              Edit LOE Rates
            </button>
          )}
        </div>
      }
    >
      <p className="text-sm text-gray-600">{description}</p>
      {pickerOptions && pickerOptions.length > 0 && onPickerChange && (
        <div className="mt-3">
          {pickerLabel && (
            <label className="block text-xs font-medium text-gray-500 mb-1">{pickerLabel}</label>
          )}
          <select
            value={pickerValue ?? ''}
            onChange={(e) => onPickerChange(e.target.value ? Number(e.target.value) : null)}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          >
            <option value="">Select...</option>
            {pickerOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {statusText && (
        <div className="flex items-center gap-2 mt-2 text-sm text-primary-700">
          {loading && (
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
          )}
          <span>{statusText}</span>
        </div>
      )}
      {!enabled && !statusText && !pickerOptions?.length && (
        <p className="text-xs text-gray-500 mt-2 italic">
          Complete previous steps to unlock this action.
        </p>
      )}
    </Card>
  );
}

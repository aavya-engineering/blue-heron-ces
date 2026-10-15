// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useEffect, useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { useLoeRateStore } from '../stores/loeRateStore';
import {
  DEFAULT_LOE_RATES,
  CANONICAL_TASK_TYPES,
  TASK_TYPE_LABELS,
  LOE_COLUMNS,
  type LoeRateConfig,
  type CanonicalTaskType,
  type TaskLoeRow,
} from '../types/loeRates';

interface LoeRateEditorProps {
  open: boolean;
  onClose: () => void;
}

export function LoeRateEditor({ open, onClose }: LoeRateEditorProps) {
  const { rates, setRates } = useLoeRateStore();
  const [draft, setDraft] = useState<LoeRateConfig>(() => structuredClone(rates));

  useEffect(() => {
    if (open) setDraft(structuredClone(rates));
  }, [open, rates]);

  const updateCell = (row: CanonicalTaskType, col: keyof TaskLoeRow, value: number) => {
    setDraft((prev) => ({
      ...prev,
      taskRates: {
        ...prev.taskRates,
        [row]: { ...prev.taskRates[row], [col]: value },
      },
    }));
  };

  const updateSeverity = (key: 'HIGH' | 'MEDIUM' | 'LOW', value: number) => {
    setDraft((prev) => ({
      ...prev,
      severityMultipliers: { ...prev.severityMultipliers, [key]: value },
    }));
  };

  const handleSave = () => {
    setRates(draft);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/30" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-4xl bg-white rounded-xl shadow-xl flex flex-col max-h-[90vh]">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <DialogTitle className="text-lg font-semibold text-gray-900">
              LOE Rate Table
            </DialogTitle>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            >
              &times;
            </button>
          </div>

          <div className="overflow-y-auto px-6 py-4 space-y-6">
            {/* ---- Main rate table ---- */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b-2 border-gray-300">
                    <th className="text-left py-2 pr-3 font-semibold text-gray-700">
                      Task Type
                    </th>
                    {LOE_COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        className="px-2 py-2 text-center font-semibold text-gray-700 whitespace-nowrap cursor-help"
                        title={col.tooltip}
                      >
                        {col.heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CANONICAL_TASK_TYPES.map((taskType, i) => (
                    <tr
                      key={taskType}
                      className={`border-b border-gray-200 ${i === 5 ? 'border-t-2 border-t-gray-400' : ''}`}
                    >
                      <td className="py-2 pr-3 font-medium text-gray-800 whitespace-nowrap">
                        {TASK_TYPE_LABELS[taskType]}
                      </td>
                      {LOE_COLUMNS.map((col) => (
                        <td key={col.key} className="px-1 py-1">
                          <input
                            type="number"
                            step="1"
                            min="0"
                            value={draft.taskRates[taskType][col.key]}
                            onChange={(e) =>
                              updateCell(taskType, col.key, parseFloat(e.target.value) || 0)
                            }
                            className="w-16 px-1.5 py-1 text-sm text-center border border-gray-300 rounded focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-gray-400">
                Hours per task. Severity multipliers scale one-time config columns.
              </p>
            </div>

            {/* ---- Severity multipliers + labor rate ---- */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {(['HIGH', 'MEDIUM', 'LOW'] as const).map((sev) => (
                <div key={sev}>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Severity: {sev}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={draft.severityMultipliers[sev]}
                    onChange={(e) => updateSeverity(sev, parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Labor Rate ($/hr)
                </label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={draft.laborRatePerHour}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      laborRatePerHour: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200">
            <button
              onClick={() => setDraft(structuredClone(DEFAULT_LOE_RATES))}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
            >
              Reset to Defaults
            </button>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 text-sm font-medium bg-primary-600 text-white rounded-md hover:bg-primary-700"
              >
                Save
              </button>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

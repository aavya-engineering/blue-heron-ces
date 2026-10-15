// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import clsx from 'clsx';
import { Badge } from '@/shared/components/Display/Badge';

interface WorkflowStep {
  id: string;
  name: string;
  description: string;
  completed: boolean;
  onAction?: () => void;
  actionLabel?: string;
  actionDisabled?: boolean;
}

interface WorkflowProgressProps {
  steps: WorkflowStep[];
}

export function WorkflowProgress({ steps }: WorkflowProgressProps) {
  return (
    <nav aria-label="Progress">
      <ol role="list" className="space-y-4">
        {steps.map((step, stepIdx) => (
          <li key={step.id} className="relative">
            <div className="flex items-start group">
              <div className="flex-shrink-0">
                <div
                  className={clsx(
                    'relative flex items-center justify-center h-10 w-10 rounded-full',
                    step.completed
                      ? 'bg-primary-600'
                      : stepIdx === steps.findIndex((s) => !s.completed)
                        ? 'border-2 border-primary-600 bg-white'
                        : 'border-2 border-gray-300 bg-white'
                  )}
                >
                  {step.completed ? (
                    <svg
                      className="h-6 w-6 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : (
                    <span
                      className={clsx(
                        'h-2.5 w-2.5 rounded-full',
                        stepIdx === steps.findIndex((s) => !s.completed)
                          ? 'bg-primary-600'
                          : 'bg-gray-300'
                      )}
                    />
                  )}
                </div>
                {stepIdx !== steps.length - 1 && (
                  <div
                    className={clsx(
                      'absolute top-10 left-5 -ml-px h-full w-0.5',
                      step.completed ? 'bg-primary-600' : 'bg-gray-300'
                    )}
                  />
                )}
              </div>
              <div className="ml-4 min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center">
                    <h3 className="text-sm font-medium text-gray-900">{step.name}</h3>
                    {step.completed && (
                      <Badge variant="success" size="sm">
                        Complete
                      </Badge>
                    )}
                  </div>
                  {step.onAction && (
                    <button
                      type="button"
                      onClick={step.onAction}
                      disabled={step.actionDisabled}
                      className={`px-3 py-1 rounded-md text-xs font-medium ${
                        step.actionDisabled
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-primary-600 text-white hover:bg-primary-700'
                      }`}
                    >
                      {step.actionLabel || 'Run'}
                    </button>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-1">{step.description}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </nav>
  );
}

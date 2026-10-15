// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { Card } from './Card';

interface ArtifactViewerModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  data: any;
}

export function ArtifactViewerModal({ open, onClose, title, data }: ArtifactViewerModalProps) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/30" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-4xl bg-white rounded-none shadow-xl flex flex-col max-h-[90vh]">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <DialogTitle className="text-lg font-semibold text-gray-900">{title}</DialogTitle>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            >
              &times;
            </button>
          </div>
          <div className="overflow-y-auto px-6 py-4 space-y-4">
            {data ? <ArtifactContent data={data} /> : <p className="text-gray-500">No data</p>}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

export function ArtifactContent({ data }: { data: any }) {
  // SI Baseline: render si_baseline sections
  if (data?.si_baseline) {
    const si = data.si_baseline;
    const sections = [
      'target',
      'assessment',
      'scope',
      'operations',
      'evidence',
      'dependencies',
      'risk_acceptance',
      'governance',
    ];
    return (
      <>
        {sections.map(
          (section) =>
            si[section] && (
              <Card key={section} title={formatFieldName(section)}>
                <FieldGrid data={si[section]} />
              </Card>
            )
        )}
        {data.ces && (
          <Card title="Metadata">
            <FieldGrid
              data={{
                artifact: data.ces.artifact,
                version: data.ces.version,
                generated_on: data.ces.generated_on,
                ...(data.ces.cesId && { cesId: data.ces.cesId }),
              }}
            />
          </Card>
        )}
      </>
    );
  }

  // RR Question Set: render metadata + questions
  if (data?.ces?.artifact === 'rr_question_set' || data?.questions) {
    return (
      <>
        {data.ces && (
          <Card title="Metadata">
            <FieldGrid
              data={{
                artifact: data.ces.artifact,
                version: data.ces.version,
                generated_on: data.ces.generated_on,
                ...(data.ces.cesId && { cesId: data.ces.cesId }),
              }}
            />
          </Card>
        )}
        {data.scenario && (
          <Card title="Scenario">
            <FieldGrid data={data.scenario} />
          </Card>
        )}
        {data.questions && Array.isArray(data.questions) && (
          <Card title={`Questions (${data.questions.length})`}>
            <div className="space-y-3">
              {data.questions.map((q: any, i: number) => (
                <div key={i} className="border border-gray-200 rounded-md p-3">
                  <div className="font-medium text-sm text-gray-900 mb-1">
                    {i + 1}. {q.question_text || q.question || q.id || `Question ${i + 1}`}
                  </div>
                  <FieldGrid
                    data={Object.fromEntries(
                      Object.entries(q).filter(
                        ([k]) => k !== 'question_text' && k !== 'question'
                      )
                    )}
                  />
                </div>
              ))}
            </div>
          </Card>
        )}
      </>
    );
  }

  // Tenant Config Profile: raw JSON (structured data not suited to FieldGrid)
  if (data?.ces?.artifact === 'tenant_config_profile' || data?.tenant_config) {
    return <pre className="text-xs text-gray-800 whitespace-pre-wrap p-4 font-mono">{JSON.stringify(data, null, 2)}</pre>;
  }

  // Generic fallback: render top-level sections
  if (typeof data === 'object' && data !== null) {
    return (
      <>
        {Object.entries(data).map(([key, value]) => {
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            return (
              <Card key={key} title={formatFieldName(key)}>
                <FieldGrid data={value as Record<string, unknown>} />
              </Card>
            );
          }
          return (
            <Card key={key} title={formatFieldName(key)}>
              <p className="text-sm text-gray-900">{formatValue(value)}</p>
            </Card>
          );
        })}
      </>
    );
  }

  return <pre className="text-sm whitespace-pre-wrap">{JSON.stringify(data, null, 2)}</pre>;
}

function FieldGrid({ data }: { data: Record<string, unknown> }) {
  return (
    <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {Object.entries(data).map(([key, value]) => (
        <div key={key}>
          <dt className="text-sm font-medium text-gray-500">{formatFieldName(key)}</dt>
          <dd className={`mt-1 text-sm text-gray-900 ${key === 'cesId' ? 'font-mono' : ''}`}>
            {formatValue(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function formatFieldName(key: string): string {
  return key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : 'None';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  const str = String(value);
  // Display cesId in monospace font
  if (str.startsWith('ces-')) {
    return str;
  }
  return str;
}

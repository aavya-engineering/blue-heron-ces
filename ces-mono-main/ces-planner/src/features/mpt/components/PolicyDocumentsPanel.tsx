// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState } from 'react';
import { Card } from '@/shared/components/Display/Card';
import { Badge } from '@/shared/components/Display/Badge';
import type { PolicyDocument } from '@/shared/types/artifacts';

interface PolicyDocumentsPanelProps {
  documents: PolicyDocument[];
  orgName?: string;
}

export function PolicyDocumentsPanel({ documents, orgName }: PolicyDocumentsPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (documents.length === 0) return null;

  const avgCompleteness = Math.round(
    documents.reduce((sum, d) => sum + d.completeness, 0) / documents.length,
  );

  const handleDownloadMarkdown = (doc: PolicyDocument) => {
    const blob = new Blob([doc.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.template_id.replace(/_/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadAll = () => {
    for (const doc of documents) {
      handleDownloadMarkdown(doc);
    }
  };

  const handleDownloadDocx = async (doc: PolicyDocument) => {
    try {
      const { exportPolicyToDocx } = await import('../services/policyDocxExporter');
      const { compilePolicyContext } = await import('../services/policyContextCompiler');
      // Build a minimal context for the DOCX exporter from the document itself
      // The org name is passed as a prop from the mission plan viewer
      const minimalCtx = compilePolicyContext({
        policyInputs: {
          ces: { artifact: 'policy_inputs_output', version: '1.0.0', generated_on: '', tool: 'policy_inputs', policy_bank_version: '' },
          organization: {
            legal_name: orgName || 'Organization',
            address: { street: '', city: '', state: '', zip: '' },
            org_type: 'other',
          },
          personnel: [],
          odps: {},
          governance: { policy_effective_date: '', review_cycle_months: 12, fiscal_year_start_month: 1 },
        },
      });
      const renderedDoc = { ...doc, domain: '', nist_controls: [] as string[] };
      const blob = await exportPolicyToDocx(renderedDoc, minimalCtx);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${doc.template_id.replace(/_/g, '-')}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('DOCX export failed:', err);
    }
  };

  return (
    <Card
      title={`Policy Documents (${documents.length})`}
      headerAction={
        <div className="flex items-center gap-2">
          <Badge variant={avgCompleteness >= 80 ? 'success' : avgCompleteness >= 50 ? 'warning' : 'error'}>
            {avgCompleteness}% complete
          </Badge>
          <button
            onClick={handleDownloadAll}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
          >
            Download All (MD)
          </button>
        </div>
      }
    >
      <div className="space-y-2">
        {documents.map((doc) => (
          <div key={doc.template_id} className="border border-gray-200 rounded-lg">
            <div
              className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50"
              onClick={() => setExpandedId(expandedId === doc.template_id ? null : doc.template_id)}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900">{doc.title}</span>
                <Badge
                  variant={
                    doc.completeness >= 80 ? 'success' : doc.completeness >= 50 ? 'warning' : 'error'
                  }
                >
                  {doc.completeness}%
                </Badge>
              </div>
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => handleDownloadMarkdown(doc)}
                  className="px-2 py-1 text-xs font-medium text-blue-700 border border-blue-300 rounded hover:bg-blue-50"
                >
                  MD
                </button>
                <button
                  onClick={() => handleDownloadDocx(doc)}
                  className="px-2 py-1 text-xs font-medium text-green-700 border border-green-300 rounded hover:bg-green-50"
                >
                  DOCX
                </button>
                <span className="text-xs text-gray-400 ml-2">
                  {expandedId === doc.template_id ? '\u25B2' : '\u25BC'}
                </span>
              </div>
            </div>
            {expandedId === doc.template_id && (
              <div className="border-t border-gray-200 p-3 bg-gray-50">
                <pre className="text-xs text-gray-700 whitespace-pre-wrap max-h-96 overflow-auto font-mono">
                  {doc.markdown}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

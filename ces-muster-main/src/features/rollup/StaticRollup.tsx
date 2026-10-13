// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import { useState } from 'react';
import Ajv from 'ajv';
import type { StatusPayload } from '@/features/export/statusPayloadService';
import schema from '../../../public/schemas/status-payload.schema.json';

const validate = new Ajv({ strict: true }).compile(schema);

interface RagRow {
  name: string;
  score: number;
  on_prem_ot: string;
  rag: 'green' | 'amber' | 'red';
  fact_count: number;
  total_timing_ms: number;
}

function ragColor(score: number): 'green' | 'amber' | 'red' {
  if (score >= 70) return 'green';
  if (score >= 40) return 'amber';
  return 'red';
}

const RAG_BADGE: Record<string, string> = {
  green: 'badge badge-compliant',
  amber: 'badge badge-risk',
  red: 'badge badge-violation',
};

export default function StaticRollup() {
  const [rows, setRows] = useState<RagRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const newRows: RagRow[] = [];
    const newErrors: string[] = [];

    for (const file of files) {
      try {
        const text = await file.text();
        const payload = JSON.parse(text) as StatusPayload;
        if (!validate(payload)) {
          newErrors.push(`${file.name}: schema validation failed — ${validate.errors?.[0]?.message ?? 'unknown'}`);
          continue;
        }
        newRows.push({
          name: payload.party.name,
          score: payload.posture_summary.conservative_score,
          on_prem_ot: payload.on_prem_ot,
          rag: ragColor(payload.posture_summary.conservative_score),
          fact_count: payload.interview_facts.length,
          total_timing_ms: payload.timing_segments.reduce((acc, s) => acc + (s.duration_ms ?? 0), 0),
        });
      } catch {
        newErrors.push(`${file.name}: invalid JSON`);
      }
    }

    setRows((prev) => [...prev, ...newRows]);
    setErrors((prev) => [...prev, ...newErrors]);
    e.target.value = '';
  };

  const exportCsv = () => {
    const header = 'Party Name,RAG,Score,On-Prem/OT\n';
    const body = rows
      .map((r) => `"${r.name}",${r.rag},${r.score},${r.on_prem_ot}`)
      .join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pending-subs-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page">
      <div className="ces-titleblock" style={{ marginBottom: 12 }}>
        <h2 className="tb-title" style={{ margin: 0 }}>Subcontractor Rollup</h2>
        <span className="tb-designator">RAG BOARD</span>
      </div>
      <p style={{ color: 'var(--co-text-muted)' }}>
        Upload one or more StatusPayload JSON files to build the RAG board.
      </p>

      <input
        type="file"
        accept=".json"
        multiple
        onChange={handleFiles}
        style={{ marginBottom: 16 }}
      />

      {errors.length > 0 && (
        <ul className="form-error" style={{ marginBottom: 16 }}>
          {errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}

      {rows.length > 0 && (
        <>
          <table className="data-table">
            <thead>
              <tr>
                {['Party Name', 'Lifecycle State', 'RAG Readiness', 'Score', 'On-Prem/OT'].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td>{row.name}</td>
                  <td>Self-Assessed</td>
                  <td>
                    <span className={RAG_BADGE[row.rag]} style={{ fontWeight: 600 }}>
                      {row.rag.toUpperCase()}
                    </span>
                    {row.on_prem_ot === 'yes' && (
                      <span style={{ marginLeft: 8, color: 'var(--co-violation)', fontSize: 12 }}>
                        ⚑ OT
                      </span>
                    )}
                  </td>
                  <td>{row.score}%</td>
                  <td>{row.on_prem_ot}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="panel" style={{ margin: '16px 0', padding: 16 }}>
            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
              <span>
                <strong>Total subs:</strong>{' '}
                <span
                  style={{
                    color: rows.length >= 5 ? 'var(--co-compliant)' : undefined,
                    fontWeight: rows.length >= 5 ? 600 : undefined,
                  }}
                >
                  {rows.length} / 5 subs
                </span>
              </span>
              <span>
                <strong>Total facts:</strong> {rows.reduce((a, r) => a + r.fact_count, 0)}
              </span>
              <span>
                <strong>Avg session time:</strong>{' '}
                {(rows.reduce((a, r) => a + r.total_timing_ms, 0) / rows.length / 60000).toFixed(1)} min
              </span>
              <span>
                <strong>On-prem/OT share:</strong>{' '}
                {(() => {
                  const onPremCount = rows.filter((r) => r.on_prem_ot === 'yes').length;
                  const pct = Math.round((onPremCount / rows.length) * 100);
                  return `${onPremCount} of ${rows.length} (${pct}%)`;
                })()}
              </span>
            </div>
          </div>

          <button className="btn btn-primary" onClick={exportCsv}>Export Pending Subs CSV</button>
        </>
      )}
    </div>
  );
}

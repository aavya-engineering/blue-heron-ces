// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// DerivedValueTooltip.tsx — MG-25: the "why was this inferred" tooltip on a
// derived-answer row (SI, TCP and boundary nodes). It shows the value, its
// provenance and source (e.g. derived:si:discovery:graph:deviceConfigurations,
// auto_detected from graph:deviceConfigurations), the node's guidance from the
// copied help files (TCP / CUI boundary) and the glossary terms in its prompt.
// Opens on hover and on keyboard focus; the content also rides in the trigger's
// title for a plain hover.
import { useState } from 'react';
import { helpForNode, type DerivedNodeKind, type HelpIndex } from '@/features/interview/derivedAnswerHelp';
import { GlossaryText } from './GlossaryText';

export interface DerivedValueTooltipProps {
  nodeId: string;
  kind: DerivedNodeKind;
  /** The node's prompt (glossary terms are looked up in it). */
  prompt: string;
  /** The inferred value shown on the row. */
  value: string;
  /** Fact provenance (auto_detected, derived:si:…, archetype:…, cui-bank:recommended …). */
  provenance: string;
  /** Where the value came from (e.g. graph:deviceConfigurations), when known. */
  source?: string;
  help: HelpIndex | null;
}

export function DerivedValueTooltip(p: DerivedValueTooltipProps) {
  const [open, setOpen] = useState(false);
  const { guidance, terms } = helpForNode(p.nodeId, p.kind, p.prompt, p.help);
  const lines = [
    `Inferred value: ${p.value}`,
    `Provenance: ${p.provenance}`,
    ...(p.source ? [`Source: ${p.source}`] : []),
    ...(guidance?.description ? [guidance.description] : []),
    ...(guidance?.why_it_matters ? [`Why it matters: ${guidance.why_it_matters}`] : []),
    ...terms.map((t) => `${t.term}: ${t.definition}`),
  ];
  const tipId = `derived-help-tip-${p.nodeId}`;
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="btn-secondary"
        data-testid={`derived-help-${p.nodeId}`}
        data-kind={p.kind}
        aria-describedby={tipId}
        aria-label={`Why ${p.nodeId} was inferred`}
        title={lines.join('\n')}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{ marginLeft: 4, padding: '0 6px', cursor: 'help' }}
      >
        ?
      </button>
      <span
        role="tooltip"
        id={tipId}
        data-testid={tipId}
        hidden={!open}
        style={{
          position: 'absolute',
          zIndex: 50,
          left: 0,
          top: '100%',
          width: 320,
          padding: 8,
          background: 'var(--ces-surface, #fff)',
          border: '1px solid currentColor',
          whiteSpace: 'normal',
        }}
      >
        <span data-testid={`${tipId}-value`} style={{ display: 'block' }}>
          Inferred value: <strong>{p.value}</strong>
        </span>
        <span data-testid={`${tipId}-provenance`} style={{ display: 'block' }}>
          Provenance: {p.provenance}
          {p.source ? ` (source: ${p.source})` : ''}
        </span>
        <span data-testid={`${tipId}-prompt`} style={{ display: 'block' }}>
          <GlossaryText text={p.prompt} glossary={p.help?.glossary ?? []} />
        </span>
        {guidance?.description && (
          <span data-testid={`${tipId}-guidance`} style={{ display: 'block' }}>
            {guidance.description}
            {guidance.why_it_matters ? ` Why it matters: ${guidance.why_it_matters}` : ''}
          </span>
        )}
        {terms.map((t) => (
          <span key={t.term} data-testid={`${tipId}-term`} style={{ display: 'block' }}>
            <strong>{t.term}</strong>: {t.definition}
          </span>
        ))}
      </span>
    </span>
  );
}

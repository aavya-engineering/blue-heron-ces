// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState, useRef, useCallback, useEffect } from 'react';
import { Badge } from '@/shared/components/Display/Badge';
import { useRequirementDetails } from '../hooks/useRequirementDetails';

const LEVEL_COLORS: Record<string, string> = {
  L1: 'bg-green-100 text-green-800 border-green-300',
  L2: 'bg-amber-100 text-amber-800 border-amber-300',
  L3: 'bg-red-100 text-red-800 border-red-300',
};

const METHOD_ICONS: Record<string, string> = {
  examine: '📄',
  interview: '💬',
  test: '🧪',
};

// Cascade offset so multiple panels don't stack exactly on top of each other
const CASCADE_OFFSET = 30;

interface RequirementDetailsPanelProps {
  requirementId: string;
  index: number;
  zIndex: number;
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
}

export function RequirementDetailsPanel({
  requirementId,
  index,
  zIndex,
  onClose,
  onFocus,
}: RequirementDetailsPanelProps) {
  const { details, loading, error } = useRequirementDetails(requirementId);

  // Dragging state
  const [position, setPosition] = useState({
    x: 80 + index * CASCADE_OFFSET,
    y: 40 + index * CASCADE_OFFSET,
  });
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only drag from the header bar
      if ((e.target as HTMLElement).closest('button')) return;
      onFocus(requirementId);
      dragging.current = true;
      dragOffset.current = { x: e.clientX - position.x, y: e.clientY - position.y };
      e.preventDefault();
    },
    [position, requirementId, onFocus]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setPosition({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      });
    };
    const handleMouseUp = () => {
      dragging.current = false;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <div
      ref={panelRef}
      onMouseDown={() => onFocus(requirementId)}
      className="fixed flex flex-col bg-white rounded-xl shadow-2xl border border-gray-300 overflow-hidden"
      style={{
        left: position.x,
        top: position.y,
        width: 720,
        maxHeight: 'calc(100vh - 80px)',
        zIndex,
      }}
    >
      {/* Draggable header */}
      <div
        onMouseDown={handleMouseDown}
        className="flex-shrink-0 border-b border-gray-200 bg-gray-50 px-6 py-4 cursor-move select-none"
      >
        {loading && (
          <div className="flex items-center gap-3">
            <div className="h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-500">Loading {requirementId}...</span>
          </div>
        )}
        {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
        {details && (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-base font-mono font-bold text-gray-900">
                  {details.requirement.requirement_id}
                </span>
                <span
                  className={`px-2 py-0.5 text-xs font-bold rounded-none border ${LEVEL_COLORS[details.requirement.level] || 'bg-gray-100 text-gray-700'}`}
                >
                  {details.requirement.level}
                </span>
                <Badge variant="info" size="sm">
                  {details.requirement.domain}
                </Badge>
              </div>
              <h2 className="text-sm font-semibold font-serif text-gray-900 leading-snug truncate">
                {details.requirement.title}
              </h2>
            </div>
            <button
              onClick={() => onClose(requirementId)}
              className="flex-shrink-0 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
              aria-label="Close"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        )}
        {!details && !loading && !error && (
          <div className="flex items-center justify-between">
            <span className="text-sm font-mono text-gray-700">{requirementId}</span>
            <button
              onClick={() => onClose(requirementId)}
              className="flex-shrink-0 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
              aria-label="Close"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Scrollable body */}
      {details && (
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Requirement Text */}
          <Section title="Requirement Text">
            <p className="text-sm text-gray-800 leading-relaxed">
              {details.requirement.requirement_text}
            </p>
          </Section>

          {/* References */}
          {details.requirement.references && (
            <Section title="References">
              <div className="grid grid-cols-2 gap-2">
                <RefItem
                  label="CMMC Practice"
                  value={details.requirement.references.cmmc_practice_id}
                />
                <RefItem
                  label="NIST 800-171"
                  value={details.requirement.references.nist_800_171_id}
                />
                {details.requirement.references.far_clause_52_204_21_id && (
                  <RefItem
                    label="FAR 52.204-21"
                    value={details.requirement.references.far_clause_52_204_21_id}
                  />
                )}
                {details.requirement.references.other?.map((ref, i) => (
                  <RefItem key={i} label="Other" value={ref} />
                ))}
              </div>
            </Section>
          )}

          {/* Advisor Notes */}
          {details.requirement.ui_help && (
            <Section title="Advisor Notes">
              <div className="space-y-2">
                {details.requirement.ui_help.why_it_matters && (
                  <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg">
                    <h5 className="text-xs font-semibold text-blue-900 mb-1">Why It Matters</h5>
                    <p className="text-xs text-blue-800">
                      {details.requirement.ui_help.why_it_matters}
                    </p>
                  </div>
                )}
                {details.requirement.ui_help.attainment_impact && (
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                    <h5 className="text-xs font-semibold text-amber-900 mb-1">
                      Attainment Impact
                    </h5>
                    <p className="text-xs text-amber-800">
                      {details.requirement.ui_help.attainment_impact}
                    </p>
                  </div>
                )}
                {details.requirement.ui_help.advisor_description && (
                  <div className="p-2.5 bg-green-50 border border-green-200 rounded-lg">
                    <h5 className="text-xs font-semibold text-green-900 mb-1">Advisor Guidance</h5>
                    <p className="text-xs text-green-800">
                      {details.requirement.ui_help.advisor_description}
                    </p>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Assessment Objectives */}
          {details.requirement.assessment_objectives?.length > 0 && (
            <Section title="Assessment Objectives">
              <div className="space-y-3">
                {details.requirement.assessment_objectives.map((obj) => (
                  <div
                    key={obj.id}
                    className="p-3 border border-gray-200 rounded-lg bg-gray-50"
                  >
                    <div className="flex items-start gap-2 mb-2">
                      <span className="flex-shrink-0 px-1.5 py-0.5 bg-primary-100 text-primary-700 text-xs font-mono rounded">
                        {obj.id}
                      </span>
                      <p className="text-xs text-gray-800">{obj.text}</p>
                    </div>
                    <div className="flex flex-wrap gap-3 mt-2">
                      {obj.methods?.length > 0 && (
                        <div>
                          <span className="text-xs font-medium text-gray-500 block mb-1">
                            Methods
                          </span>
                          <div className="flex gap-1">
                            {obj.methods.map((m) => (
                              <span
                                key={m}
                                className="px-1.5 py-0.5 bg-primary-100 text-primary-800 text-xs rounded-none"
                              >
                                {METHOD_ICONS[m] || '📋'} {m}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {obj.evidence_archetypes?.length > 0 && (
                        <div>
                          <span className="text-xs font-medium text-gray-500 block mb-1">
                            Evidence Archetypes
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {obj.evidence_archetypes.map((id) => {
                              const arch = details.evidenceArchetypes.get(id);
                              return (
                                <span
                                  key={id}
                                  className="px-1.5 py-0.5 bg-primary-100 text-primary-800 text-xs rounded-none"
                                  title={arch?.description}
                                >
                                  {arch?.name || id}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Evidence Requirements */}
          {details.requirement.evidence_minimum && (
            <Section title="Evidence Requirements">
              <div className="grid grid-cols-2 gap-3">
                {details.requirement.evidence_minimum.must_have?.length > 0 && (
                  <div className="p-3 border-2 border-green-200 rounded-lg bg-green-50">
                    <h5 className="text-xs font-bold text-green-900 mb-2 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                      Must Have
                    </h5>
                    <ul className="space-y-1.5">
                      {details.requirement.evidence_minimum.must_have.map((id) => {
                        const arch = details.evidenceArchetypes.get(id);
                        return (
                          <li key={id} className="text-xs">
                            <span className="font-medium text-green-800">
                              {arch?.name || id}
                            </span>
                            {arch?.description && (
                              <p className="text-xs text-green-700 mt-0.5">{arch.description}</p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {details.requirement.evidence_minimum.nice_to_have?.length > 0 && (
                  <div className="p-3 border border-gray-200 rounded-lg bg-gray-50">
                    <h5 className="text-xs font-bold text-gray-700 mb-2 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full" />
                      Nice to Have
                    </h5>
                    <ul className="space-y-1.5">
                      {details.requirement.evidence_minimum.nice_to_have.map((id) => {
                        const arch = details.evidenceArchetypes.get(id);
                        return (
                          <li key={id} className="text-xs">
                            <span className="font-medium text-gray-800">
                              {arch?.name || id}
                            </span>
                            {arch?.description && (
                              <p className="text-xs text-gray-600 mt-0.5">{arch.description}</p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Assessor Approach */}
          {details.assessorApproach && (
            <Section title="Assessor Approach">
              <div className="space-y-3">
                <p className="text-xs text-gray-800">
                  {details.assessorApproach.assessment_procedure}
                </p>
                {details.assessorApproach.what_to_look_for?.length > 0 && (
                  <div>
                    <h5 className="text-xs font-semibold text-gray-700 mb-1">
                      What Assessors Look For
                    </h5>
                    <ul className="list-disc list-inside space-y-0.5">
                      {details.assessorApproach.what_to_look_for.map((item, i) => (
                        <li key={i} className="text-xs text-gray-700">{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {details.assessorApproach.common_deficiencies?.length > 0 && (
                  <div>
                    <h5 className="text-xs font-semibold text-red-700 mb-1">
                      Common Deficiencies
                    </h5>
                    <ul className="list-disc list-inside space-y-0.5">
                      {details.assessorApproach.common_deficiencies.map((item, i) => (
                        <li key={i} className="text-xs text-red-700">{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {details.assessorApproach.recommended_evidence?.length > 0 && (
                  <div>
                    <h5 className="text-xs font-semibold text-gray-700 mb-1">
                      Recommended Evidence
                    </h5>
                    <ul className="list-disc list-inside space-y-0.5">
                      {details.assessorApproach.recommended_evidence.map((item, i) => (
                        <li key={i} className="text-xs text-gray-700">{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Evidence Matrix */}
          {details.evidenceMatrix && (
            <Section title="Evidence Matrix">
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs text-gray-600">
                    Minimum evidence items:{' '}
                    <strong className="text-gray-900">
                      {details.evidenceMatrix.minimum_count}
                    </strong>
                  </span>
                </div>
                {details.evidenceMatrix.evidence_archetype_ids?.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-gray-500 block mb-1">
                      Satisfying Archetypes
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {details.evidenceMatrix.evidence_archetype_ids.map((id) => {
                        const arch = details.evidenceArchetypes.get(id);
                        return (
                          <span
                            key={id}
                            className="px-1.5 py-0.5 bg-primary-100 text-primary-800 text-xs rounded-none"
                            title={arch?.description}
                          >
                            {arch?.name || id}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
                {details.evidenceMatrix.sufficiency_notes && (
                  <p className="text-xs text-gray-600 mt-2 italic">
                    {details.evidenceMatrix.sufficiency_notes}
                  </p>
                )}
              </div>
            </Section>
          )}

          {/* Design for Assessment */}
          {details.requirement.design_for_assessment?.length > 0 && (
            <Section title="Design for Assessment">
              <div className="space-y-2">
                {details.requirement.design_for_assessment.map((d) => (
                  <div key={d.id} className="p-3 border border-gray-200 rounded-lg">
                    <h5 className="text-xs font-semibold text-gray-900 mb-1.5">{d.title}</h5>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-xs font-medium text-gray-500 block mb-0.5">
                          Constraint
                        </span>
                        <p className="text-gray-700">{d.constraint}</p>
                      </div>
                      <div>
                        <span className="text-xs font-medium text-gray-500 block mb-0.5">
                          Verification
                        </span>
                        <p className="text-gray-700">{d.verification}</p>
                      </div>
                    </div>
                    {d.evidence_archetypes?.length > 0 && (
                      <div className="mt-2">
                        <span className="text-xs font-medium text-gray-500 block mb-1">
                          Evidence Archetypes
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {d.evidence_archetypes.map((id) => {
                            const arch = details.evidenceArchetypes.get(id);
                            return (
                              <span
                                key={id}
                                className="px-1.5 py-0.5 bg-primary-100 text-primary-800 text-xs rounded-none"
                                title={arch?.description}
                              >
                                {arch?.name || id}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Scoping Impacts */}
          {details.requirement.scoping_impacts && details.requirement.scoping_impacts.length > 0 && (
            <Section title="Scoping Impacts">
              <div className="space-y-2">
                {details.requirement.scoping_impacts.map((s) => (
                  <div key={s.id} className="p-3 border border-orange-200 bg-orange-50 rounded-lg">
                    <p className="text-xs text-gray-800 mb-1.5">{s.summary}</p>
                    {s.affected_scoping_categories?.length > 0 && (
                      <div className="mb-1.5">
                        <span className="text-xs font-medium text-gray-500 block mb-1">
                          Affected Scoping Categories
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {s.affected_scoping_categories.map((cat) => (
                            <Badge key={cat} variant="warning" size="sm">
                              {cat}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {s.design_implications?.length > 0 && (
                      <div>
                        <span className="text-xs font-medium text-gray-500 block mb-1">
                          Design Implications
                        </span>
                        <ul className="list-disc list-inside space-y-0.5">
                          {s.design_implications.map((impl, i) => (
                            <li key={i} className="text-xs text-gray-700">{impl}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Implementation Patterns */}
          {details.implementationPatterns.length > 0 && (
            <Section title="Implementation Patterns">
              <div className="space-y-3">
                {details.implementationPatterns.map((pattern) => (
                  <div
                    key={pattern.pattern_id}
                    className="p-3 border border-primary-200 bg-primary-50 rounded-lg"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-1.5 py-0.5 bg-primary-200 text-primary-800 text-xs font-mono rounded">
                        {pattern.pattern_id}
                      </span>
                      <h5 className="text-xs font-semibold text-primary-900">
                        {pattern.pattern_name}
                      </h5>
                    </div>
                    {pattern.actions?.length > 0 && (
                      <ol className="space-y-1.5">
                        {pattern.actions.map((action, i) => (
                          <li key={action.id} className="flex gap-2">
                            <span className="flex-shrink-0 w-5 h-5 bg-primary-200 text-primary-800 rounded-full flex items-center justify-center text-xs font-medium">
                              {i + 1}
                            </span>
                            <div className="flex-1">
                              <p className="text-xs text-gray-800">{action.action}</p>
                              <span className="text-xs text-primary-600">{action.action_type}</span>
                              {action.evidence_outputs?.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-0.5">
                                  {action.evidence_outputs.map((eo) => (
                                    <span
                                      key={eo}
                                      className="px-1 py-0.5 bg-primary-100 text-primary-700 text-xs rounded"
                                    >
                                      {eo}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Implementation Approach */}
          {(details.capability || details.vendorPlaybookEntries.length > 0) && (
            <Section title="Implementation Approach">
              <div className="space-y-4">
                {/* Capability context */}
                {details.capability && (
                  <div className="p-3 border border-blue-200 bg-blue-50 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-1.5 py-0.5 bg-blue-200 text-blue-800 text-xs font-bold rounded">
                        {details.capability.abbreviation}
                      </span>
                      <h5 className="text-xs font-semibold text-blue-900">
                        {details.capability.name}
                      </h5>
                    </div>
                    <p className="text-xs text-blue-800 mb-2">
                      {details.capability.description}
                    </p>
                    {details.capability.vendor_stack_components &&
                      Object.keys(details.capability.vendor_stack_components).length > 0 && (
                        <div>
                          <span className="text-xs font-medium text-blue-700 block mb-1">
                            Vendor Stack
                          </span>
                          <div className="space-y-1">
                            {Object.entries(details.capability.vendor_stack_components).map(
                              ([vendor, components]) => (
                                <div key={vendor} className="flex items-start gap-2">
                                  <span className="text-xs font-medium text-blue-900 capitalize whitespace-nowrap">
                                    {vendor.replace(/_/g, ' ')}:
                                  </span>
                                  <div className="flex flex-wrap gap-1">
                                    {components.map((c) => (
                                      <span
                                        key={c}
                                        className="px-1.5 py-0.5 bg-blue-100 text-blue-800 text-xs rounded"
                                      >
                                        {c}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      )}
                  </div>
                )}

                {/* Vendor playbook (M365) */}
                {details.vendorPlaybookEntries.length > 0 && (
                  <div className="space-y-2">
                    <h5 className="text-xs font-bold text-gray-700">
                      Microsoft 365 Playbook
                    </h5>
                    {details.vendorPlaybookEntries.map((entry) => (
                      <div
                        key={entry.action_id}
                        className="p-3 border border-blue-200 bg-blue-50 rounded-lg"
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="px-1.5 py-0.5 bg-blue-200 text-blue-800 text-xs font-mono rounded">
                            {entry.action_id}
                          </span>
                          <span className="text-xs font-semibold text-blue-900">
                            {entry.m365_service}
                          </span>
                        </div>
                        <p className="text-xs text-gray-800 mb-2">{entry.implementation}</p>
                        {entry.portal_path && (
                          <p className="text-xs text-blue-700 mb-1.5">
                            <span className="font-medium">Portal:</span> {entry.portal_path}
                          </p>
                        )}
                        {entry.powershell && entry.powershell.length > 0 && (
                          <div className="mb-1.5">
                            <span className="text-xs font-medium text-gray-500 block mb-1">
                              PowerShell
                            </span>
                            <div className="bg-gray-900 rounded p-2 overflow-x-auto">
                              {entry.powershell.map((cmd, i) => (
                                <code
                                  key={i}
                                  className="block text-xs text-green-400 font-mono whitespace-pre"
                                >
                                  {cmd}
                                </code>
                              ))}
                            </div>
                          </div>
                        )}
                        {entry.evidence_commands?.length > 0 && (
                          <div>
                            <span className="text-xs font-medium text-gray-500 block mb-1">
                              Evidence Collection
                            </span>
                            <div className="bg-gray-900 rounded p-2 overflow-x-auto">
                              {entry.evidence_commands.map((cmd, i) => (
                                <code
                                  key={i}
                                  className="block text-xs text-amber-400 font-mono whitespace-pre"
                                >
                                  {cmd}
                                </code>
                              ))}
                            </div>
                          </div>
                        )}
                        {entry.notes && (
                          <p className="text-xs text-gray-500 italic mt-1.5">{entry.notes}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Operationalization Notes */}
          {details.requirement.operationalization_notes && (
            <Section title="Operationalization Notes">
              <p className="text-xs text-gray-800 leading-relaxed">
                {details.requirement.operationalization_notes}
              </p>
            </Section>
          )}

          {/* Common Pitfalls */}
          {details.requirement.common_pitfalls && details.requirement.common_pitfalls.length > 0 && (
            <Section title="Common Pitfalls">
              <ul className="space-y-1.5">
                {details.requirement.common_pitfalls.map((pitfall, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs">
                    <span className="flex-shrink-0 text-red-500 mt-0.5">&#x26A0;</span>
                    <span className="text-gray-700">{pitfall}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-bold font-serif text-gray-900 mb-2 pb-1.5 border-b border-gray-200">
        {title}
      </h3>
      {children}
    </section>
  );
}

function RefItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-1.5 bg-gray-50 rounded border border-gray-200">
      <span className="text-xs font-medium text-gray-500 block">{label}</span>
      <span className="text-xs font-mono text-gray-900">{value}</span>
    </div>
  );
}

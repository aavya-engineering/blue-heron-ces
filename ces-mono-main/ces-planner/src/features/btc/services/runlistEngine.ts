// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type {
  ActivationRule,
  BTCSectionDef,
  BTCQuestionDef,
  RunlistEntry,
  Runlist,
} from '../types';
import type { BTCRiskFlag, BTCDecisionLogEntry } from '@/shared/types/artifacts';

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function evaluateCondition(
  condition: { source: string; path: string; op: string; value: string | string[] },
  siOutputs: Record<string, unknown>,
  cuiOutputs: Record<string, unknown>
): boolean {
  const sourceObj = condition.source === 'si' ? siOutputs : cuiOutputs;
  const actual = resolvePath(sourceObj, condition.path);

  if (actual === undefined || actual === null) return false;

  if (condition.op === 'eq') {
    return String(actual) === String(condition.value);
  }

  if (condition.op === 'in') {
    const values = Array.isArray(condition.value) ? condition.value : [condition.value];
    return values.some((v) => String(actual) === String(v));
  }

  return false;
}

export function buildRunlist(
  siOutputs: Record<string, unknown>,
  cuiOutputs: Record<string, unknown>,
  btcBank: { sections: BTCSectionDef[]; virtualQuestions: BTCQuestionDef[] },
  rules: ActivationRule[]
): Runlist {
  // Build question-to-section map and virtual question lookup
  const virtualMap = new Map<string, BTCQuestionDef>();
  for (const vq of btcBank.virtualQuestions) {
    virtualMap.set(vq.id, vq);
  }

  // Initialize all bank questions as runlist entries
  const entryMap = new Map<string, RunlistEntry>();
  const sectionQuestionIds = new Map<string, string[]>();

  for (const section of btcBank.sections) {
    const qids: string[] = [];
    for (const q of section.questions) {
      const hasEvidenceRequired = q.validations.some((v) => v.rule === 'evidence_required');
      const evidenceValidation = q.validations.find((v) => v.rule === 'evidence_required');

      entryMap.set(q.id, {
        question_id: q.id,
        section_id: section.id,
        domain: section.name,
        mode: 'full',
        required: q.required,
        evidence_required: hasEvidenceRequired,
        evidence_type: evidenceValidation?.evidence_type,
        evidence_source: evidenceValidation?.source,
        enabled: true,
        activated_by_rules: [],
        question: q,
      });
      qids.push(q.id);
    }
    sectionQuestionIds.set(section.id, qids);
  }

  const riskFlags: BTCRiskFlag[] = [];
  const decisionLog: BTCDecisionLogEntry[] = [];

  // Sort rules by priority descending (higher = evaluated first)
  const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);

  for (const rule of sortedRules) {
    const inputsEvaluated: Record<string, unknown> = {};

    // Evaluate all conditions
    let matched = true;
    for (const cond of rule.when.all) {
      const sourceObj = cond.source === 'si' ? siOutputs : cuiOutputs;
      const actual = resolvePath(sourceObj, cond.path);
      inputsEvaluated[`${cond.source}.${cond.path}`] = actual;

      if (!evaluateCondition(cond, siOutputs, cuiOutputs)) {
        matched = false;
        break;
      }
    }

    decisionLog.push({
      rule_id: rule.id,
      description: rule.description,
      result: matched ? 'matched' : 'skipped',
      inputs_evaluated: inputsEvaluated,
    });

    if (!matched) continue;

    // Apply actions
    for (const action of rule.then.actions) {
      switch (action.type) {
        case 'enable_section': {
          const qids = sectionQuestionIds.get(action.target) || [];
          for (const qid of qids) {
            const entry = entryMap.get(qid);
            if (entry) {
              entry.mode = action.mode || 'full';
              entry.activated_by_rules.push(rule.id);
            }
          }
          break;
        }
        case 'set_question_mode': {
          // Can target a section or a specific question
          const qids = sectionQuestionIds.get(action.target);
          if (qids) {
            // Target is a section
            for (const qid of qids) {
              const entry = entryMap.get(qid);
              if (entry) {
                entry.mode = action.mode || 'full';
                entry.activated_by_rules.push(rule.id);
              }
            }
          } else {
            // Target is a specific question
            const entry = entryMap.get(action.target);
            if (entry) {
              entry.mode = action.mode || 'full';
              entry.activated_by_rules.push(rule.id);

              if (action.mode === 'substitute' && action.substitute_with) {
                const virtualQ = virtualMap.get(action.substitute_with);
                if (virtualQ) {
                  entry.substitute_source_id = action.substitute_with;
                  entry.question = virtualQ;
                }
              }
            }
          }
          break;
        }
        case 'require_question': {
          const entry = entryMap.get(action.target);
          if (entry) {
            entry.required = true;
            entry.mode = action.mode || 'full';
            entry.activated_by_rules.push(rule.id);
          }
          break;
        }
        case 'add_risk_flag': {
          if (action.risk_flag) {
            riskFlags.push({
              flag_id: `${rule.id}_${action.risk_flag}`,
              domain: action.target,
              severity: 'high',
              description: action.risk_flag.replace(/_/g, ' '),
              source_rule_id: rule.id,
            });
          }
          break;
        }
      }
    }
  }

  // Return all enabled entries ordered by section then bank order
  const entries = Array.from(entryMap.values()).filter((e) => e.enabled);

  return { entries, risk_flags: riskFlags, decision_log: decisionLog };
}

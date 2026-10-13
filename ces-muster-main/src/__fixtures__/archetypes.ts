// GO-2 M2 — fixture archetype set (MECHANISM milestone; the real 4-6 archetypes
// encode business judgment and are founder-blocked CONTENT, a non-goal here).
// Raw material for the real set: ces-planner's Capability Taxonomy /
// Implementation Patterns knowledge banks (consumed, never forked — ces-planner
// is read-only). Defaults prefill answers with provenance 'archetype-default':
// priors, not facts — individually overridable, drafts until attested.
import type { QuestionNode } from '@/features/interview/questionGraph';

export interface Archetype {
  id: string;
  label: string;
  description: string;
  /** question_id -> prior answer. Applied only where no answer exists. */
  defaults: Record<string, string>;
}

export const ARCHETYPES_FIXTURE: Archetype[] = [
  {
    id: 'cloud-native-m365',
    label: 'Cloud-native Microsoft 365 shop',
    description:
      'Everything lives in GCC High M365; endpoints are Intune-managed; no on-prem servers.',
    defaults: {
      'iam-001': 'yes',
      'iam-004': 'yes',
      'ep-001': 'yes',
      'ep-002': 'yes',
      'dp-001': 'yes',
      'mon-001': 'yes',
    },
  },
  {
    id: 'hybrid-on-prem',
    label: 'Hybrid with on-prem infrastructure',
    description:
      'M365 plus on-prem file servers or AD; endpoint management is mixed; some legacy systems.',
    defaults: {
      'iam-001': 'yes',
      'ep-001': 'no',
      'ep-002': 'unsure',
      'dp-001': 'unsure',
      'pol-001': 'yes',
    },
  },
  {
    id: 'small-shop-minimal',
    label: 'Small shop, minimal formal IT',
    description:
      'Under 25 people, outsourced or part-time IT, little formal policy documentation yet.',
    defaults: {
      'pol-001': 'no',
      'pol-002': 'no',
      'ir-001': 'no',
      'mon-001': 'no',
    },
  },
];

/** Only defaults whose question exists in the graph apply (bank is the schema). */
export function validArchetypeDefaults(
  archetype: Archetype,
  graph: QuestionNode[]
): Record<string, string> {
  const ids = new Set(graph.map((q) => q.id));
  return Object.fromEntries(
    Object.entries(archetype.defaults).filter(([qid]) => ids.has(qid))
  );
}
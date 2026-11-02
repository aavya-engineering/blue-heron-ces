// GO-2 M2 / MG-21 — the archetype registry (MECHANISM only). D8: BHD supplies the
// real archetype content; nothing here is domain content. Two parts:
//   - BHD_ARCHETYPES: the content slot. Empty until BHD's archetypes land; each
//     entry then pre-fills its fields with no other code change.
//   - TEST_ARCHETYPE: one clearly named test archetype that exercises the
//     mechanism. Its values are 'unknown' only, so it asserts nothing about any
//     organisation.
// Defaults prefill answers as priors, not facts — individually overridable. In
// the interview they ride as 'archetype-default' drafts (archetypePrefill); in
// the plan compile they fill only SI fields that discovery, inference and the
// operator left empty, with field source 'archetype' (plan/archetypePriors).
import type { QuestionNode } from '@/features/interview/questionGraph';

export interface Archetype {
  id: string;
  label: string;
  description: string;
  /** question_id -> prior answer. Applied only where no answer exists. */
  defaults: Record<string, string>;
}

/**
 * Content slot (D8, MG-21): BHD's archetypes go here, in the Archetype shape.
 * `defaults` keys are question-graph node ids (readiness nodes or SI plan-input
 * nodes such as 'S-13'); values must be one of that node's options. Keys that
 * name no node are dropped (validArchetypeDefaults).
 */
export const BHD_ARCHETYPES: Archetype[] = [];

/** The one test archetype (MG-21): mechanism check only, not real content. */
export const TEST_ARCHETYPE: Archetype = {
  id: 'test-archetype-mechanism-only',
  label: 'Test archetype (mechanism check only, not real content)',
  description:
    'Placeholder that exercises the archetype mechanism until BHD supplies the real archetypes. Every prior is "unknown".',
  defaults: {
    'S-13': 'unknown',
    'S-28': 'unknown',
  },
};

/** Every selectable archetype: BHD's content first, then the test archetype. */
export const ARCHETYPES: Archetype[] = [...BHD_ARCHETYPES, TEST_ARCHETYPE];

export function archetypeById(id: string | null | undefined): Archetype | undefined {
  return id ? ARCHETYPES.find((a) => a.id === id) : undefined;
}

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

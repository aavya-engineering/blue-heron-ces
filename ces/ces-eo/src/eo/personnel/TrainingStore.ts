// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type {
  TrainingCatalog,
  TrainingCourse,
  TrainingCompletion,
  PersonnelTrainingState,
} from '../../shared/types/personnel.types.js';
import { TrainingCatalogSchema, PersonnelTrainingStateSchema } from '../../shared/types/personnel.types.js';
import { getCesRepository } from 'ces-shared/persistence/node';
import type { InterviewRecord } from 'ces-shared/types/interview-record';

/**
 * FIN-26: the interview records' collection (interview-router.ts INTERVIEW_RECORD_COLLECTION; a test pins the two
 * equal). Not imported: the router pulls ControlAssessor into every importer of this store.
 */
export const INTERVIEW_RECORDS_COLLECTION = 'eo_interview_records';

// G2: training catalog + per-personnel training state persist in the unified SQLite repository,
// tenant-isolated by tenantSlug, replacing {storageRoot}/personnel/{tenantSlug}/_training_catalog.json
// and .../training/{personnelId}.json. See ADR-002.
const TRAINING_CATALOG_COLLECTION = 'eo_training_catalog';
// NS-3b: the customer-scoped catalog built from the organisation's uploaded training records (OrganisationTraining.ts).
const ORG_CATALOG_SUFFIX = '_org_training_catalog';
const TRAINING_STATE_COLLECTION = 'eo_training_state';

// FIN-26 (founder ruling FD-9): AT.L2-3.2.2 (role-based training) is decided for an operator-defined population.
// The operator names the job titles in Muster's question PI.PER.012; its interview record reaches EO
// (POST /api/interviews, collection eo_interview_records), or an operator saves the list here (saveRolePopulation,
// which wins). loadCatalog carries the population on the catalog it returns (`role_population`), so the ledger
// (ledgerAssembly), the SSP (SspGenerator) and the personnel card apply one rule through the pure functions below.
// The interview record only says WHO is in scope; the completions decide the status (FD-7: interviews never score).
export const ROLE_POPULATION_CONTROL = 'AT.L2-3.2.2';
export const ROLE_POPULATION_QUESTION_ID = 'PI.PER.012';
const ROLE_POPULATION_SUFFIX = '_role_population';

/** Who must take a role-based course for AT.L2-3.2.2 (FD-9). */
export interface RolePopulation {
  controlId: typeof ROLE_POPULATION_CONTROL;
  /** Job titles, compared with a person's `role` ignoring case and outer spaces. */
  roles: string[];
  /** `operator` = saved through the store; `interview` = the newest PI.PER.012 interview record. */
  source: 'operator' | 'interview';
  questionId?: string;
  recordId?: string;
  capturedAt?: string;
}

/** A catalog as loadCatalog returns it: the stored courses plus the tenant's role population, when defined. */
export type TrainingCatalogWithPopulation = TrainingCatalog & { role_population?: RolePopulation };

/** The job titles in a PI.PER.012 answer: separated by ";" or line breaks; "none" / "n/a" mean no population. */
export function parseRolePopulationAnswer(answer: string): string[] {
  const out: string[] = [];
  for (const raw of answer.split(/[;\r\n]+/)) {
    const t = raw.trim();
    if (!t || /^(none|n\/a|na|-)$/i.test(t)) continue;
    if (!out.some(o => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

/** The population the catalog carries, when it names at least one job title. */
export function rolePopulationOf(catalog: TrainingCatalog): RolePopulation | undefined {
  const pop = (catalog as TrainingCatalogWithPopulation).role_population;
  return pop && pop.roles.length > 0 ? pop : undefined;
}

/** A course whose population is the operator-defined one: it satisfies AT.L2-3.2.2 and is not required of everyone. */
function isPopulationCourse(course: TrainingCourse): boolean {
  return course.satisfies_controls.includes(ROLE_POPULATION_CONTROL) && !courseCoversAllPersonnel(course);
}

export function inRolePopulation(role: string, population: RolePopulation): boolean {
  const r = (role ?? '').trim().toLowerCase();
  return population.roles.some(p => p.toLowerCase() === r);
}

/** The catalog with the population attached (any old one removed; none attached when undefined). Courses are never rewritten. */
export function withRolePopulation(catalog: TrainingCatalog, population: RolePopulation | undefined): TrainingCatalogWithPopulation {
  const { role_population: _old, ...rest } = catalog as TrainingCatalogWithPopulation;
  return population && population.roles.length > 0 ? { ...rest, role_population: population } : rest;
}

/** FD-9: the population rule applies to AT.L2-3.2.2 when a population is defined and a role-scoped course satisfies it. */
function populationRule(catalog: TrainingCatalog, controlId: string): { population: RolePopulation; courses: TrainingCourse[] } | undefined {
  if (controlId !== ROLE_POPULATION_CONTROL) return undefined;
  const population = rolePopulationOf(catalog);
  if (!population) return undefined;
  const courses = catalog.courses.filter(isPopulationCourse);
  return courses.length > 0 ? { population, courses } : undefined;
}

/** Per-person training compliance for one control (one rule for the store and the SSP, NS-3b). */
export interface TrainingControlCompliance {
  /** Active people examined. */
  total: number;
  /** People with a current completion of a required course that satisfies the control. */
  compliant: number;
  /** People with no required course that satisfies the control. */
  exempt: number;
  /** At least one person and one course for the control, and every person compliant or exempt. */
  met: boolean;
  /**
   * FIN-26 (FD-9): set when the operator-defined population decided the count. `total` is then the active people in
   * the population only (people outside it are not counted), and met needs at least one of them.
   */
  population?: { roles: string[]; source: RolePopulation['source'] };
}

/** A course every active person must take (the population comes from the personnel store, not a record). */
export function courseCoversAllPersonnel(course: TrainingCourse): boolean {
  return course.required_for_roles.includes('all_users') || course.targetRoles.includes('*');
}

/**
 * NS-3b: the training store decides a control only when a course that satisfies it is required of every
 * active person. A control covered only by courses scoped to a record's job titles is left to other sources.
 */
export function catalogDecidesControl(catalog: TrainingCatalog, controlId: string): boolean {
  // FIN-26 (FD-9): with an operator-defined population, a role-scoped AT.L2-3.2.2 course decides it for that population.
  if (populationRule(catalog, controlId)) return true;
  return catalog.courses.some(c => c.satisfies_controls.includes(controlId) && courseCoversAllPersonnel(c));
}

function requiredCourseIds(role: string, screeningState: string, catalog: TrainingCatalog): string[] {
  const population = rolePopulationOf(catalog);
  return catalog.courses
    .filter(course => {
      // FIN-26 (FD-9): a role-scoped AT.L2-3.2.2 course is required of exactly the operator-defined population.
      if (population && isPopulationCourse(course)) return inRolePopulation(role, population);
      for (const reqRole of course.required_for_roles) {
        if (reqRole === 'all_users') return true;
        if (reqRole === 'cui_access' && screeningState === 'cleared') return true;
        if (reqRole === 'system_administrator' && (role === 'Admin' || role === 'Operator')) return true;
        // Also match targetRoles wildcard
        if (course.targetRoles.includes('*')) return true;
        if (course.targetRoles.includes(role)) return true;
      }
      return false;
    })
    .map(c => c.id);
}

/**
 * The rule TrainingStore.isControlMet applies, per person: exempt when no required course satisfies the
 * control, compliant when one of those courses has a current completion (no expiry date, or not expired).
 */
export function trainingControlCompliance(
  catalog: TrainingCatalog,
  controlId: string,
  activePersonnel: Array<{ id: string; role: string; screeningState: string }>,
  stateOf: (personnelId: string) => PersonnelTrainingState | null | undefined,
  now: Date = new Date(),
): TrainingControlCompliance {
  const rule = populationRule(catalog, controlId);
  if (rule) {
    // FIN-26 (FD-9): only the population is examined; each member needs a current completion of a role-scoped course.
    const members = activePersonnel.filter(p => inRolePopulation(p.role, rule.population));
    let compliant = 0;
    for (const person of members) {
      const state = stateOf(person.id);
      if (state && rule.courses.some(c => hasCurrentCompletion(state, c.id, now))) compliant++;
    }
    return {
      total: members.length,
      compliant,
      exempt: 0,
      met: members.length > 0 && compliant === members.length,
      population: { roles: [...rule.population.roles], source: rule.population.source },
    };
  }
  const coursesForControl = catalog.courses.filter(c => c.satisfies_controls.includes(controlId));
  const total = activePersonnel.length;
  if (coursesForControl.length === 0) return { total, compliant: 0, exempt: 0, met: false };
  let compliant = 0;
  let exempt = 0;
  for (const person of activePersonnel) {
    const requiredIds = requiredCourseIds(person.role, person.screeningState, catalog);
    const relevantCourseIds = coursesForControl.filter(c => requiredIds.includes(c.id)).map(c => c.id);
    if (relevantCourseIds.length === 0) { exempt++; continue; }
    const state = stateOf(person.id);
    if (!state) continue;
    const hasCurrent = relevantCourseIds.some(courseId => {
      const completion = state.completions.find(c => c.courseId === courseId);
      if (!completion) return false;
      if (completion.expiryDate && new Date(completion.expiryDate) < now) return false;
      return true;
    });
    if (hasCurrent) compliant++;
  }
  return { total, compliant, exempt, met: total > 0 && compliant + exempt === total };
}

function hasCurrentCompletion(state: PersonnelTrainingState, courseId: string, now: Date): boolean {
  const completion = state.completions.find(c => c.courseId === courseId);
  if (!completion) return false;
  return !(completion.expiryDate && new Date(completion.expiryDate) < now);
}

const DEFAULT_CATALOG: TrainingCatalog = {
  courses: [
    {
      id: 'dod-cyber-awareness-challenge-2026',
      title: 'DoD Cyber Awareness Challenge',
      provider: 'DoD Cyber Exchange',
      duration: '90min',
      description: 'Annual cybersecurity awareness training required for all DoD personnel and contractors.',
      targetRoles: ['*'],
      required_for_roles: ['all_users'],
      satisfies_controls: ['AT.L2-3.2.1', 'AT.L2-3.2.2'],
      refresh_cycle_days: 365,
      source_url: 'https://public.cyber.mil/training/cyber-awareness-challenge/',
      launch_url: 'https://cs.signal.apps.mil/enrolled',
      certificate_note: 'Save completion certificate as PDF from DoD Cyber Exchange portal.',
      cost: 'Free',
    },
    {
      id: 'dod-cui-mandatory-training',
      title: 'DoD CUI Mandatory Training',
      provider: 'DCSA',
      duration: '45min',
      description: 'Controlled Unclassified Information handling training for personnel with CUI access.',
      targetRoles: ['cui_access'],
      required_for_roles: ['cui_access'],
      satisfies_controls: ['AT.L2-3.2.1'],
      refresh_cycle_days: 730,
      source_url: 'https://securityawareness.usalearning.gov/cui/index.html',
      launch_url: 'https://securityawareness.usalearning.gov/cui/index.html',
      certificate_note: 'Download completion certificate from DCSA portal after passing final exam.',
      cost: 'Free',
    },
    {
      id: 'cdse-insider-threat-int101',
      title: 'CDSE Insider Threat Awareness (INT101)',
      provider: 'CDSE',
      duration: '75min',
      description: 'Insider threat awareness training covering indicators, reporting, and countermeasures.',
      targetRoles: ['*'],
      required_for_roles: ['all_users'],
      satisfies_controls: ['AT.L2-3.2.3'],
      refresh_cycle_days: 365,
      source_url: 'https://www.cdse.edu/Training/eLearning/INT101/',
      launch_url: 'https://securityawareness.usalearning.gov/itawareness/index.htm',
      certificate_note: 'Save completion certificate from CDSE STEPP system.',
      cost: 'Free',
    },
    {
      id: 'cisa-learning-admin-track',
      title: 'CISA Cybersecurity Learning — Admin Track',
      provider: 'CISA Learning',
      duration: '120min',
      description: 'System administrator security training covering hardening, monitoring, and incident response.',
      targetRoles: ['system_administrator'],
      required_for_roles: ['system_administrator'],
      satisfies_controls: ['AT.L2-3.2.2'],
      refresh_cycle_days: 365,
      source_url: 'https://www.cisa.gov/cybersecurity-training-exercises',
      launch_url: 'https://fedvte.usalearning.gov/',
      certificate_note: 'Export completion report from CISA FedVTE dashboard.',
      cost: 'Free',
    },
    {
      id: 'cdse-cybersecurity-fundamentals',
      title: 'CDSE Cybersecurity Fundamentals',
      provider: 'CDSE',
      duration: '180min',
      description: 'Foundational cybersecurity concepts for system administrators and security personnel.',
      targetRoles: ['system_administrator'],
      required_for_roles: ['system_administrator'],
      satisfies_controls: ['AT.L2-3.2.2'],
      refresh_cycle_days: 365,
      source_url: 'https://www.cdse.edu/Training/eLearning/',
      launch_url: 'https://www.cdse.edu/Training/eLearning/',
      certificate_note: 'Save completion certificate from CDSE STEPP system.',
      cost: 'Free',
    },
  ],
};

export class TrainingStore {
  private readonly storageRoot: string;

  constructor(storageRoot: string) {
    this.storageRoot = storageRoot;
  }

  private get repo() {
    return getCesRepository();
  }

  /** Per-tenant key for the training catalog singleton. */
  private catalogKey(tenantSlug: string): string {
    return `${tenantSlug}:_training_catalog`;
  }

  /** Per-tenant key for a personnel training-state record. */
  private stateKey(tenantSlug: string, personnelId: string): string {
    return `${tenantSlug}:${personnelId}`;
  }

  /**
   * NS-3b: an operator-saved catalog first, then the customer-scoped one from the organisation's records, then the default.
   * FIN-26 (FD-9): the tenant's AT.L2-3.2.2 role population, when defined, rides on the result (`role_population`).
   */
  loadCatalog(tenantSlug: string): TrainingCatalogWithPopulation {
    return withRolePopulation(this.loadBaseCatalog(tenantSlug), this.loadRolePopulation(tenantSlug));
  }

  /**
   * FIN-26 (FD-9): the operator-saved population first, else the newest answered PI.PER.012 interview record
   * (by interviewedAt, then recordId). Undefined when neither names a job title, or the records cannot be read.
   */
  loadRolePopulation(tenantSlug: string): RolePopulation | undefined {
    const saved = this.repo.get<{ roles?: unknown }>(TRAINING_CATALOG_COLLECTION, `${tenantSlug}:${ROLE_POPULATION_SUFFIX}`, { tenantSlug });
    const savedRoles = Array.isArray(saved?.data?.roles)
      ? parseRolePopulationAnswer((saved!.data.roles as unknown[]).filter((r): r is string => typeof r === 'string').join(';'))
      : [];
    if (savedRoles.length > 0) return { controlId: ROLE_POPULATION_CONTROL, roles: savedRoles, source: 'operator' };
    let records: InterviewRecord[];
    try {
      records = this.repo.list<InterviewRecord>(INTERVIEW_RECORDS_COLLECTION, { tenantSlug })
        .map(r => r.data)
        .filter(r => r && r.questionId === ROLE_POPULATION_QUESTION_ID && typeof r.answer === 'string');
    } catch {
      return undefined;
    }
    records.sort((a, b) =>
      a.interviewedAt !== b.interviewedAt ? (a.interviewedAt < b.interviewedAt ? 1 : -1) : (a.recordId < b.recordId ? 1 : -1));
    const newest = records[0];
    if (!newest) return undefined;
    const roles = parseRolePopulationAnswer(newest.answer);
    if (roles.length === 0) return undefined;
    return {
      controlId: ROLE_POPULATION_CONTROL,
      roles,
      source: 'interview',
      questionId: newest.questionId,
      recordId: newest.recordId,
      capturedAt: newest.interviewedAt,
    };
  }

  /** FIN-26 (FD-9): save the operator's population (it outranks the interview record); undefined or [] removes it. */
  saveRolePopulation(tenantSlug: string, roles: string[] | undefined): void {
    const id = `${tenantSlug}:${ROLE_POPULATION_SUFFIX}`;
    const clean = roles ? parseRolePopulationAnswer(roles.join(';')) : [];
    if (clean.length > 0) this.repo.put(TRAINING_CATALOG_COLLECTION, { id, ces: { tenantSlug }, data: { roles: clean } });
    else this.repo.delete(TRAINING_CATALOG_COLLECTION, id, { tenantSlug });
  }

  private loadBaseCatalog(tenantSlug: string): TrainingCatalog {
    const rec = this.repo.get<unknown>(TRAINING_CATALOG_COLLECTION, this.catalogKey(tenantSlug), { tenantSlug });
    if (rec) {
      try {
        return TrainingCatalogSchema.parse(rec.data);
      } catch {
        // Fall through to default
      }
    }
    return this.loadOrganisationCatalog(tenantSlug) ?? DEFAULT_CATALOG;
  }

  /** NS-3b: the customer-scoped catalog (OrganisationTraining.catalogFromOrganisationRecords), if stored. */
  loadOrganisationCatalog(tenantSlug: string): TrainingCatalog | undefined {
    const rec = this.repo.get<unknown>(TRAINING_CATALOG_COLLECTION, `${tenantSlug}:${ORG_CATALOG_SUFFIX}`, { tenantSlug });
    if (!rec) return undefined;
    const parsed = TrainingCatalogSchema.safeParse(rec.data);
    return parsed.success ? parsed.data : undefined;
  }

  /** NS-3b: keep the customer-scoped catalog; undefined (no training records uploaded) removes it. */
  saveOrganisationCatalog(tenantSlug: string, catalog: TrainingCatalog | undefined): void {
    const id = `${tenantSlug}:${ORG_CATALOG_SUFFIX}`;
    if (catalog) this.repo.put(TRAINING_CATALOG_COLLECTION, { id, ces: { tenantSlug }, data: catalog });
    else this.repo.delete(TRAINING_CATALOG_COLLECTION, id, { tenantSlug });
  }

  saveCatalog(tenantSlug: string, catalog: TrainingCatalog): void {
    // FIN-26: the population belongs to the tenant, not the catalog; a catalog read back from loadCatalog never stores it.
    const { role_population: _population, ...data } = catalog as TrainingCatalogWithPopulation;
    this.repo.put(TRAINING_CATALOG_COLLECTION, {
      id: this.catalogKey(tenantSlug),
      ces: { tenantSlug },
      data,
    });
  }

  loadTrainingState(tenantSlug: string, personnelId: string): PersonnelTrainingState | null {
    const rec = this.repo.get<unknown>(TRAINING_STATE_COLLECTION, this.stateKey(tenantSlug, personnelId), { tenantSlug });
    if (!rec) return null;
    try {
      return PersonnelTrainingStateSchema.parse(rec.data);
    } catch {
      return null;
    }
  }

  saveTrainingState(tenantSlug: string, state: PersonnelTrainingState): void {
    this.repo.put(TRAINING_STATE_COLLECTION, {
      id: this.stateKey(tenantSlug, state.personnelId),
      ces: { tenantSlug },
      data: state,
    });
  }

  computeRequiredCourses(role: string, screeningState: string, catalog: TrainingCatalog): string[] {
    return requiredCourseIds(role, screeningState, catalog);
  }

  addCompletion(tenantSlug: string, personnelId: string, completion: TrainingCompletion): PersonnelTrainingState {
    let state = this.loadTrainingState(tenantSlug, personnelId);
    if (!state) {
      state = {
        personnelId,
        requiredCourses: [],
        completions: [],
      };
    }
    // FC-EO-B defect fix: de-dupe by courseId so a re-completion (e.g. an annual refresher
    // recorded after the prior one expired) REPLACES the stale record instead of appending
    // a second one. getTrainingStatus/isControlMet both use Array.find(), which returns the
    // FIRST match — with two records for the same course, the fresh completion was silently
    // shadowed by the old, expired one and the course stayed reported as overdue forever.
    state.completions = state.completions.filter(c => c.courseId !== completion.courseId);
    state.completions.push(completion);
    this.saveTrainingState(tenantSlug, state);
    return state;
  }

  removeCompletion(tenantSlug: string, personnelId: string, courseId: string): PersonnelTrainingState | null {
    const state = this.loadTrainingState(tenantSlug, personnelId);
    if (!state) return null;
    state.completions = state.completions.filter(c => c.courseId !== courseId);
    this.saveTrainingState(tenantSlug, state);
    return state;
  }

  getTrainingStatus(
    tenantSlug: string,
    personnelId: string,
    role: string,
    screeningState: string,
    gracePeriodDays: number = 30,
  ): { total: number; completed: number; overdue: number; expiringSoon: number } {
    const catalog = this.loadCatalog(tenantSlug);
    const required = this.computeRequiredCourses(role, screeningState, catalog);
    const state = this.loadTrainingState(tenantSlug, personnelId);
    const now = new Date();

    let completed = 0;
    let overdue = 0;
    let expiringSoon = 0;

    for (const courseId of required) {
      const completion = state?.completions.find(c => c.courseId === courseId);
      if (!completion) {
        // Not completed at all - check if it's been assigned (state exists)
        if (state) overdue++;
        continue;
      }

      // Check expiry
      if (completion.expiryDate) {
        const expiry = new Date(completion.expiryDate);
        if (expiry < now) {
          overdue++;
          continue;
        }
        const graceDate = new Date(expiry.getTime() - gracePeriodDays * 24 * 60 * 60 * 1000);
        if (now >= graceDate) {
          expiringSoon++;
        }
      }
      completed++;
    }

    return {
      total: required.length,
      completed,
      overdue,
      expiringSoon,
    };
  }

  /**
   * Check if a specific AT control is met across all active personnel.
   * Uses the satisfies_controls field on each course in the catalog (rule: trainingControlCompliance).
   * NS-3b: never met on a control no all-personnel course covers (catalogDecidesControl), where everyone
   * outside a record's own job titles would otherwise be exempt.
   */
  isControlMet(
    tenantSlug: string,
    controlId: string,
    activePersonnel: Array<{ id: string; role: string; screeningState: string }>,
  ): boolean {
    if (!catalogDecidesControl(this.loadCatalog(tenantSlug), controlId)) return false;
    return this.controlCompliance(tenantSlug, controlId, activePersonnel).met;
  }

  /** NS-3b: the per-person counts behind isControlMet. */
  controlCompliance(
    tenantSlug: string,
    controlId: string,
    activePersonnel: Array<{ id: string; role: string; screeningState: string }>,
  ): TrainingControlCompliance {
    return trainingControlCompliance(this.loadCatalog(tenantSlug), controlId, activePersonnel, id => this.loadTrainingState(tenantSlug, id));
  }
}

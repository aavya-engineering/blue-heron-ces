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

// G2: training catalog + per-personnel training state persist in the unified SQLite repository,
// tenant-isolated by tenantSlug, replacing {storageRoot}/personnel/{tenantSlug}/_training_catalog.json
// and .../training/{personnelId}.json. See ADR-002.
const TRAINING_CATALOG_COLLECTION = 'eo_training_catalog';
const TRAINING_STATE_COLLECTION = 'eo_training_state';

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

  loadCatalog(tenantSlug: string): TrainingCatalog {
    const rec = this.repo.get<unknown>(TRAINING_CATALOG_COLLECTION, this.catalogKey(tenantSlug), { tenantSlug });
    if (rec) {
      try {
        return TrainingCatalogSchema.parse(rec.data);
      } catch {
        // Fall through to default
      }
    }
    return DEFAULT_CATALOG;
  }

  saveCatalog(tenantSlug: string, catalog: TrainingCatalog): void {
    this.repo.put(TRAINING_CATALOG_COLLECTION, {
      id: this.catalogKey(tenantSlug),
      ces: { tenantSlug },
      data: catalog,
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
    return catalog.courses
      .filter(course => {
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
   * Uses the satisfies_controls field on each course in the catalog.
   */
  isControlMet(
    tenantSlug: string,
    controlId: string,
    activePersonnel: Array<{ id: string; role: string; screeningState: string }>,
  ): boolean {
    if (activePersonnel.length === 0) return false;

    const catalog = this.loadCatalog(tenantSlug);
    const coursesForControl = catalog.courses.filter(c =>
      c.satisfies_controls.includes(controlId),
    );

    if (coursesForControl.length === 0) return false;

    const now = new Date();
    for (const person of activePersonnel) {
      // Check if this person requires any course that satisfies this control
      const requiredIds = this.computeRequiredCourses(person.role, person.screeningState, catalog);
      const relevantCourseIds = coursesForControl
        .filter(c => requiredIds.includes(c.id))
        .map(c => c.id);

      // If person has no required courses for this control, they are exempt
      if (relevantCourseIds.length === 0) continue;

      // Person must have a current completion for at least one relevant course
      const state = this.loadTrainingState(tenantSlug, person.id);
      if (!state) return false;

      const hasCurrent = relevantCourseIds.some(courseId => {
        const completion = state.completions.find(c => c.courseId === courseId);
        if (!completion) return false;
        if (completion.expiryDate && new Date(completion.expiryDate) < now) return false;
        return true;
      });

      if (!hasCurrent) return false;
    }

    return true;
  }
}

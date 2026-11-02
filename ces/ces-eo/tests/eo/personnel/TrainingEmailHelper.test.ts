// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-B / EO-12 — training assignment email text generation (production code, no I/O).
 */
import { TrainingEmailHelper } from '../../../src/eo/personnel/TrainingEmailHelper';
import { PersonnelConfigSchema } from '../../../src/shared/types/personnel.types';
import type { TrainingCourse } from '../../../src/shared/types/personnel.types';

describe('TrainingEmailHelper.generateAssignmentEmail', () => {
  const config = PersonnelConfigSchema.parse({
    trainingEmailFrom: 'security@example.test',
    trainingEmailSubject: 'Required Training Assignment',
  });

  const courses: TrainingCourse[] = [
    {
      id: 'course-a',
      title: 'Course A',
      provider: 'Provider A',
      duration: '30min',
      targetRoles: ['*'],
      required_for_roles: ['all_users'],
      satisfies_controls: ['AT.L2-3.2.1'],
      refresh_cycle_days: 365,
      launch_url: 'https://provider-a.example.test/launch',
      source_url: 'https://provider-a.example.test/source',
      certificate_note: 'Save the PDF certificate.',
      cost: 'Free',
    },
    {
      id: 'course-b',
      title: 'Course B',
      provider: 'Provider B',
      duration: '45min',
      targetRoles: ['*'],
      required_for_roles: ['all_users'],
      satisfies_controls: ['AT.L2-3.2.3'],
      refresh_cycle_days: 365,
    },
  ];

  it('includes the subject line from config', () => {
    const email = TrainingEmailHelper.generateAssignmentEmail({
      displayName: 'Jane Engineer',
      courses,
      tenantName: 'acme-tenant',
      config,
    });
    expect(email).toContain('Subject: Required Training Assignment');
  });

  it('greets the person by first name only', () => {
    const email = TrainingEmailHelper.generateAssignmentEmail({
      displayName: 'Jane Engineer',
      courses,
      tenantName: 'acme-tenant',
      config,
    });
    expect(email).toContain('Hi Jane,');
  });

  it('lists every course with title, provider, duration, launch/source/cert/cost when present', () => {
    const email = TrainingEmailHelper.generateAssignmentEmail({
      displayName: 'Jane Engineer',
      courses,
      tenantName: 'acme-tenant',
      config,
    });
    expect(email).toContain('1. Course A');
    expect(email).toContain('Provider: Provider A');
    expect(email).toContain('Duration: 30min');
    expect(email).toContain('Launch URL: https://provider-a.example.test/launch');
    expect(email).toContain('Source: https://provider-a.example.test/source');
    expect(email).toContain('Certificate: Save the PDF certificate.');
    expect(email).toContain('Cost: Free');
    expect(email).toContain('2. Course B');
  });

  it('omits optional course fields that are absent (Course B has no launch/source/cert/cost)', () => {
    const email = TrainingEmailHelper.generateAssignmentEmail({
      displayName: 'Jane Engineer',
      courses,
      tenantName: 'acme-tenant',
      config,
    });
    const courseBBlock = email.split('2. Course B')[1].split('\n\n')[0];
    expect(courseBBlock).not.toContain('Launch URL');
    expect(courseBBlock).not.toContain('Source:');
    expect(courseBBlock).not.toContain('Certificate:');
    expect(courseBBlock).not.toContain('Cost:');
  });

  it('names the tenant in the compliance-program sentence and the sign-off', () => {
    const email = TrainingEmailHelper.generateAssignmentEmail({
      displayName: 'Jane Engineer',
      courses,
      tenantName: 'acme-tenant',
      config,
    });
    expect(email).toContain("acme-tenant's CMMC Level 2 compliance program");
    expect(email).toContain('acme-tenant Security Team');
  });

  it('builds the certificate file-naming example from the last name and the first course id', () => {
    const email = TrainingEmailHelper.generateAssignmentEmail({
      displayName: 'Jane Engineer',
      courses,
      tenantName: 'acme-tenant',
      config,
    });
    const today = new Date().toISOString().substring(0, 10);
    expect(email).toContain(`Engineer-course-a-${today}.pdf`);
  });

  it('ends with the configured trainingEmailFrom address', () => {
    const email = TrainingEmailHelper.generateAssignmentEmail({
      displayName: 'Jane Engineer',
      courses,
      tenantName: 'acme-tenant',
      config,
    });
    expect(email.trim().endsWith('security@example.test')).toBe(true);
  });

  it('falls back to the default subject when config has no override', () => {
    const defaultConfig = PersonnelConfigSchema.parse({});
    const email = TrainingEmailHelper.generateAssignmentEmail({
      displayName: 'Solo',
      courses: [courses[0]],
      tenantName: 'solo-tenant',
      config: defaultConfig,
    });
    expect(email).toContain('Subject: Required Training Assignment');
  });

  it('handles a single-word display name without throwing', () => {
    const email = TrainingEmailHelper.generateAssignmentEmail({
      displayName: 'Madonna',
      courses: [courses[0]],
      tenantName: 'solo-tenant',
      config,
    });
    expect(email).toContain('Hi Madonna,');
    // pop() on a single-word name returns that same word -- pins current behavior.
    expect(email).toContain('Madonna-course-a-');
  });
});

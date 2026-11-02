// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { TrainingCourse, PersonnelConfig } from '../../shared/types/personnel.types.js';

export class TrainingEmailHelper {
  static generateAssignmentEmail(params: {
    displayName: string;
    courses: TrainingCourse[];
    tenantName: string;
    config: PersonnelConfig;
  }): string {
    const { displayName, courses, tenantName, config } = params;
    const firstName = displayName.split(' ')[0] || displayName;

    const courseLines = courses.map((course, i) => {
      const lines: string[] = [];
      lines.push(`${i + 1}. ${course.title}`);
      lines.push(`   Provider: ${course.provider}`);
      lines.push(`   Duration: ${course.duration}`);
      if (course.launch_url) {
        lines.push(`   Launch URL: ${course.launch_url}`);
      }
      if (course.source_url) {
        lines.push(`   Source: ${course.source_url}`);
      }
      if (course.certificate_note) {
        lines.push(`   Certificate: ${course.certificate_note}`);
      }
      if (course.cost) {
        lines.push(`   Cost: ${course.cost}`);
      }
      return lines.join('\n');
    }).join('\n\n');

    const subject = config.trainingEmailSubject || 'Required Training Assignment';

    return `Subject: ${subject}

Hi ${firstName},

You are required to complete the following training courses as part of ${tenantName}'s CMMC Level 2 compliance program:

${courseLines}

Please complete all assigned courses within 30 days of this notification.

When saving your completion certificates, please use the following file naming convention:
  [LastName]-[CourseID]-[YYYY-MM-DD].pdf
  Example: ${displayName.split(' ').pop() || 'Smith'}-${courses[0]?.id || 'course-id'}-${new Date().toISOString().substring(0, 10)}.pdf

Completion of these courses is required to maintain compliance with CMMC Level 2 Awareness and Training (AT) controls. Failure to complete training within the required timeframe may result in restricted system access.

If you have questions about any of these training requirements, please contact your supervisor or the ${tenantName} Security Team.

Best regards,
${tenantName} Security Team
${config.trainingEmailFrom}`;
  }
}

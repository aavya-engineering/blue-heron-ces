// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

/**
 * synthetic-customer W5 cycle 2: PIM platform defaults shared by the seed
 * sets (muster-partial-config, customer-history).
 */

/** The built-in Compliance Administrator role template id (platform constant; role id = template id). */
export const COMPLIANCE_ADMINISTRATOR_TEMPLATE_ID = '17315797-102d-40b4-93e0-432062caca18';

/**
 * Entra's default PIM settings for a directory role nobody has tuned, as
 * Graph rule objects (the rule ids and shape S1's managed policies carry):
 * eligibility and active assignment may be permanent, activation up to 8 h
 * with justification, no approval.
 */
export function entraDefaultPimRules(): Array<Record<string, unknown>> {
  const target = (caller: string, level: string) => ({ caller, operations: ['all'], level, inheritableSettings: [], enforcedSettings: [] });
  return [
    { '@odata.type': '#microsoft.graph.unifiedRoleManagementPolicyExpirationRule', id: 'Expiration_Admin_Eligibility', isExpirationRequired: false, maximumDuration: 'P365D', target: target('Admin', 'Eligibility') },
    { '@odata.type': '#microsoft.graph.unifiedRoleManagementPolicyExpirationRule', id: 'Expiration_Admin_Assignment', isExpirationRequired: false, maximumDuration: 'P180D', target: target('Admin', 'Assignment') },
    { '@odata.type': '#microsoft.graph.unifiedRoleManagementPolicyEnablementRule', id: 'Enablement_Admin_Assignment', enabledRules: ['Justification'], target: target('Admin', 'Assignment') },
    { '@odata.type': '#microsoft.graph.unifiedRoleManagementPolicyExpirationRule', id: 'Expiration_EndUser_Assignment', isExpirationRequired: true, maximumDuration: 'PT8H', target: target('EndUser', 'Assignment') },
    { '@odata.type': '#microsoft.graph.unifiedRoleManagementPolicyEnablementRule', id: 'Enablement_EndUser_Assignment', enabledRules: ['Justification'], target: target('EndUser', 'Assignment') },
    {
      '@odata.type': '#microsoft.graph.unifiedRoleManagementPolicyApprovalRule',
      id: 'Approval_EndUser_Assignment',
      target: target('EndUser', 'Assignment'),
      setting: {
        isApprovalRequired: false,
        isApprovalRequiredForExtension: false,
        isRequestorJustificationRequired: true,
        approvalMode: 'SingleStage',
        approvalStages: [],
      },
    },
    { '@odata.type': '#microsoft.graph.unifiedRoleManagementPolicyNotificationRule', id: 'Notification_Admin_EndUser_Assignment', notificationType: 'Email', recipientType: 'Admin', notificationLevel: 'All', isDefaultRecipientsEnabled: true, notificationRecipients: [], target: target('EndUser', 'Assignment') },
  ];
}

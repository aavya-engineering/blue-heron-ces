// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState } from 'react';
import clsx from 'clsx';
import { Card } from '@/shared/components/Display/Card';
import { Badge } from '@/shared/components/Display/Badge';
import type {
  PreambleAnswers,
  LicenseTier,
  SecurityArchetype,
  EndpointManagement,
  MonitoringSIEM,
  PolicyDocState,
} from '../types';

interface PreambleQuestion<T extends string> {
  id: keyof PreambleAnswers;
  title: string;
  description: string;
  options: { value: T; label: string; description: string }[];
}

const QUESTIONS: PreambleQuestion<string>[] = [
  {
    id: 'license_tier',
    title: 'Microsoft 365 License Tier',
    description:
      'Which Microsoft 365 license tier is deployed for the majority of users? This determines which security services are available.',
    options: [
      {
        value: 'e3',
        label: 'Microsoft 365 E3',
        description: 'Core productivity + Entra ID P1, Intune, Defender for Office P1',
      },
      {
        value: 'e5',
        label: 'Microsoft 365 E5',
        description: 'Full security suite: Sentinel, Defender XDR, PIM, Purview DLP',
      },
      {
        value: 'business_premium',
        label: 'Microsoft 365 Business Premium',
        description: 'SMB bundle with Defender for Business, basic Intune, Entra ID P1',
      },
      {
        value: 'gcc_g3',
        label: 'GCC / G3',
        description: 'Government cloud with E3-equivalent feature set',
      },
      {
        value: 'gcc_g5',
        label: 'GCC High / G5',
        description: 'Government cloud with E5-equivalent security features',
      },
      {
        value: 'unknown',
        label: 'Not Sure',
        description: 'License tier will not be used for derivation',
      },
    ] satisfies { value: LicenseTier; label: string; description: string }[],
  },
  {
    id: 'security_archetype',
    title: 'Current Security Posture',
    description:
      'Which best describes the tenant\'s current security configuration? This sets the baseline expectation for all actions.',
    options: [
      {
        value: 'greenfield',
        label: 'Greenfield / Defaults Only',
        description: 'Tenant was provisioned but no deliberate security hardening has been done',
      },
      {
        value: 'security_defaults_only',
        label: 'Security Defaults Enabled',
        description: 'Microsoft Security Defaults turned on (MFA for all, legacy auth blocked)',
      },
      {
        value: 'basic_ca_policies',
        label: 'Basic CA Policies',
        description: 'A few Conditional Access policies (e.g. require MFA for admins, block legacy)',
      },
      {
        value: 'moderate_hardening',
        label: 'Moderate Hardening',
        description:
          'CA policies + Intune enrollment + Defender onboarded; partial compliance posture',
      },
      {
        value: 'managed_by_msp',
        label: 'Managed by MSP/MSSP',
        description: 'An external provider manages security tooling; broad but possibly opaque coverage',
      },
    ] satisfies { value: SecurityArchetype; label: string; description: string }[],
  },
  {
    id: 'endpoint_management',
    title: 'Endpoint Management',
    description: 'How are user devices enrolled and managed? This affects device compliance and endpoint protection actions.',
    options: [
      {
        value: 'intune_enrolled',
        label: 'Intune Enrolled',
        description: 'Devices are enrolled in Microsoft Intune with compliance policies',
      },
      {
        value: 'third_party_mdm',
        label: 'Third-Party MDM',
        description: 'Devices managed by a non-Microsoft MDM (Jamf, VMware, etc.)',
      },
      {
        value: 'mixed',
        label: 'Mixed / Partial',
        description: 'Some devices enrolled, some unmanaged; inconsistent coverage',
      },
      {
        value: 'unmanaged',
        label: 'Unmanaged',
        description: 'No MDM enrollment; endpoints are not centrally managed',
      },
    ] satisfies { value: EndpointManagement; label: string; description: string }[],
  },
  {
    id: 'monitoring_siem',
    title: 'Security Monitoring & SIEM',
    description:
      'What level of security event monitoring is in place? This affects audit logging and incident response actions.',
    options: [
      {
        value: 'sentinel_deployed',
        label: 'Microsoft Sentinel Deployed',
        description: 'Sentinel workspace active with data connectors and analytics rules',
      },
      {
        value: 'third_party_siem',
        label: 'Third-Party SIEM',
        description: 'Splunk, Elastic, or other SIEM ingesting M365 audit logs',
      },
      {
        value: 'basic_m365_audit',
        label: 'Basic M365 Audit Logs',
        description: 'Unified Audit Log enabled but no SIEM or alerting layer',
      },
      {
        value: 'none',
        label: 'No Monitoring',
        description: 'No deliberate security event monitoring in place',
      },
    ] satisfies { value: MonitoringSIEM; label: string; description: string }[],
  },
  {
    id: 'policy_doc_state',
    title: 'Policy & Documentation State',
    description:
      'What is the current state of written security policies? This affects all policy-type actions and Compliance Manager tasks.',
    options: [
      {
        value: 'ssp_with_policies',
        label: 'SSP + Policies Written',
        description: 'System Security Plan and supporting policies are documented and maintained',
      },
      {
        value: 'some_policies_drafted',
        label: 'Some Policies Drafted',
        description: 'A few policies exist (AUP, password policy) but coverage is incomplete',
      },
      {
        value: 'nothing_written',
        label: 'Nothing Written',
        description: 'No formal security policies or SSP exist',
      },
    ] satisfies { value: PolicyDocState; label: string; description: string }[],
  },
];

const NEW_TENANT_DEFAULTS: PreambleAnswers = {
  license_tier: 'unknown',
  security_archetype: 'greenfield',
  endpoint_management: 'unmanaged',
  monitoring_siem: 'none',
  policy_doc_state: 'nothing_written',
};

interface RRTPreambleProps {
  siBaseline: any;
  onComplete: (answers: PreambleAnswers) => void;
  onCancel: () => void;
}

export function RRTPreamble({ siBaseline, onComplete, onCancel }: RRTPreambleProps) {
  const [answers, setAnswers] = useState<Partial<PreambleAnswers>>({});

  const targetLevel =
    siBaseline?.si_baseline?.target?.target_cmmc_level ??
    siBaseline?.ces?.target?.target_cmmc_level ??
    'L2';
  const deployment =
    siBaseline?.si_baseline?.scope?.deployment_posture ??
    siBaseline?.ces?.scope?.deployment_posture ??
    'hybrid';
  const tenantModel =
    siBaseline?.si_baseline?.scope?.tenant_model ??
    siBaseline?.ces?.scope?.tenant_model ??
    'single';

  const handleNewTenant = () => {
    setAnswers(NEW_TENANT_DEFAULTS);
    onComplete(NEW_TENANT_DEFAULTS);
  };

  const allAnswered = QUESTIONS.every((q) => answers[q.id] != null);

  const handleSubmit = () => {
    if (!allAnswered) return;
    onComplete(answers as PreambleAnswers);
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Readiness Recon — Intake
        </h1>
        <p className="text-gray-600 mb-4">
          Answer 5 high-level questions about the tenant environment. These answers will be used to
          derive reasonable defaults for all implementation actions, which you can then review and
          override.
        </p>
        <button
          onClick={handleNewTenant}
          className="mb-4 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          New Tenant — Fill Defaults
        </button>
        <div className="flex gap-2 flex-wrap">
          <Badge variant="info" size="sm">
            Target: {targetLevel}
          </Badge>
          <Badge variant="neutral" size="sm">
            Deployment: {deployment}
          </Badge>
          <Badge variant="neutral" size="sm">
            Tenant: {tenantModel}
          </Badge>
        </div>
      </div>

      {/* Questions */}
      <div className="space-y-6">
        {QUESTIONS.map((q, qIdx) => (
          <Card key={q.id} title={`${qIdx + 1}. ${q.title}`}>
            <p className="text-sm text-gray-600 mb-4">{q.description}</p>
            <div className="space-y-2">
              {q.options.map((opt) => {
                const selected = answers[q.id] === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={clsx(
                      'flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors',
                      selected
                        ? 'border-green-500 bg-green-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    )}
                  >
                    <input
                      type="radio"
                      name={q.id}
                      value={opt.value}
                      checked={selected}
                      onChange={() =>
                        setAnswers((prev) => ({ ...prev, [q.id]: opt.value }))
                      }
                      className="mt-1 h-4 w-4 text-green-600 focus:ring-green-500"
                    />
                    <div>
                      <span className="font-medium text-gray-900">{opt.label}</span>
                      <p className="text-sm text-gray-500 mt-0.5">{opt.description}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </Card>
        ))}
      </div>

      {/* Footer */}
      <div className="mt-8 flex items-center justify-between">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!allAnswered}
          className="px-6 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Derive Defaults
        </button>
      </div>
    </div>
  );
}

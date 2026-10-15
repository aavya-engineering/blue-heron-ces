// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

interface ProvenanceSelectorProps {
  value: 'client_assertion' | 'operator_observation' | 'operator_inference' | 'assumption' | 'system_observation' | 'auto_collected';
  onChange: (value: any) => void;
}

export function ProvenanceSelector({ value, onChange }: ProvenanceSelectorProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Provenance (Source of Information)
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      >
        <option value="auto_collected">Automatically Collected</option>
        <option value="client_assertion">Client Assertion</option>
        <option value="operator_observation">Operator Observation</option>
        <option value="operator_inference">Operator Inference</option>
        <option value="assumption">Assumption</option>
        <option value="system_observation">System Observation</option>
      </select>
      <p className="mt-1 text-sm text-gray-500">
        Select how this information was obtained
      </p>
    </div>
  );
}

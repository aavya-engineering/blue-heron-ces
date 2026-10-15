// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import React, { useState } from 'react';
import { FormField } from '@/shared/components/Form/FormField';
import { Select } from '@/shared/components/Form/Select';
import { Card } from '@/shared/components/Display/Card';
import type { CustomerFormData } from '../types';

interface CustomerFormProps {
  onSubmit: (data: CustomerFormData) => void;
  onCancel?: () => void;
}

export function CustomerForm({ onSubmit, onCancel }: CustomerFormProps) {
  const [formData, setFormData] = useState<CustomerFormData>({
    name: '',
    email: '',
    phone: '',
    targetLevel: undefined,
  });

  const [errors, setErrors] = useState<Partial<Record<keyof CustomerFormData, string>>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    const newErrors: Partial<Record<keyof CustomerFormData, string>> = {};
    if (!formData.name.trim()) {
      newErrors.name = 'Customer name is required';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onSubmit(formData);
  };

  return (
    <Card title="Create New Customer">
      <form onSubmit={handleSubmit}>
        <FormField label="Customer Name" required error={errors.name}>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
            placeholder="Acme Corporation"
          />
        </FormField>

        <FormField label="Email" error={errors.email}>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
            placeholder="contact@acme.com"
          />
        </FormField>

        <FormField label="Phone" error={errors.phone}>
          <input
            type="tel"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
            placeholder="+1 (555) 123-4567"
          />
        </FormField>

        <FormField label="Target CMMC Level" help="Initial target level (can be refined in SIT)">
          <Select
            value={formData.targetLevel || ''}
            onChange={(value) =>
              setFormData({ ...formData, targetLevel: value as 'L1' | 'L2' | 'L3' })
            }
            options={[
              { value: 'L1', label: 'Level 1 - Foundational' },
              { value: 'L2', label: 'Level 2 - Advanced' },
              { value: 'L3', label: 'Level 3 - Expert' },
            ]}
            placeholder="Select target level"
          />
        </FormField>

        <div className="flex justify-end space-x-3 mt-6">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700"
          >
            Create Customer
          </button>
        </div>
      </form>
    </Card>
  );
}

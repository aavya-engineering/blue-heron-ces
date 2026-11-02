// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/**
 * Contracts — full CRUD UI for the 14-field Contract entity.
 * API: GET|POST /api/contracts, PUT|DELETE /api/contracts/:id
 * Offline notice when API is unreachable.
 *
 * For individual_contractor engagements, prime_ref is null —
 * contracts attach directly to the contractor party.
 * [validate with BHD — confirm prime_ref null semantics and party_id resolution]
 */
import { useState, useEffect } from 'react';
import { api } from '@/shared/api/musterApi';
import type { Contract, EngagementKind } from '@/shared/types/engagement';
import { validateContractForm, type ContractFormData, type ContractFormErrors } from './contractValidation';

interface ContractsPageProps {
  engagementKind: EngagementKind | null;
  /** Current party ID — used when creating contracts. */
  partyId: string | null;
}

const EMPTY_FORM: ContractFormData = {
  contract_number: '',
  program_name: '',
  cmmc_level_required: '',
  prime_ref: null,
  start_date: '',
  end_date: '',
  value_usd: '',
  cage_code: '',
  uei: '',
  contracting_office: '',
  classification_level: '',
  notes: '',
};

type FormMode = 'none' | 'create' | 'edit';

export default function ContractsPage({ engagementKind, partyId }: ContractsPageProps) {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [formMode, setFormMode] = useState<FormMode>('none');
  const [formData, setFormData] = useState<ContractFormData>(EMPTY_FORM);
  const [editId, setEditId] = useState<string | null>(null);
  const [errors, setErrors] = useState<ContractFormErrors>({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState('');

  const isIndividualContractor = engagementKind === 'individual_contractor';

  const loadContracts = async () => {
    setLoading(true);
    setOffline(false);
    const result = await api.get<Contract[]>('/contracts');
    if (!result.ok) {
      setOffline(true);
    } else {
      setContracts(result.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadContracts();
  }, []);

  const openCreate = () => {
    setFormData({
      ...EMPTY_FORM,
      party_id: partyId ?? undefined,
      prime_ref: isIndividualContractor ? null : undefined,
    });
    setErrors({});
    setEditId(null);
    setFormMode('create');
    setSubmitError('');
  };

  const openEdit = (c: Contract) => {
    setFormData({
      contract_number: c.contract_number,
      program_name: c.program_name,
      cmmc_level_required: c.cmmc_level_required,
      party_id: c.party_id,
      prime_ref: c.prime_ref,
      start_date: c.start_date ?? '',
      end_date: c.end_date ?? '',
      value_usd: c.value_usd ?? '',
      cage_code: c.cage_code ?? '',
      uei: c.uei ?? '',
      contracting_office: c.contracting_office ?? '',
      classification_level: c.classification_level ?? '',
      notes: c.notes ?? '',
    });
    setErrors({});
    setEditId(c.id);
    setFormMode('edit');
    setSubmitError('');
  };

  const cancelForm = () => {
    setFormMode('none');
    setEditId(null);
    setErrors({});
    setSubmitError('');
  };

  const handleField = (field: keyof ContractFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const submitForm = async () => {
    const errs = validateContractForm(formData);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setSubmitError('');

    const payload = {
      ...formData,
      cmmc_level_required: Number(formData.cmmc_level_required),
      value_usd: formData.value_usd !== '' ? Number(formData.value_usd) : undefined,
      party_id: partyId ?? formData.party_id,
      prime_ref: isIndividualContractor ? null : (formData.prime_ref ?? null),
    };

    if (formMode === 'create') {
      const result = await api.post<Contract>('/contracts', payload);
      if (!result.ok) {
        setSubmitError('Could not save contract — server unreachable.');
        return;
      }
      setContracts((prev) => [...prev, result.data]);
    } else if (formMode === 'edit' && editId) {
      const result = await api.put<Contract>(`/contracts/${editId}`, payload);
      if (!result.ok) {
        setSubmitError('Could not update contract — server unreachable.');
        return;
      }
      setContracts((prev) => prev.map((c) => (c.id === editId ? result.data : c)));
    }

    setFormMode('none');
    setEditId(null);
  };

  const confirmDelete = (id: string) => setDeleteConfirmId(id);

  const executeDelete = async (id: string) => {
    const result = await api.delete(`/contracts/${id}`);
    if (!result.ok) {
      setSubmitError('Could not delete contract — server unreachable.');
    } else {
      setContracts((prev) => prev.filter((c) => c.id !== id));
    }
    setDeleteConfirmId(null);
  };

  return (
    <div className="page">
      <div className="ces-titleblock" style={{ marginBottom: 16 }}>
        <span className="tb-title">Contracts</span>
        {isIndividualContractor && (
          <span className="tb-designator">INDIVIDUAL CONTRACTOR</span>
        )}
      </div>

      {isIndividualContractor && (
        <p className="eyebrow" style={{ marginBottom: 12 }}>
          Contracts attach directly to this contractor party (no prime reference).{' '}
          {/* [validate with BHD] */}
        </p>
      )}

      {offline && (
        <div className="callout-warning" data-testid="contracts-offline-notice">
          API unreachable — contract data not loaded. Check your connection and{' '}
          <button
            style={{ background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', padding: 0, color: 'inherit', font: 'inherit' }}
            onClick={() => void loadContracts()}
          >
            retry
          </button>
          .
        </div>
      )}

      {submitError && (
        <p className="form-error" data-testid="contracts-submit-error">
          {submitError}
        </p>
      )}

      {!offline && !loading && formMode === 'none' && (
        <button
          className="btn btn-primary"
          data-testid="contracts-add-btn"
          onClick={openCreate}
          style={{ marginBottom: 16 }}
        >
          + Add Contract
        </button>
      )}

      {loading && <p>Loading contracts…</p>}

      {!loading && !offline && contracts.length === 0 && formMode === 'none' && (
        <p style={{ color: 'var(--co-text-muted)', fontSize: 14 }}>No contracts on file.</p>
      )}

      {!loading && !offline && contracts.length > 0 && formMode === 'none' && (
        <table className="data-table" data-testid="contracts-table">
          <thead>
            <tr>
              <th>Contract #</th>
              <th>Program</th>
              <th>CMMC Lvl</th>
              {!isIndividualContractor && <th>Prime Ref</th>}
              <th>Start</th>
              <th>End</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.id} data-testid={`contract-row-${c.id}`}>
                <td>{c.contract_number}</td>
                <td>{c.program_name}</td>
                <td>{c.cmmc_level_required}</td>
                {!isIndividualContractor && <td>{c.prime_ref ?? '—'}</td>}
                <td>{c.start_date ?? '—'}</td>
                <td>{c.end_date ?? '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button
                    className="btn"
                    onClick={() => openEdit(c)}
                    style={{ marginRight: 8 }}
                    aria-label={`Edit contract ${c.contract_number}`}
                  >
                    Edit
                  </button>
                  {deleteConfirmId === c.id ? (
                    <>
                      <button
                        className="btn"
                        style={{ color: 'var(--co-violation)', marginRight: 4 }}
                        onClick={() => void executeDelete(c.id)}
                        aria-label={`Confirm delete contract ${c.contract_number}`}
                      >
                        Confirm
                      </button>
                      <button className="btn" onClick={() => setDeleteConfirmId(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn"
                      onClick={() => confirmDelete(c.id)}
                      aria-label={`Delete contract ${c.contract_number}`}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(formMode === 'create' || formMode === 'edit') && (
        <section data-testid="contract-form">
          <h3 style={{ marginBottom: 12, fontSize: 15, fontWeight: 700 }}>
            {formMode === 'create' ? 'New Contract' : 'Edit Contract'}
          </h3>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 200px' }}>
              <label className="field-label">
                Contract Number <span className="req">*</span>
                <input
                  type="text"
                  value={String(formData.contract_number ?? '')}
                  onChange={(e) => handleField('contract_number', e.target.value)}
                  placeholder="W911NF-24-C-0001"
                  data-testid="contract-number-input"
                />
              </label>
              {errors.contract_number && (
                <p className="form-error">{errors.contract_number}</p>
              )}
            </div>

            <div className="field" style={{ flex: '1 1 200px' }}>
              <label className="field-label">
                Program Name <span className="req">*</span>
                <input
                  type="text"
                  value={String(formData.program_name ?? '')}
                  onChange={(e) => handleField('program_name', e.target.value)}
                  placeholder="CUI Cyber Program"
                  data-testid="program-name-input"
                />
              </label>
              {errors.program_name && (
                <p className="form-error">{errors.program_name}</p>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '0 0 140px' }}>
              <label className="field-label">
                CMMC Level Required <span className="req">*</span>
                <select
                  value={String(formData.cmmc_level_required ?? '')}
                  onChange={(e) => handleField('cmmc_level_required', e.target.value)}
                  data-testid="cmmc-level-select"
                >
                  <option value="">Select…</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                </select>
              </label>
              {errors.cmmc_level_required && (
                <p className="form-error">{errors.cmmc_level_required}</p>
              )}
            </div>

            {!isIndividualContractor && (
              <div className="field" style={{ flex: '1 1 200px' }}>
                <label className="field-label">
                  Prime Reference
                  <input
                    type="text"
                    value={String(formData.prime_ref ?? '')}
                    onChange={(e) => handleField('prime_ref', e.target.value)}
                    placeholder="Prime contract #"
                  />
                </label>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 140px' }}>
              <label className="field-label">
                Start Date
                <input
                  type="date"
                  value={String(formData.start_date ?? '')}
                  onChange={(e) => handleField('start_date', e.target.value)}
                />
              </label>
            </div>
            <div className="field" style={{ flex: '1 1 140px' }}>
              <label className="field-label">
                End Date
                <input
                  type="date"
                  value={String(formData.end_date ?? '')}
                  onChange={(e) => handleField('end_date', e.target.value)}
                />
              </label>
            </div>
            <div className="field" style={{ flex: '1 1 140px' }}>
              <label className="field-label">
                Contract Value (USD)
                <input
                  type="number"
                  value={String(formData.value_usd ?? '')}
                  onChange={(e) => handleField('value_usd', e.target.value)}
                  placeholder="0"
                  min="0"
                />
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 140px' }}>
              <label className="field-label">
                CAGE Code
                <input
                  type="text"
                  value={String(formData.cage_code ?? '')}
                  onChange={(e) => handleField('cage_code', e.target.value)}
                  placeholder="5-char CAGE"
                />
              </label>
            </div>
            <div className="field" style={{ flex: '1 1 160px' }}>
              <label className="field-label">
                UEI
                <input
                  type="text"
                  value={String(formData.uei ?? '')}
                  onChange={(e) => handleField('uei', e.target.value)}
                  placeholder="12-char UEI"
                />
              </label>
            </div>
          </div>

          <div className="field">
            <label className="field-label">
              Contracting Office
              <input
                type="text"
                value={String(formData.contracting_office ?? '')}
                onChange={(e) => handleField('contracting_office', e.target.value)}
                placeholder="e.g., ACC-Aberdeen"
              />
            </label>
          </div>

          <div className="field">
            <label className="field-label">
              Classification Level
              <input
                type="text"
                value={String(formData.classification_level ?? '')}
                onChange={(e) => handleField('classification_level', e.target.value)}
                placeholder="e.g., Unclassified CUI"
              />
            </label>
          </div>

          <div className="field">
            <label className="field-label">
              Notes
              <input
                type="text"
                value={String(formData.notes ?? '')}
                onChange={(e) => handleField('notes', e.target.value)}
                placeholder="Optional notes"
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <button
              className="btn btn-primary"
              onClick={() => void submitForm()}
              data-testid="contract-submit-btn"
            >
              {formMode === 'create' ? 'Create Contract' : 'Save Changes'}
            </button>
            <button className="btn" onClick={cancelForm}>
              Cancel
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

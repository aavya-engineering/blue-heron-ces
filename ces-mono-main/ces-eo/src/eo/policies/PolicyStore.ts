// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { PolicyDocument } from 'ces-shared/types/policy';
import { getCesRepository } from 'ces-shared/persistence/node';

// G2: PolicyDocuments persist in the unified SQLite repository, tenant-isolated by tenantSlug,
// replacing {storageRoot}/policies/{tenantSlug}/{domain}.json. See ADR-002. Each document keeps a
// stable per-tenant key derived from its domain (the old filename) so save() upserts in place.
const POLICY_COLLECTION = 'eo_policies';

/**
 * Stores and retrieves PolicyDocuments per tenant (unified repository, tenant-scoped).
 *
 * In-memory cache: Map<tenantSlug, PolicyDocument[]>
 *   - Populated on first load() per tenant
 *   - Invalidated (cleared) on save()
 */
export class PolicyStore {
  private readonly storageRoot: string;
  private readonly cache: Map<string, PolicyDocument[]> = new Map();

  constructor(storageRoot: string) {
    this.storageRoot = storageRoot;
  }

  private get repo() {
    return getCesRepository();
  }

  /**
   * Returns the per-tenant record key for a policy document. Mirrors the old filename rule
   * (family docs keyed by domain, special docs by lowercased name) so saves upsert in place.
   * Namespaced by tenantSlug because the collection PK is global.
   */
  private recordKey(tenantSlug: string, policy: PolicyDocument): string {
    const domain = policy.domain.toUpperCase();
    const specialDocs = ['SSP', 'POAM', 'IRP'];
    const base = specialDocs.includes(domain) ? domain.toLowerCase() : domain;
    return `${tenantSlug}:${base}`;
  }

  /**
   * Persists an array of PolicyDocuments for a tenant. Each document is upserted by its
   * stable per-tenant key. Invalidates the cache for this tenant. Returns the record keys.
   */
  save(tenantSlug: string, policies: PolicyDocument[]): string[] {
    const writtenKeys: string[] = [];

    for (const policy of policies) {
      const id = this.recordKey(tenantSlug, policy);
      this.repo.put(POLICY_COLLECTION, { id, ces: { tenantSlug }, data: policy });
      writtenKeys.push(id);
    }

    // Invalidate cache for this tenant
    this.cache.delete(tenantSlug);

    return writtenKeys;
  }

  /**
   * Loads all PolicyDocuments for a tenant.
   * Returns cached results if available; otherwise reads from the repository.
   */
  load(tenantSlug: string): PolicyDocument[] {
    const cached = this.cache.get(tenantSlug);
    if (cached) {
      return cached;
    }

    const policies = this.repo
      .list<PolicyDocument>(POLICY_COLLECTION, { tenantSlug })
      .map((r) => r.data);

    // Populate cache
    this.cache.set(tenantSlug, policies);

    return policies;
  }

  /**
   * Returns all policies for a tenant whose nist_controls array includes the given NIST ref.
   * Uses exact string match via Array.includes().
   */
  findByNistControl(tenantSlug: string, nistRef: string): PolicyDocument[] {
    const policies = this.load(tenantSlug);
    return policies.filter(p => p.nist_controls.includes(nistRef));
  }

  /**
   * Lists policy metadata for a tenant (domain, title, completeness).
   */
  list(tenantSlug: string): Array<{
    domain: string;
    title: string;
    completeness: number;
    template_id: string;
  }> {
    const policies = this.load(tenantSlug);
    return policies.map(p => ({
      domain: p.domain,
      title: p.title,
      completeness: p.completeness,
      template_id: p.template_id,
    }));
  }
}

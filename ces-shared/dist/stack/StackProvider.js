// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.
export class StackCapabilityError extends Error {
    constructor(message) {
        super(`stack capability: ${message}`);
        this.name = 'StackCapabilityError';
    }
}
/** Validate a declared capability object. Throws StackCapabilityError listing what's missing. */
export function validateStackCapabilities(raw) {
    if (typeof raw !== 'object' || raw === null) {
        throw new StackCapabilityError('capabilities must be an object');
    }
    const c = raw;
    const missing = [];
    const str = (k) => {
        if (typeof c[k] !== 'string' || c[k].length === 0)
            missing.push(k);
    };
    str('id');
    str('displayName');
    str('controlSignalRegistryId');
    str('evaluatorSetId');
    str('vendorPlaybookId');
    str('techStackMapId');
    str('sspNarrativeSourceId');
    const endpoints = c.cloudEndpoints;
    if (!endpoints || typeof endpoints !== 'object')
        missing.push('cloudEndpoints');
    else {
        if (typeof endpoints.graph !== 'string' || !endpoints.graph)
            missing.push('cloudEndpoints.graph');
        if (typeof endpoints.login !== 'string' || !endpoints.login)
            missing.push('cloudEndpoints.login');
    }
    const conv = c.conventions;
    if (!conv || typeof conv !== 'object')
        missing.push('conventions');
    else {
        if (typeof conv.cloudEnvironment !== 'string' || !conv.cloudEnvironment)
            missing.push('conventions.cloudEnvironment');
        if (typeof conv.defaultLocation !== 'string' || !conv.defaultLocation)
            missing.push('conventions.defaultLocation');
        if (typeof conv.identityModel !== 'string' || !conv.identityModel)
            missing.push('conventions.identityModel');
        if (!Array.isArray(conv.infrastructureModels))
            missing.push('conventions.infrastructureModels');
    }
    if (missing.length > 0) {
        throw new StackCapabilityError(`missing/invalid required field(s): ${missing.join(', ')}`);
    }
    return raw;
}
/** A registry of stack providers keyed by stack id. */
export class StackRegistry {
    providers = new Map();
    /** Register a provider (validates its capabilities first). Last registration for an id wins. */
    register(provider) {
        validateStackCapabilities(provider.capabilities);
        this.providers.set(provider.capabilities.id, provider);
    }
    has(id) {
        return this.providers.has(id);
    }
    get(id) {
        const p = this.providers.get(id);
        if (!p) {
            throw new StackCapabilityError(`no provider registered for stack "${id}" (registered: ${this.ids().join(', ') || 'none'})`);
        }
        return p;
    }
    ids() {
        return [...this.providers.keys()];
    }
}
/** The reference stack id. Used as the default so existing (Microsoft-only) deployments are unchanged. */
export const DEFAULT_STACK_ID = 'microsoft-gcc-high';
/**
 * Resolve the active stack id from existing config (reuses the TenantConfig seam that already
 * carries infrastructure_model — does NOT introduce a parallel selector). Absent → Microsoft.
 */
export function resolveStackId(config) {
    const s = config?.stack;
    return typeof s === 'string' && s.length > 0 ? s : DEFAULT_STACK_ID;
}
//# sourceMappingURL=StackProvider.js.map
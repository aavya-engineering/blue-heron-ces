// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EVC.4 / K4: the Tenant Manifest (TM) boundary on the SSP.
 *
 * Muster writes the TM as `{ ces, tenant_manifest: { ..., boundary_zones } }` and, since MG-08,
 * `boundary_zones` is ces-shared's `BoundaryZonesSchema` shape
 * (`{ cui_boundary_version, definitions: [{ key, value, type }] }`).
 *
 * W2.5: those definitions are the CUI-boundary questionnaire's answers, so they become
 * boundary FACTS, not zones. Zones are built from the TM `tenant_identity`, the TM `assets[]`
 * and the Infrastructure Manifest (IM) network. The older array shape of `boundary_zones`
 * (strings or records naming zones) is still read as zones.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import { BoundaryZonesSchema } from 'ces-shared/types/mission-plan';
import type { AuthorizationBoundary, BoundaryFact } from '../../shared/types/ssp.types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOUNDARY_TEMPLATE_PATH = path.resolve(__dirname, '../../shared/data/snippet-templates/authorization-boundary.hbs');

export interface TmBoundaryZone {
  name: string;
  type?: string;
  description: string;
  components: string[];
}

export interface TmBoundary {
  cuiBoundaryVersion?: string;
  zones: TmBoundaryZone[];
  /** W2.5: the questionnaire answers (`boundary_zones.definitions[]`), one per key. */
  facts: BoundaryFact[];
}

/** Unwrap Muster's `{ tenant_manifest: {...} }` envelope when present. */
export function unwrapTenantManifest(raw: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  const inner = raw.tenant_manifest;
  return inner && typeof inner === 'object' && !Array.isArray(inner) ? inner as Record<string, unknown> : raw;
}

function valueText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(v => valueText(v)).join(', ');
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return String(o.name ?? o.asset_id ?? o.id ?? JSON.stringify(o));
  }
  return String(value);
}

function listItems(value: unknown): string[] {
  return Array.isArray(value) ? value.map(v => valueText(v)).filter(s => s.length > 0) : [];
}

const CLOUD_ENVIRONMENT_LABELS: Record<string, string> = { gcc_high: 'GCC High', gcc: 'GCC', dod: 'DoD', commercial: 'Commercial' };
const SERVICE_LABELS: Record<string, string> = {
  exchange_online: 'Exchange Online',
  sharepoint_online: 'SharePoint Online',
  teams: 'Microsoft Teams',
  intune: 'Microsoft Intune',
  defender_for_endpoint: 'Microsoft Defender for Endpoint',
  defender_for_office_365: 'Microsoft Defender for Office 365',
  defender_for_identity: 'Microsoft Defender for Identity',
  purview_compliance: 'Microsoft Purview',
  sentinel: 'Microsoft Sentinel',
};

type Resource = { resource_type?: string; name?: string; properties?: Record<string, unknown> };

/** W2.1 / W2.5: the IM network resources by kind (pushed snake_case types and ARM types). */
export function classifyNetwork(im: Record<string, unknown> | undefined): {
  vnets: Resource[]; subnets: Resource[]; privateEndpoints: Resource[]; nsgs: Resource[];
} {
  const net = Array.isArray(im?.network) ? (im!.network as Resource[]) : [];
  const is = (r: Resource, snake: string, arm: string) => r.resource_type === snake || (r.resource_type ?? '').includes(arm);
  return {
    vnets: net.filter(r => is(r, 'virtual_network', 'virtualNetworks')),
    subnets: net.filter(r => is(r, 'subnet', '/subnets')),
    privateEndpoints: net.filter(r => is(r, 'private_endpoint', 'privateEndpoints')),
    nsgs: net.filter(r => is(r, 'network_security_group', 'networkSecurityGroups')),
  };
}

function tenantZone(tm: Record<string, unknown> | undefined): TmBoundaryZone[] {
  const id = tm?.tenant_identity as Record<string, unknown> | undefined;
  if (!id || (!id.cloud_environment && !id.service_activations)) return [];
  const env = typeof id.cloud_environment === 'string' ? (CLOUD_ENVIRONMENT_LABELS[id.cloud_environment] ?? id.cloud_environment) : '';
  const parts = [
    id.display_name ? `Tenant ${valueText(id.display_name)}` : '',
    id.tenant_id ? `tenant id ${valueText(id.tenant_id)}` : '',
    id.primary_domain ? `primary domain ${valueText(id.primary_domain)}` : '',
    id.cloud_environment ? `cloud environment ${valueText(id.cloud_environment)}` : '',
    id.primary_sku ? `licence ${valueText(id.primary_sku)}` : '',
  ].filter(p => p.length > 0);
  const services = Object.entries((id.service_activations ?? {}) as Record<string, unknown>)
    .filter(([, on]) => on === true)
    .map(([k]) => SERVICE_LABELS[k] ?? k);
  return [{
    name: env ? `Microsoft 365 ${env} tenant` : 'Microsoft 365 tenant',
    type: 'tenant',
    description: parts.join('; '),
    components: services,
  }];
}

function assetZones(tm: Record<string, unknown> | undefined): TmBoundaryZone[] {
  const assets = Array.isArray(tm?.assets) ? (tm!.assets as Array<Record<string, unknown>>) : [];
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const a of assets) {
    const name = [a.scope_category, a.asset_type]
      .filter(v => typeof v === 'string' && v.length > 0)
      .map(v => String(v).replace(/_/g, ' '))
      .join(' ');
    if (!name) continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(a);
  }
  return Array.from(groups.entries()).map(([name, list]) => ({
    name,
    type: 'tm_assets',
    description: `${list.length} asset(s) in the Tenant Manifest`,
    components: list.map(a => {
      const tags = (Array.isArray(a.tags) ? a.tags : []).filter(t => t !== 'tcp').map(String);
      const what = valueText(a.owner) || valueText(a.asset_id);
      return tags.length > 0 ? `${tags.join(', ')}: ${what}` : what;
    }),
  }));
}

function networkZones(im: Record<string, unknown> | undefined): TmBoundaryZone[] {
  const { vnets, subnets, privateEndpoints, nsgs } = classifyNetwork(im);
  return vnets.map((v, i) => {
    const props = v.properties ?? {};
    const nested = Array.isArray(props.subnets)
      ? (props.subnets as Array<{ name: string; addressPrefix?: string; address_prefix?: string }>)
      : [];
    const own = subnets.filter(s => s.properties?.vnet === v.name || (vnets.length === 1 && !s.properties?.vnet));
    const subnetNames = new Set([...nested.map(s => s.name), ...own.map(s => s.name ?? '')]);
    const pes = privateEndpoints.filter(p => vnets.length === 1 || subnetNames.has(valueText(p.properties?.subnet)));
    const space = listItems(props.address_space ?? props.addressSpace);
    return {
      name: `Azure virtual network ${v.name ?? ''}`.trim(),
      type: 'network',
      description: space.length > 0 ? `Address space ${space.join(', ')}` : 'Virtual network from the Infrastructure Manifest',
      components: [
        ...nested.map(s => {
          const prefix = s.addressPrefix ?? s.address_prefix;
          return `Subnet ${s.name}${prefix ? ` (${prefix})` : ''}`;
        }),
        ...own.map(s => `Subnet ${s.name}${s.properties?.address_prefix ? ` (${valueText(s.properties.address_prefix)})` : ''}`),
        ...pes.map(p => {
          const sub = p.properties?.target_sub_resource;
          return `Private endpoint ${p.name} to ${valueText(p.properties?.target_resource)}${sub ? ` (${valueText(sub)})` : ''}`;
        }),
        ...(i === 0 ? nsgs.map(n => `Network security group ${n.name}`) : []),
      ],
    };
  });
}

/**
 * Parse the TM (may still be wrapped) and the unwrapped IM into SSP boundary zones and facts.
 * Zones: legacy array-shaped `boundary_zones`, `tenant_identity`, `assets[]`, the IM network.
 * Facts: the MG-08 `boundary_zones.definitions[]` (questionnaire keys are never zones).
 */
export function parseTmBoundary(tmRaw: Record<string, unknown> | undefined, im?: Record<string, unknown>): TmBoundary {
  const tm = unwrapTenantManifest(tmRaw);
  const bz = tm?.boundary_zones;
  const zones: TmBoundaryZone[] = [];
  const facts: BoundaryFact[] = [];
  let cuiBoundaryVersion: string | undefined;

  if (Array.isArray(bz)) {
    for (const z of bz) {
      if (typeof z === 'string') {
        zones.push({ name: z, description: '', components: [] });
      } else if (z && typeof z === 'object') {
        const r = z as Record<string, unknown>;
        const name = valueText(r.name ?? r.zone_name ?? r.key ?? r.id);
        if (!name) continue;
        zones.push({
          name,
          type: typeof r.type === 'string' ? r.type : undefined,
          description: valueText(r.description ?? r.value),
          components: listItems(r.components ?? r.assets ?? r.value),
        });
      }
    }
  } else if (bz) {
    const parsed = BoundaryZonesSchema.safeParse(bz);
    if (parsed.success) {
      cuiBoundaryVersion = parsed.data.cui_boundary_version;
      for (const d of parsed.data.definitions) {
        facts.push({ key: d.key, value: valueText(d.value), type: d.type });
      }
    }
  }

  zones.push(...tenantZone(tm), ...assetZones(tm), ...networkZones(im));
  return { ...(cuiBoundaryVersion ? { cuiBoundaryVersion } : {}), zones, facts };
}

/** The boundary diagram source (Appendix C / §2.1) built from the TM zones. */
export function tmBoundaryDiagram(boundary: TmBoundary): AuthorizationBoundary {
  const label = (s: string) => s.replace(/"/g, "'");
  return {
    zones: boundary.zones.map(z => ({
      name: z.name,
      description: z.description,
      components: (z.components.length > 0 ? z.components : (z.description ? [z.description] : [])).map(label),
    })),
    externalConnections: [],
  };
}

let compiled: HandlebarsTemplateDelegate | null = null;

/** Render the boundary description from the SSP template (token: `{{boundary_zones}}`). */
export function renderBoundaryDescription(boundary: TmBoundary, systemName: string): string {
  if (!compiled) {
    compiled = Handlebars.compile(fs.readFileSync(BOUNDARY_TEMPLATE_PATH, 'utf-8'), { noEscape: true });
  }
  return compiled({
    systemName,
    zoneCount: boundary.zones.length,
    cuiBoundaryVersion: boundary.cuiBoundaryVersion,
    boundary_zones: boundary.zones.map(z => z.name).join(', '),
  }).trim();
}

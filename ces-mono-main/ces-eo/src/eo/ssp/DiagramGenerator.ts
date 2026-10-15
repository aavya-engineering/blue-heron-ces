// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { InfraManifest, InfraResource } from 'ces-shared/types/ssp';
import type { AuthorizationBoundary, CuiDataFlows, SystemComponent } from '../../shared/types/ssp.types.js';

/**
 * Generates Mermaid diagram syntax from infrastructure manifest data.
 * Stateless class — no constructor dependencies.
 */
export class DiagramGenerator {

  generateNetworkTopology(infraManifest: InfraManifest): string {
    if (!infraManifest.network || infraManifest.network.length === 0) {
      return '[No network topology data available — infrastructure manifest is empty]';
    }

    const lines: string[] = ['flowchart TB'];

    const vnets: InfraResource[] = [];
    const nsgs: InfraResource[] = [];
    const subnets: InfraResource[] = [];
    const others: InfraResource[] = [];

    for (const resource of infraManifest.network) {
      if (resource.resource_type.includes('virtualNetworks')) {
        vnets.push(resource);
      } else if (resource.resource_type.includes('networkSecurityGroups')) {
        nsgs.push(resource);
      } else if (resource.resource_type.includes('subnets')) {
        subnets.push(resource);
      } else {
        others.push(resource);
      }
    }

    // Render VNets as subgraphs
    for (const vnet of vnets) {
      const vnetId = this.sanitizeId(vnet.name);
      lines.push(`  subgraph ${vnetId} ["VNet: ${vnet.name}"]`);

      // Parse subnets from VNet properties
      const vnetSubnets = vnet.properties?.subnets as Array<{ name: string; addressPrefix?: string }> | undefined;
      if (vnetSubnets && Array.isArray(vnetSubnets)) {
        for (const subnet of vnetSubnets) {
          const subnetId = this.sanitizeId(subnet.name);
          const label = subnet.addressPrefix ? `${subnet.name}<br/>${subnet.addressPrefix}` : subnet.name;
          lines.push(`    ${subnetId}["${label}"]`);
        }
      }

      lines.push('  end');
    }

    // Render standalone subnets (not inside VNet properties)
    for (const subnet of subnets) {
      const subnetId = this.sanitizeId(subnet.name);
      lines.push(`  ${subnetId}["Subnet: ${subnet.name}"]`);
    }

    // Render NSGs
    for (const nsg of nsgs) {
      const nsgId = this.sanitizeId(nsg.name);
      lines.push(`  ${nsgId}{{"NSG: ${nsg.name}"}}`);

      // Connect NSG to associated subnet if depends_on is set
      for (const dep of nsg.depends_on) {
        const depId = this.sanitizeId(dep);
        lines.push(`  ${nsgId} --> ${depId}`);
      }
    }

    // Render other network resources (application gateways, load balancers, etc.)
    for (const resource of others) {
      const nodeStr = this.formatMermaidNode(resource);
      lines.push(`  ${nodeStr}`);

      for (const dep of resource.depends_on) {
        const resId = this.sanitizeId(resource.name);
        const depId = this.sanitizeId(dep);
        lines.push(`  ${resId} --> ${depId}`);
      }
    }

    return lines.join('\n');
  }

  generateDataFlowDiagram(cuiDataFlows: CuiDataFlows): string {
    if (!cuiDataFlows || (cuiDataFlows.ingress.length === 0 && cuiDataFlows.egress.length === 0 && cuiDataFlows.internal.length === 0)) {
      return '[CUI data flows not yet defined in SSP generation params]';
    }

    const lines: string[] = ['sequenceDiagram'];
    const participants = new Set<string>();

    // Collect all participants
    for (const flow of cuiDataFlows.ingress) {
      participants.add(flow.source);
      participants.add(flow.destination);
    }
    for (const flow of cuiDataFlows.egress) {
      participants.add(flow.source);
      participants.add(flow.destination);
    }
    for (const flow of cuiDataFlows.internal) {
      participants.add(flow.source);
      participants.add(flow.destination);
    }

    // Declare participants
    for (const p of participants) {
      lines.push(`  participant ${this.sanitizeId(p)} as ${p}`);
    }

    // Ingress flows
    if (cuiDataFlows.ingress.length > 0) {
      lines.push('  Note over ' + this.sanitizeId(cuiDataFlows.ingress[0].source) + ': CUI Ingress');
      for (const flow of cuiDataFlows.ingress) {
        lines.push(`  ${this.sanitizeId(flow.source)}->>+${this.sanitizeId(flow.destination)}: ${flow.cuiType} (${flow.protocol})`);
      }
    }

    // Internal flows
    if (cuiDataFlows.internal.length > 0) {
      lines.push('  Note over ' + this.sanitizeId(cuiDataFlows.internal[0].source) + ': Internal Processing');
      for (const flow of cuiDataFlows.internal) {
        lines.push(`  ${this.sanitizeId(flow.source)}->>${this.sanitizeId(flow.destination)}: ${flow.cuiType}`);
      }
    }

    // Egress flows
    if (cuiDataFlows.egress.length > 0) {
      lines.push('  Note over ' + this.sanitizeId(cuiDataFlows.egress[0].source) + ': CUI Egress');
      for (const flow of cuiDataFlows.egress) {
        lines.push(`  ${this.sanitizeId(flow.source)}->>-${this.sanitizeId(flow.destination)}: ${flow.cuiType} (${flow.protocol})`);
      }
    }

    return lines.join('\n');
  }

  generateAuthorizationBoundary(authBoundary: AuthorizationBoundary): string {
    if (!authBoundary || !authBoundary.zones || authBoundary.zones.length === 0) {
      return '[Authorization boundary not yet defined in SSP generation params]';
    }

    const lines: string[] = ['graph TB'];

    // Render zones as subgraphs
    for (const zone of authBoundary.zones) {
      const zoneId = this.sanitizeId(zone.name);
      lines.push(`  subgraph ${zoneId} ["Zone: ${zone.name}"]`);
      lines.push(`    direction TB`);

      for (const component of zone.components) {
        const compId = this.sanitizeId(component);
        lines.push(`    ${compId}["${component}"]`);
      }

      lines.push('  end');
    }

    // External connections outside all subgraphs
    if (authBoundary.externalConnections && authBoundary.externalConnections.length > 0) {
      for (const ext of authBoundary.externalConnections) {
        const extId = this.sanitizeId(ext);
        lines.push(`  ${extId}(("${ext}"))`);
      }

      // Connect external to first zone
      if (authBoundary.zones.length > 0) {
        const firstZoneComponents = authBoundary.zones[0].components;
        if (firstZoneComponents.length > 0) {
          for (const ext of authBoundary.externalConnections) {
            const extId = this.sanitizeId(ext);
            const targetId = this.sanitizeId(firstZoneComponents[0]);
            lines.push(`  ${extId} --> ${targetId}`);
          }
        }
      }
    }

    return lines.join('\n');
  }

  private formatMermaidNode(component: SystemComponent): string {
    const id = this.sanitizeId(component.name);
    const label = `${component.name}<br/>${component.resource_type}`;

    // Use different shapes based on resource type
    if (component.resource_type.includes('storage') || component.resource_type.includes('Storage')) {
      return `${id}[("${label}")]`;
    }
    if (component.resource_type.includes('external') || component.resource_type.includes('cloud')) {
      return `${id}(("${label}"))`;
    }
    return `${id}["${label}"]`;
  }

  private sanitizeId(name: string): string {
    return name.replace(/[^a-zA-Z0-9]/g, '_');
  }
}

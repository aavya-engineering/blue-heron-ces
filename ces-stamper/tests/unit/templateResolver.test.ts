// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { resolveTemplate } from '../../src/utils/templateResolver';

describe('templateResolver', () => {
  describe('basic variable interpolation', () => {
    it('should resolve string variables', () => {
      const template = 'Hello {name}!';
      const variables = { name: 'World' };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('Hello World!');
    });

    it('should resolve number variables', () => {
      const template = 'You have {count} items';
      const variables = { count: 42 };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('You have 42 items');
    });

    it('should resolve boolean variables', () => {
      const template = 'Is enabled: {enabled}';
      const variables = { enabled: true };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('Is enabled: true');
    });

    it('should resolve multiple variables', () => {
      const template = '{greeting} {name}, you have {count} messages';
      const variables = { greeting: 'Hello', name: 'Alice', count: 5 };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('Hello Alice, you have 5 messages');
    });

    it('should resolve the same variable multiple times', () => {
      const template = '{name} likes {name}';
      const variables = { name: 'Bob' };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('Bob likes Bob');
    });
  });

  describe('missing variables', () => {
    it('should leave unresolved variables in non-strict mode', () => {
      const template = 'Hello {name}, your id is {userId}';
      const variables = { name: 'Charlie' };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('Hello Charlie, your id is {userId}');
    });

    it('should throw error for missing variables in strict mode', () => {
      const template = 'Hello {name}';
      const variables = {};

      expect(() => {
        resolveTemplate(template, variables, { strict: true });
      }).toThrow('Missing variable: name');
    });

    it('should include variable name in error message', () => {
      const template = 'Value: {missingVar}';
      const variables = {};

      expect(() => {
        resolveTemplate(template, variables, { strict: true });
      }).toThrow(/missingVar/);
    });
  });

  describe('special characters and edge cases', () => {
    it('should handle variables with underscores', () => {
      const template = 'Resource: {resource_group}';
      const variables = { resource_group: 'test-rg' };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('Resource: test-rg');
    });

    it('should handle variables with numbers', () => {
      const template = 'Var1: {var1}, Var2: {var2}';
      const variables = { var1: 'a', var2: 'b' };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('Var1: a, Var2: b');
    });

    it('should handle empty string variables', () => {
      const template = 'Value: "{value}"';
      const variables = { value: '' };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('Value: ""');
    });

    it('should handle variables with special characters in values', () => {
      const template = 'Command: {cmd}';
      const variables = { cmd: 'Get-MgUser -Filter "displayName eq \'Test\'"' };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('Command: Get-MgUser -Filter "displayName eq \'Test\'"');
    });

    it('should not resolve non-scalar values', () => {
      const template = 'Object: {obj}';
      const variables = { obj: { nested: 'value' } };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('Object: {obj}');
    });

    it('should not resolve array values', () => {
      const template = 'Array: {arr}';
      const variables = { arr: [1, 2, 3] };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('Array: {arr}');
    });

    it('should handle zero as a valid number', () => {
      const template = 'Count: {count}';
      const variables = { count: 0 };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('Count: 0');
    });

    it('should handle false as a valid boolean', () => {
      const template = 'Enabled: {enabled}';
      const variables = { enabled: false };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('Enabled: false');
    });
  });

  describe('complex templates', () => {
    it('should resolve PowerShell command templates', () => {
      const template = 'New-AzResourceGroup -Name {resourceGroup} -Location {location}';
      const variables = { resourceGroup: 'rg-test', location: 'usgovvirginia' };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('New-AzResourceGroup -Name rg-test -Location usgovvirginia');
    });

    it('should resolve Graph API query templates', () => {
      const template = '/v1.0/users/{userId}/mailboxSettings';
      const variables = { userId: 'user@example.gov' };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('/v1.0/users/user@example.gov/mailboxSettings');
    });

    it('should resolve Azure CLI command templates', () => {
      const template = 'az keyvault create --name {kvName} --resource-group {rg} --location {loc}';
      const variables = { kvName: 'kv-test', rg: 'rg-test', loc: 'usgovvirginia' };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('az keyvault create --name kv-test --resource-group rg-test --location usgovvirginia');
    });

    it('should handle templates with no variables', () => {
      const template = 'Get-MgUser -All';
      const variables = {};

      const result = resolveTemplate(template, variables);

      expect(result).toBe('Get-MgUser -All');
    });

    it('should handle empty template', () => {
      const template = '';
      const variables = { name: 'test' };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('');
    });

    it('should handle template with only variable placeholders', () => {
      const template = '{var1}{var2}{var3}';
      const variables = { var1: 'a', var2: 'b', var3: 'c' };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('abc');
    });

    it('should handle curly braces in text when variable exists', () => {
      const template = 'Command: Get-{resource} | Out-File';
      const variables = { resource: 'MgUser' };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('Command: Get-MgUser | Out-File');
    });
  });

  describe('real-world scenarios', () => {
    it('should resolve Key Vault URI template', () => {
      const template = 'https://{kvName}.vault.usgovcloudapi.net/';
      const variables = { kvName: 'kv-cmmc-prod' };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('https://kv-cmmc-prod.vault.usgovcloudapi.net/');
    });

    it('should resolve Storage Account connection string', () => {
      const template = 'DefaultEndpointsProtocol=https;AccountName={storageAccountName};AccountKey={accountKey};EndpointSuffix=core.usgovcloudapi.net';
      const variables = {
        storageAccountName: 'stcmmcprod',
        accountKey: 'fake-key-12345'
      };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('DefaultEndpointsProtocol=https;AccountName=stcmmcprod;AccountKey=fake-key-12345;EndpointSuffix=core.usgovcloudapi.net');
    });

    it('should resolve subscription resource ID template', () => {
      const template = '/subscriptions/{subscriptionId}/resourceGroups/{resourceGroup}/providers/Microsoft.KeyVault/vaults/{kvName}';
      const variables = {
        subscriptionId: 'sub-123',
        resourceGroup: 'rg-cmmc',
        kvName: 'kv-cmmc'
      };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('/subscriptions/sub-123/resourceGroups/rg-cmmc/providers/Microsoft.KeyVault/vaults/kv-cmmc');
    });

    it('should resolve compliance label template', () => {
      const template = 'New-Label -Name "{labelName}" -Comment "{comment}" -Tooltip "{tooltip}"';
      const variables = {
        labelName: 'CUI',
        comment: 'Controlled Unclassified Information',
        tooltip: 'Apply to CUI documents'
      };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('New-Label -Name "CUI" -Comment "Controlled Unclassified Information" -Tooltip "Apply to CUI documents"');
    });

    it('should handle partial variable resolution gracefully', () => {
      const template = 'Set-Mailbox -Identity {userUpn} -AuditEnabled $true -AuditLogAgeLimit {retentionDays}';
      const variables = { userUpn: 'admin@tenant.onmicrosoft.us' };

      const result = resolveTemplate(template, variables);

      expect(result).toBe('Set-Mailbox -Identity admin@tenant.onmicrosoft.us -AuditEnabled $true -AuditLogAgeLimit {retentionDays}');
    });
  });
});

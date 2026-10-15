# Snippet Template Authoring Guide

## Overview

Snippet templates are Handlebars (.hbs) files that generate control implementation narratives
for the System Security Plan. Each template receives a context object with signal-derived data,
ODP values from variables.json, and assessment metadata.

Templates live in `src/shared/data/snippet-templates/{controlId}.hbs`.

## Template Context

Every template receives:

- `controlId` — the CMMC control ID (e.g., `AC.L2-3.1.1`)
- `status` — assessment status (`met`, `not_met`, `not_assessed`)
- `evidenceArtifactUrl` — comma-separated evidence artifact IDs

Plus signal-specific variables (see Signal Types below) and ODP variables from variables.json.

## Adding New Signal Types

To add a new signal type for template consumption:

1. Open `src/eo/generation/SignalRegistry.ts`
2. Add a new entry to the `SIGNAL_REGISTRY` array:

```typescript
{
  signalId: 'yourSignalId',
  transform: (s) => {
    const data = s.rawData as Record<string, unknown>;
    return {
      yourVariable: Boolean(data?.someField),
      yourCount: Array.isArray(data?.value) ? data.value.length : 0,
    };
  },
},
```

3. The transform function receives a `SignalResult` and returns a `Record<string, unknown>`
   that is merged into the template context
4. Run `npm run validate-snippets` to verify templates still pass validation
5. No changes to `SnippetTemplateEngine.ts` are required

## Using ODP Values

ODP (Organization-Defined Parameter) values from `variables.json` are available directly
in templates. Common variables:

- `{{tenantName}}` — tenant display name
- `{{primaryDomain}}` — primary domain (e.g., `vfsgov.us`)
- `{{tenantId}}` — Azure AD tenant ID
- `{{cisoEmail}}` — CISO email address
- `{{cuiGroupName}}` — CUI security group name
- `{{breakGlassUPN}}` — break-glass account UPN
- `{{approverUPN}}` — approver account UPN
- `{{adminUserName}}` — admin user name
- `{{location}}` — Azure region
- `{{subscriptionId}}` — Azure subscription ID
- `{{resourceGroup}}` — Azure resource group name
- `{{lawWorkspaceName}}` — Log Analytics workspace name
- `{{storageAccountName}}` — storage account name

These values come from `stamper/plan-data/{slug}/variables.json` and are merged into the
template context by `SnippetTemplateEngine.buildContext()`.

## Template Variable Schemas

Each control family has a JSON schema defining expected variables:
`src/shared/schemas/template-variables/{family}-variables.schema.json`

When authoring templates for a family, update the schema with required fields before the
family's template authoring sprint begins.

## Validation

Run `npm run validate-snippets` after any template changes. The validator:

1. Compiles each `.hbs` template (catches syntax errors)
2. Renders with fixture data (catches missing variables)
3. Validates fixture data against family schema (catches schema mismatches)
4. Checks output for error markers (`[object Object]`, `undefined`)

Fixture data lives in `tests/fixtures/snippet-validation/`.

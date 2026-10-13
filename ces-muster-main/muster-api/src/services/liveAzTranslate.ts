// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// liveAzTranslate.ts — FC-MU-5 step 2 (founder decision 2026-09-28, round 4):
// the Azure CLI reads in Stamper's registries, rewritten for Muster's LIVE
// discovery only.
//
// Why: the live Azure area signs in with a delegated device-code token
// (Connect-AzAccount -AccessToken). The Azure CLI cannot take that token, so
// FC-MU-3 refused every `az …` get_command live ("unavailable at this auth
// tier"). Each of those reads is translated here to its Azure PowerShell
// equivalent — the same ARM GET, the same output shape — so it runs in the
// Azure session.
//
// Rules:
//   - Stamper's registry is untouched. A translation applies only when the
//     command text is EXACTLY the registry text it was written for; if
//     Stamper changes the command, the translation stops applying and the
//     entry falls back to "refused (az CLI)" — a drift guard, not a guess.
//   - Live path only: readOnlyAreaSession (liveDiscoveryRun.ts) calls this.
//     The sim path never does.
//   - Every translation is a GET via Invoke-AzRestMethod (Az.Accounts, which
//     the Azure session already needs). `az rest` exits non-zero on an HTTP
//     error; Invoke-AzRestMethod does not, so each translation throws on a
//     status >= 400 to keep the same failure behaviour.
//   - The translated text still passes the read-only command gate
//     (writeCommandReason) — proven per entry by live.azTranslate.test.ts.

/** One registry Azure CLI read and its Azure PowerShell equivalent. */
export interface AzCliTranslation {
  /** The Stamper registry entry the read belongs to. */
  entry_id: string;
  /** The registry get_command, verbatim (the exact-match key). */
  from: string;
  /** The Azure PowerShell equivalent. */
  to: string;
  /** The ARM read both perform: GET on this URL (az rest) or this path under the current subscription. */
  read: { method: 'GET'; url?: string; path?: string };
}

const THROW_ON_HTTP_ERROR = 'if ($__r.StatusCode -ge 400) { throw $__r.Content }';

const AZ_REST_RE = /^(\$[A-Za-z_]\w*\s*=\s*)?az rest --method GET --url (['"])(.+?)\2(.*)$/s;

/**
 * `az rest --method GET --url <u>` (optionally assigned, optionally piped on)
 * → `Invoke-AzRestMethod -Method GET -Uri <u>`, whose `.Content` is the same
 * response body az rest prints. Anything after the call is kept as is.
 */
export function azRestToPowerShell(command: string): string | null {
  const m = AZ_REST_RE.exec(command);
  if (!m) return null;
  const [, assign = '', q, url, rest] = m;
  return `$__r = Invoke-AzRestMethod -Method GET -Uri ${q}${url}${q}; ${THROW_ON_HTTP_ERROR}; ${assign}$__r.Content${rest}`;
}

/** The URL an `az rest --method GET --url …` command reads (null for anything else). */
export function azRestUrl(command: string): string | null {
  const m = AZ_REST_RE.exec(command);
  return m ? m[3] : null;
}

/**
 * Page through an ARM list (value + nextLink) the way the CLI does, starting
 * at `path` under the signed-in subscription; `$__all` holds every item.
 */
function armListAll(path: string): string {
  return [
    '$__sub = (Get-AzContext).Subscription.Id',
    '$__all = @()',
    `$__r = Invoke-AzRestMethod -Method GET -Path "/subscriptions/$__sub${path}"`,
    `while ($true) { ${THROW_ON_HTTP_ERROR}; $__page = $__r.Content | ConvertFrom-Json; if ($__page.value) { $__all += @($__page.value) }; if (-not $__page.nextLink) { break }; $__r = Invoke-AzRestMethod -Method GET -Uri $__page.nextLink }`,
  ].join('; ');
}

/** ARM path (under /subscriptions/<sub>) + api-version the CLI's `advisor recommendation list` reads. UNCONFIRMED api-version. */
export const ADVISOR_LIST_PATH = '/providers/Microsoft.Advisor/recommendations?api-version=2020-01-01';
/** ARM path the sentinel extension's `data-connector list` reads. UNCONFIRMED api-version (the registry's other Sentinel reads use 2024-03-01). */
export const SENTINEL_CONNECTORS_PATH =
  '/resourceGroups/{resourceGroup}/providers/Microsoft.OperationalInsights/workspaces/{lawWorkspaceName}/providers/Microsoft.SecurityInsights/dataConnectors?api-version=2024-03-01';

const REGISTRY_AZ_REST: Array<{ entry_id: string; from: string }> = [
  {
    entry_id: 'AU.L2-3.3.3.sentinel-connector',
    from: "az rest --method GET --url 'https://management.usgovcloudapi.net/subscriptions/{subscriptionId}/resourceGroups/{resourceGroup}/providers/Microsoft.OperationalInsights/workspaces/{lawWorkspaceName}/providers/Microsoft.SecurityInsights/dataConnectors/office365?api-version=2024-03-01'",
  },
  {
    entry_id: 'AZ-SEN-001',
    from: "az rest --method GET --url 'https://management.usgovcloudapi.net/subscriptions/{subscriptionId}/resourceGroups/{resourceGroup}/providers/Microsoft.OperationalInsights/workspaces/{lawWorkspaceName}/providers/Microsoft.SecurityInsights/onboardingStates/default?api-version=2023-11-01'",
  },
  {
    entry_id: 'AZ-DIAG-007',
    from: "az rest --method GET --url 'https://management.usgovcloudapi.net/providers/microsoft.aadiam/diagnosticSettings?api-version=2017-04-01' | ConvertFrom-Json | Where-Object { $_.value } | ConvertTo-Json",
  },
  {
    entry_id: 'AZ-DIAG-008',
    from: "az rest --method GET --url 'https://management.usgovcloudapi.net/providers/microsoft.aadiam/diagnosticSettings?api-version=2017-04-01'",
  },
  {
    entry_id: 'AZ-SEN-009',
    from:
      '$json = az rest --method GET --url "https://management.usgovcloudapi.net/subscriptions/{subscriptionId}/resourceGroups/{resourceGroup}/providers/Microsoft.OperationalInsights/workspaces/{lawWorkspaceName}/providers/Microsoft.SecurityInsights/contentPackages?api-version=2024-03-01" | ConvertFrom-Json; $cmmc = $json.value | Where-Object { $_.properties.displayName -like \'*CMMC*\' }; if ($cmmc) { $cmmc | Select-Object @{N=\'displayName\';E={$_.properties.displayName}},@{N=\'version\';E={$_.properties.version}},@{N=\'contentId\';E={$_.properties.contentId}} | ConvertTo-Json -Depth 5 } else { $null }',
  },
];

function fromAzRest(e: { entry_id: string; from: string }): AzCliTranslation {
  const to = azRestToPowerShell(e.from);
  const url = azRestUrl(e.from);
  if (!to || !url) throw new Error(`liveAzTranslate: ${e.entry_id} is not an az rest GET`);
  return { entry_id: e.entry_id, from: e.from, to, read: { method: 'GET', url } };
}

/** The seven registry Azure CLI reads (FC-MU-3 registry scan) and their translations. */
export const AZ_CLI_TRANSLATIONS: readonly AzCliTranslation[] = [
  ...REGISTRY_AZ_REST.map(fromAzRest),
  {
    // The CLI prints the recommendation list with each model's `properties`
    // hoisted to the top level (the SDK model's flattened shape).
    entry_id: 'SC.L2-3.13.2.advisor',
    from: 'az advisor recommendation list --output json',
    to: `${armListAll(ADVISOR_LIST_PATH)}; ConvertTo-Json -Depth 20 -InputObject @($__all | ForEach-Object { $__o = [ordered]@{ id = $_.id; name = $_.name; type = $_.type }; foreach ($__k in $_.properties.PSObject.Properties) { $__o[$__k.Name] = $__k.Value }; [pscustomobject]$__o })`,
    read: { method: 'GET', path: ADVISOR_LIST_PATH },
  },
  {
    // `--query "[?kind=='ThreatIntelligence']" -o json` → the same filter
    // over the ARM list, printed as a JSON array (ARM shape, as the CLI prints it).
    entry_id: 'SI.L2-3.14.7.threat-intel',
    from: 'az sentinel data-connector list --resource-group {resourceGroup} --workspace-name {lawWorkspaceName} --query "[?kind==\'ThreatIntelligence\']" -o json',
    to: `${armListAll(SENTINEL_CONNECTORS_PATH)}; ConvertTo-Json -Depth 20 -InputObject @($__all | Where-Object { $_.kind -eq 'ThreatIntelligence' })`,
    read: { method: 'GET', path: SENTINEL_CONNECTORS_PATH },
  },
];

const BY_FROM = new Map(AZ_CLI_TRANSLATIONS.map((t) => [t.from, t]));

/** The Azure PowerShell text for a registry Azure CLI read, or null when none applies (exact match only). */
export function translateAzCliRead(command: string): string | null {
  return BY_FROM.get(command)?.to ?? null;
}

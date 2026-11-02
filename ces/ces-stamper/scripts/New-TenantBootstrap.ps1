<#
  SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
  SPDX-License-Identifier: LicenseRef-BHD-Proprietary
  CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
  Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
  Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
  Submitting a change to this repository means you accept TERMS.md.
  Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
  See LICENSE and TERMS.md.
#>

<#
.SYNOPSIS
    Bootstrap M365/Azure tenant connection for CMMC automation.

.DESCRIPTION
    Automates the manual tenant connection setup process:
    1. Creates Entra ID app registration
    2. Generates a self-signed certificate (2-year validity) with a NON-EXPORTABLE
       private key in Cert:\CurrentUser\My. No .pfx is written (SP-3); only the
       public .cer is exported.
    3. APPENDS the certificate to the app registration's existing key credentials
       (a rerun no longer locks out other machines that use an older certificate)
    4. Grants the Microsoft Graph application permissions and Exchange.ManageAsApp
       (Office 365 Exchange Online), with admin consent. Sites.FullControl.All
       (Office 365 SharePoint Online) is HELD (founder decision pending, 2026-10-31):
       it is granted only when $env:CES_HELD_STANDING_GRANTS_ENABLED is 'true'.
    5. Optional: assigns the app Contributor + User Access Administrator on an Azure
       subscription (-SubscriptionId)
    6. Turns Security Defaults off, only after the operator types 'yes'
    7. Break-glass VERIFY: checks that two customer-created, cloud-only, enabled
       break-glass accounts exist (-BreakGlassUpn). CES never creates them.
    8. Licences (FIN-21, audit steps 1 and 18): checks that the tenant holds an enabled
       G5 SKU (-LicenseSkuPartNumber) with free seats, and assigns it to each -LicenseUpn
       (the operator and CUI users) that does not hold it. It only assigns seats the
       tenant already owns; it never buys one (no cost start).
    9. Writes .env configuration and a machine-readable result file (-ResultPath)
       that `stamper bootstrap` turns into a ces-tenant registry record
   10. Validates connectivity

    -Simulator (FIN-21) runs the same steps against the tenant-stacksim simulator (the
    shadowed Graph/Az modules, $env:STACKSIM_SERVER_URL, a sim-tenant-* tenant id): no
    module install, no network test, files under a temporary folder, and the Security
    Defaults answer may be scripted (-SecurityDefaultsAnswer, simulator only: FD-1).

.PARAMETER TenantId
    The Azure AD tenant ID (GUID format).

.PARAMETER DisplayName
    Display name for the app registration (e.g., "CMMC-Automation").

.PARAMETER Environment
    Target environment: "Commercial" or "GCCHigh". Determines endpoints.

.PARAMETER OutputPath
    Path to write the .env file. Defaults to stamper\.env.

.PARAMETER CertStorePath
    Directory to store the public .cer file. Defaults to C:\stamper-certs.

.PARAMETER SubscriptionId
    Optional Azure subscription ID. When given, the app is assigned Contributor and
    User Access Administrator on /subscriptions/<id>.

.PARAMETER BreakGlassUpn
    UPNs of the two customer-created break-glass accounts to verify.

.PARAMETER ResultPath
    Path of the JSON result file (no secret material). Defaults to
    <CertStorePath>\<DisplayName>.bootstrap-result.json.

.PARAMETER LicenseUpn
    UPNs to license (the CES operator and the CUI users). Each one that does not hold the
    checked SKU gets one already-purchased seat.

.PARAMETER LicenseSkuPartNumber
    The SKU part number the licence check looks for. Default: the first enabled SKU whose
    part number contains "G5".

.PARAMETER Simulator
    Run against the tenant-stacksim simulator (see DESCRIPTION). Refused unless
    STACKSIM_SERVER_URL is set and the tenant id starts with "sim-tenant-".

.PARAMETER SecurityDefaultsAnswer
    Simulator only: the typed answer ("yes" or "no") for the Security Defaults prompt.
    Refused on a live tenant (founder ruling FD-1: scripted confirmations only on simulated tenants).

.EXAMPLE
    .\New-TenantBootstrap.ps1 -TenantId "12345678-1234-1234-1234-123456789012" -DisplayName "CMMC-Automation" -Environment GCCHigh -BreakGlassUpn "bg1@contoso.us","bg2@contoso.us"

.NOTES
    Requires: PowerShell 7+, Global Administrator role
    Modules: Microsoft.Graph (auto-installed if missing); Az.Accounts + Az.Resources when -SubscriptionId is given
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidateNotNullOrEmpty()]
    [string]$TenantId,

    [Parameter(Mandatory=$true)]
    [ValidateNotNullOrEmpty()]
    [string]$DisplayName,

    [Parameter(Mandatory=$true)]
    [ValidateSet("Commercial", "GCCHigh")]
    [string]$Environment,

    [Parameter(Mandatory=$false)]
    [string]$OutputPath,

    [Parameter(Mandatory=$false)]
    [string]$CertStorePath = "C:\stamper-certs",

    [Parameter(Mandatory=$false)]
    [string]$SubscriptionId,

    [Parameter(Mandatory=$false)]
    [string[]]$BreakGlassUpn = @(),

    [Parameter(Mandatory=$false)]
    [string]$ResultPath,

    [Parameter(Mandatory=$false)]
    [string[]]$LicenseUpn = @(),

    [Parameter(Mandatory=$false)]
    [string]$LicenseSkuPartNumber,

    [Parameter(Mandatory=$false)]
    [switch]$Simulator,

    [Parameter(Mandatory=$false)]
    [ValidateSet("yes", "no")]
    [string]$SecurityDefaultsAnswer
)

$ErrorActionPreference = "Stop"

# Color output helpers
function Write-Success { param([string]$Message) Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-Info { param([string]$Message) Write-Host "[INFO] $Message" -ForegroundColor Cyan }
function Write-Warn { param([string]$Message) Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Write-Fail { param([string]$Message) Write-Host "[FAIL] $Message" -ForegroundColor Red }

Write-Host ""
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "  Tenant Bootstrap for CMMC Automation" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""

# --- Step 0: Simulator guard (FIN-21) ---
if ($SecurityDefaultsAnswer -and -not $Simulator) {
    Write-Fail "-SecurityDefaultsAnswer is accepted only with -Simulator. On a live tenant the operator types the answer (FD-1)."
    exit 1
}
if ($Simulator) {
    if (-not $env:STACKSIM_SERVER_URL) {
        Write-Fail "-Simulator needs STACKSIM_SERVER_URL (the tenant-stacksim server) and the shadowed modules on PSModulePath."
        exit 1
    }
    if ($TenantId -notlike "sim-tenant-*") {
        Write-Fail "-Simulator refuses tenant id '$TenantId': simulated tenant ids start with 'sim-tenant-'."
        exit 1
    }
    Write-Warn "SIMULATOR MODE: tenant-stacksim at $($env:STACKSIM_SERVER_URL). Nothing here touches a real tenant."
    $simRoot = Join-Path ([System.IO.Path]::GetTempPath()) "ces-stacksim-bootstrap"
    if (-not $PSBoundParameters.ContainsKey('CertStorePath')) { $CertStorePath = $simRoot }
    if (-not $OutputPath) { $OutputPath = Join-Path $CertStorePath ".env" }
}

# --- Step 1: Prerequisite Checks ---
Write-Info "Checking prerequisites..."

# Check PowerShell version
if ($PSVersionTable.PSVersion.Major -lt 7) {
    Write-Fail "PowerShell 7+ is required. Current version: $($PSVersionTable.PSVersion)"
    Write-Host "Download from: https://aka.ms/powershell" -ForegroundColor Yellow
    exit 1
}
Write-Success "PowerShell version: $($PSVersionTable.PSVersion)"

# Check and install required modules
$requiredModules = @(
    @{Name="Microsoft.Graph"; MinVersion="2.0.0"}
)
if ($SubscriptionId) {
    $requiredModules += @{Name="Az.Accounts"; MinVersion="2.0.0"}
    $requiredModules += @{Name="Az.Resources"; MinVersion="6.0.0"}
}

if ($Simulator) {
    # The simulator shadows the Graph/Az cmdlets with its own modules; nothing is installed.
    $requiredModules = @()
    # Every Graph/Az command must be the simulator's: a real module found first on PSModulePath
    # (pwsh puts its own module folders ahead of an inherited path) would reach a real tenant.
    foreach ($simCmd in @("Connect-MgGraph", "Get-MgApplication", "Get-MgSubscribedSku", "Connect-AzAccount", "New-AzRoleAssignment")) {
        $found = Get-Command $simCmd -ErrorAction SilentlyContinue
        if (-not $found -or $found.CommandType -ne 'Function' -or "$($found.Definition)" -notmatch 'Stacksim|tenant-stacksim|the sim') {
            Write-Fail "Simulator: '$simCmd' is not the tenant-stacksim shadow command (PSModulePath must reach the stacksim psmodules folder before any real module)."
            exit 1
        }
    }
    Write-Success "Simulator modules found"
}

foreach ($module in $requiredModules) {
    $installed = Get-Module -Name $module.Name -ListAvailable | Where-Object { $_.Version -ge [version]$module.MinVersion }
    if (-not $installed) {
        Write-Warn "Module '$($module.Name)' not found. Installing..."
        try {
            Install-Module -Name $module.Name -Scope CurrentUser -AllowClobber -Force -ErrorAction Stop
            Write-Success "Installed $($module.Name)"
        } catch {
            Write-Fail "Failed to install $($module.Name): $_"
            exit 1
        }
    } else {
        Write-Success "Module $($module.Name) version $($installed[0].Version) found"
    }
}

# Set environment-specific parameters
$mgEnvironment = if ($Environment -eq "GCCHigh") { "USGov" } else { "Global" }
$azEnvironment = if ($Environment -eq "GCCHigh") { "AzureUSGovernment" } else { "AzureCloud" }
$graphEndpoint = if ($Environment -eq "GCCHigh") { "https://graph.microsoft.us" } else { "https://graph.microsoft.com" }
$loginEndpoint = if ($Environment -eq "GCCHigh") { "https://login.microsoftonline.us" } else { "https://login.microsoftonline.com" }
$exchangeEnv = if ($Environment -eq "GCCHigh") { "O365USGovGCCHigh" } else { "O365Default" }
$complianceUri = if ($Environment -eq "GCCHigh") { "https://ps.compliance.protection.office365.us/powershell-liveid/" } else { "https://ps.compliance.protection.outlook.com/powershell-liveid/" }
$azureAuthEndpoint = if ($Environment -eq "GCCHigh") { "https://login.microsoftonline.us/organizations" } else { "https://login.microsoftonline.com/organizations" }
$armEndpoint = if ($Environment -eq "GCCHigh") { "https://management.usgovcloudapi.net" } else { "https://management.azure.com" }

Write-Info "Target Environment: $Environment"
Write-Info "Graph Endpoint: $graphEndpoint"

# Test network connectivity (not on the simulator)
$graphHost = ([System.Uri]$graphEndpoint).Host
if ($Simulator) {
    Write-Info "Simulator: network test skipped"
} else {
Write-Info "Testing connectivity to $graphEndpoint..."
try {
    $connection = Test-NetConnection -ComputerName $graphHost -Port 443 -WarningAction SilentlyContinue
    if ($connection.TcpTestSucceeded) {
        Write-Success "Network connectivity OK"
    } else {
        Write-Fail "Cannot reach $graphHost on port 443"
        exit 1
    }
} catch {
    Write-Warn "Test-NetConnection failed, but continuing (may be Windows version issue)"
}
}

# --- Step 2: Connect to Microsoft Graph ---
# Delegated scopes for the operator session:
#   Application.ReadWrite.All, AppRoleAssignment.ReadWrite.All - app, certificate, permission grants
#   Policy.ReadWrite.ConditionalAccess - read/turn off Security Defaults
#   User.Read.All - break-glass VERIFY
#   Organization.Read.All - default domain and organization name for the tenant record
$graphScopes = @(
    "Application.ReadWrite.All",
    "AppRoleAssignment.ReadWrite.All",
    "Policy.ReadWrite.ConditionalAccess",
    "User.Read.All",
    "Organization.Read.All"
)

Write-Info "Connecting to Microsoft Graph..."
Write-Host "  You will be prompted to sign in with Global Administrator credentials." -ForegroundColor Yellow
Write-Host "  Required scopes: $($graphScopes -join ', ')" -ForegroundColor Yellow
Write-Host ""

try {
    Connect-MgGraph -Scopes $graphScopes -Environment $mgEnvironment -TenantId $TenantId -NoWelcome -ErrorAction Stop
    Write-Success "Connected to Microsoft Graph"
} catch {
    Write-Fail "Failed to connect to Microsoft Graph: $_"
    exit 1
}

# Verify connection
$context = Get-MgContext
if (-not $context) {
    Write-Fail "Not connected to Microsoft Graph"
    exit 1
}
Write-Info "Authenticated as: $($context.Account)"
Write-Info "Tenant: $($context.TenantId)"

# Organization name and default domain (written into the tenant record)
$orgName = $null
$tenantDomain = $null
try {
    $orgInfo = Get-MgOrganization -ErrorAction Stop | Select-Object -First 1
    $orgName = $orgInfo.DisplayName
    $defaultDomain = $orgInfo.VerifiedDomains | Where-Object { $_.IsDefault } | Select-Object -First 1
    if ($defaultDomain) { $tenantDomain = $defaultDomain.Name }
    Write-Info "Organization: $orgName ($tenantDomain)"
} catch {
    Write-Warn "Could not read organization name/default domain: $_"
}

# --- Step 3: Create or Get App Registration ---
Write-Info "Checking for existing app registration: '$DisplayName'..."

try {
    $existingApp = Get-MgApplication -Filter "displayName eq '$DisplayName'" -ErrorAction Stop
    if ($existingApp) {
        Write-Warn "App registration '$DisplayName' already exists"
        $app = $existingApp | Select-Object -First 1
        Write-Info "Using existing app: $($app.AppId)"
    } else {
        Write-Info "Creating new app registration..."
        $app = New-MgApplication -DisplayName $DisplayName -SignInAudience "AzureADMyOrg" -ErrorAction Stop
        Write-Success "Created app registration: $($app.AppId)"
    }
} catch {
    Write-Fail "Failed to create/get app registration: $_"
    Disconnect-MgGraph | Out-Null
    exit 1
}

$appId = $app.AppId
$appObjectId = $app.Id

# --- Step 4: Generate Self-Signed Certificate (non-exportable key, SP-3) ---
Write-Info "Generating self-signed certificate (non-exportable private key)..."

$certSubject = "CN=$DisplayName"
$certNotAfter = (Get-Date).AddYears(2)
# A shadowed PSModulePath (the simulator) leaves out the Windows PKI module; load it by path.
if (-not (Get-Command New-SelfSignedCertificate -ErrorAction SilentlyContinue)) {
    Import-Module (Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\Modules\PKI\PKI.psd1") -ErrorAction SilentlyContinue
}
# The simulator's certificate is marked so a sweep can find it; it is still a real, non-exportable key.
$certFriendlyName = if ($Simulator) { "CES stacksim bootstrap ($DisplayName)" } else { "CES bootstrap ($DisplayName)" }

try {
    $cert = New-SelfSignedCertificate `
        -FriendlyName $certFriendlyName `
        -Subject $certSubject `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -KeyExportPolicy NonExportable `
        -KeySpec Signature `
        -KeyLength 2048 `
        -KeyAlgorithm RSA `
        -HashAlgorithm SHA256 `
        -NotAfter $certNotAfter `
        -ErrorAction Stop

    Write-Success "Certificate created: $($cert.Thumbprint)"
    Write-Info "Valid until: $($cert.NotAfter)"
} catch {
    Write-Fail "Failed to create certificate: $_"
    Disconnect-MgGraph | Out-Null
    exit 1
}

# --- Step 5: Export the public certificate (.cer only; no private key leaves the store) ---
Write-Info "Exporting public certificate..."

# Ensure cert storage directory exists
if (-not (Test-Path $CertStorePath)) {
    try {
        New-Item -ItemType Directory -Path $CertStorePath -Force -ErrorAction Stop | Out-Null
        Write-Success "Created certificate storage directory: $CertStorePath"
    } catch {
        Write-Fail "Failed to create certificate directory: $_"
        Disconnect-MgGraph | Out-Null
        exit 1
    }
}

$cerPath = Join-Path $CertStorePath "$DisplayName.cer"
$certStoreRef = "Cert:\CurrentUser\My\$($cert.Thumbprint)"

try {
    Export-Certificate -Cert $cert -FilePath $cerPath -ErrorAction Stop | Out-Null
    Write-Success "Exported .cer certificate: $cerPath"
} catch {
    Write-Fail "Failed to export certificate: $_"
    Disconnect-MgGraph | Out-Null
    exit 1
}

# --- Step 6: Attach Certificate to App Registration (APPEND, never replace) ---
Write-Info "Attaching certificate to app registration..."

try {
    # Read certificate file and convert to Base64
    $cerBytes = [System.IO.File]::ReadAllBytes($cerPath)
    $cerBase64 = [System.Convert]::ToBase64String($cerBytes)

    # Create key credential
    $keyCredential = @{
        Type = "AsymmetricX509Cert"
        Usage = "Verify"
        Key = [System.Text.Encoding]::UTF8.GetBytes($cerBase64)
    }

    # Merge with the app's existing key credentials so a rerun does not remove the
    # certificates other machines still use (audit section 5 gap 9, handoff issue R24).
    # Existing entries come back from Graph without key material; Graph keeps them by keyId.
    $currentApp = Get-MgApplication -ApplicationId $appObjectId -Property "id,keyCredentials" -ErrorAction Stop
    $existingKeyCredentials = @($currentApp.KeyCredentials | Where-Object { $_ })
    $mergedKeyCredentials = @($existingKeyCredentials) + @($keyCredential)

    # Attach to app
    Update-MgApplication -ApplicationId $appObjectId -KeyCredentials $mergedKeyCredentials -ErrorAction Stop
    Write-Success "Certificate attached to app registration ($($existingKeyCredentials.Count) existing kept, 1 added)"
} catch {
    Write-Fail "Failed to attach certificate: $_"
    Disconnect-MgGraph | Out-Null
    exit 1
}

# --- Step 7: Grant API Permissions ---
Write-Info "Granting API permissions..."

# Get or create service principal for our app
try {
    $appSP = Get-MgServicePrincipal -Filter "appId eq '$appId'" -ErrorAction Stop
    if (-not $appSP) {
        Write-Info "Creating service principal for app..."
        $appSP = New-MgServicePrincipal -AppId $appId -ErrorAction Stop
        Write-Success "Service principal created"
    }
} catch {
    Write-Fail "Failed to get/create service principal: $_"
    Disconnect-MgGraph | Out-Null
    exit 1
}

# Define required permissions for CMMC L2 compliance
$requiredPermissions = @(
    "Policy.ReadWrite.ConditionalAccess",
    "Directory.ReadWrite.All",
    "DeviceManagementConfiguration.ReadWrite.All",
    "DeviceManagementManagedDevices.ReadWrite.All",
    "DeviceManagementServiceConfig.ReadWrite.All",
    "User.ReadWrite.All",
    "Group.ReadWrite.All",
    "RoleManagement.ReadWrite.Directory",
    "Organization.ReadWrite.All",
    "Policy.ReadWrite.Authorization",
    "AuditLog.Read.All",
    "SecurityEvents.ReadWrite.All",
    "ThreatIndicators.ReadWrite.OwnedBy",
    "IdentityRiskyUser.ReadWrite.All",
    "IdentityRiskEvent.ReadWrite.All",
    # Parity with preflight's REQUIRED_GRAPH_PERMISSIONS (execute.routes.ts) - without
    # these 7, a freshly bootstrapped tenant dead-ends at "BOOTSTRAP REQUIRED" because
    # preflight's self-grant itself needs AppRoleAssignment.ReadWrite.All.
    "InformationProtectionPolicy.Read.All",
    "AppRoleAssignment.ReadWrite.All",
    "DeviceManagementApps.ReadWrite.All",
    "SecurityAlert.Read.All",
    "SecurityAlert.ReadWrite.All",
    "SecurityIncident.Read.All",
    "SecurityIncident.ReadWrite.All",
    # SIM-BL (2026-10-31): read-only BitLocker recovery-key metadata (no key material) for the
    # SC.L2-3.13.10.key-escrow evidence read. Not a held standing grant.
    "BitLockerKey.ReadBasic.All"
)

# Non-Graph application permissions (parity with preflight's REQUIRED_RESOURCE_APP_ROLES):
#   Exchange.ManageAsApp - app-only Exchange Online and Purview (IPPS) sessions
#   Sites.FullControl.All - app-only Connect-SPOService. HELD (Held = $true): a standing
#   tenant-wide grant held, like the AC.L2-3.1.2 role-assignment registry entry, until the founder decides on all
#   standing CES roles together. Same flag as preflight: CES_HELD_STANDING_GRANTS_ENABLED.
$heldStandingGrantsEnabled = ($env:CES_HELD_STANDING_GRANTS_ENABLED -eq 'true')
$resourcePermissions = @(
    @{ ResourceAppId = "00000002-0000-0ff1-ce00-000000000000"; ResourceName = "Office 365 Exchange Online"; Permissions = @("Exchange.ManageAsApp"); Held = $false },
    @{ ResourceAppId = "00000003-0000-0ff1-ce00-000000000000"; ResourceName = "Office 365 SharePoint Online"; Permissions = @("Sites.FullControl.All"); Held = $true }
)
$heldPermissions = @()

$successCount = 0
$skipCount = 0
$failCount = 0

function Grant-ResourceAppRoles {
    param(
        [Parameter(Mandatory=$true)] $ResourceSP,
        [Parameter(Mandatory=$true)] [string[]]$Permissions
    )
    $existingAssignments = @(Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $appSP.Id -All -ErrorAction SilentlyContinue)
    foreach ($permissionName in $Permissions) {
        # Find the AppRole by Value
        $appRole = $ResourceSP.AppRoles | Where-Object { $_.Value -eq $permissionName }

        if (-not $appRole) {
            Write-Warn "Permission '$permissionName' not found in $($ResourceSP.DisplayName)"
            $script:failCount++
            continue
        }

        try {
            # Check if already granted
            $existing = $existingAssignments | Where-Object { $_.AppRoleId -eq $appRole.Id -and $_.ResourceId -eq $ResourceSP.Id }

            if ($existing) {
                Write-Host "  [SKIP] $permissionName (already granted)" -ForegroundColor DarkGray
                $script:skipCount++
            } else {
                New-MgServicePrincipalAppRoleAssignment `
                    -ServicePrincipalId $appSP.Id `
                    -PrincipalId $appSP.Id `
                    -ResourceId $ResourceSP.Id `
                    -AppRoleId $appRole.Id `
                    -ErrorAction Stop | Out-Null
                Write-Host "  [OK] $permissionName" -ForegroundColor Green
                $script:successCount++
            }
        } catch {
            Write-Host "  [FAIL] $permissionName : $_" -ForegroundColor Red
            $script:failCount++
        }
    }
}

# Microsoft Graph
try {
    $graphSP = Get-MgServicePrincipal -Filter "appId eq '00000003-0000-0000-c000-000000000000'" -ErrorAction Stop
    if (-not $graphSP) {
        Write-Fail "Could not find Microsoft Graph service principal"
        Disconnect-MgGraph | Out-Null
        exit 1
    }
} catch {
    Write-Fail "Failed to get Microsoft Graph service principal: $_"
    Disconnect-MgGraph | Out-Null
    exit 1
}

Write-Info "Granting $($requiredPermissions.Count) Microsoft Graph permissions..."
Grant-ResourceAppRoles -ResourceSP $graphSP -Permissions $requiredPermissions

# Exchange Online and SharePoint Online
foreach ($resource in $resourcePermissions) {
    if ($resource.Held -and -not $heldStandingGrantsEnabled) {
        foreach ($heldName in $resource.Permissions) {
            Write-Host "  [HELD] $heldName ($($resource.ResourceName)): held (founder decision pending)" -ForegroundColor Yellow
            $heldPermissions += $heldName
        }
        continue
    }
    Write-Info "Granting $($resource.ResourceName) permissions: $($resource.Permissions -join ', ')"
    try {
        $resourceSP = Get-MgServicePrincipal -Filter "appId eq '$($resource.ResourceAppId)'" -ErrorAction Stop
    } catch {
        $resourceSP = $null
    }
    if (-not $resourceSP) {
        Write-Host "  [FAIL] $($resource.ResourceName) service principal not found in tenant" -ForegroundColor Red
        $failCount += $resource.Permissions.Count
        continue
    }
    Grant-ResourceAppRoles -ResourceSP $resourceSP -Permissions $resource.Permissions
}

Write-Host ""
Write-Info "Permissions summary: $successCount granted, $skipCount skipped, $failCount failed, $($heldPermissions.Count) held"

if ($failCount -gt 0) {
    Write-Warn "Some permissions failed to grant. App may not have all required access."
}

# --- Step 7b: Azure subscription role assignment (optional) ---
$subscriptionResult = [ordered]@{ subscription_id = $SubscriptionId; status = "skipped"; roles_assigned = @(); roles_existing = @(); roles_failed = @() }
if ($SubscriptionId) {
    Write-Info "Assigning Azure roles on subscription $SubscriptionId..."
    $subscriptionScope = "/subscriptions/$SubscriptionId"
    $azureRoles = @("Contributor", "User Access Administrator")
    try {
        Connect-AzAccount -Environment $azEnvironment -Tenant $TenantId -Subscription $SubscriptionId -ErrorAction Stop | Out-Null
        foreach ($roleName in $azureRoles) {
            try {
                $existingRole = Get-AzRoleAssignment -ObjectId $appSP.Id -RoleDefinitionName $roleName -Scope $subscriptionScope -ErrorAction Stop
                if ($existingRole) {
                    Write-Host "  [SKIP] $roleName (already assigned)" -ForegroundColor DarkGray
                    $subscriptionResult.roles_existing += $roleName
                } else {
                    New-AzRoleAssignment -ObjectId $appSP.Id -RoleDefinitionName $roleName -Scope $subscriptionScope -ErrorAction Stop | Out-Null
                    Write-Host "  [OK] $roleName" -ForegroundColor Green
                    $subscriptionResult.roles_assigned += $roleName
                }
            } catch {
                Write-Host "  [FAIL] $roleName : $_" -ForegroundColor Red
                $subscriptionResult.roles_failed += $roleName
            }
        }
        $subscriptionResult.status = if ($subscriptionResult.roles_failed.Count -gt 0) { "failed" } else { "ok" }
        Disconnect-AzAccount -ErrorAction SilentlyContinue | Out-Null
    } catch {
        Write-Fail "Failed to connect to Azure subscription $SubscriptionId : $_"
        $subscriptionResult.status = "failed"
        $subscriptionResult.roles_failed = $azureRoles
    }
} else {
    Write-Warn "No -SubscriptionId given: the app has NO Azure subscription role. Baseline and Azure infra entries will fail authorization until one is assigned."
}

# --- Step 7c: Security Defaults (turned off only with the operator's typed confirmation) ---
$securityDefaultsStatus = "unknown"
try {
    $sdPolicy = Get-MgPolicyIdentitySecurityDefaultEnforcementPolicy -ErrorAction Stop
    if (-not $sdPolicy.IsEnabled) {
        Write-Success "Security Defaults already off"
        $securityDefaultsStatus = "already_off"
    } else {
        Write-Host ""
        Write-Warn "Security Defaults are ON. CES Conditional Access policies cannot be created while they are on."
        Write-Host "  Turning them off removes the tenant's default MFA protection until the CES CA policies are applied." -ForegroundColor Yellow
        if ($Simulator -and $SecurityDefaultsAnswer) {
            # FD-1: a scripted answer only on a simulated tenant (Step 0 refuses it otherwise).
            $sdAnswer = $SecurityDefaultsAnswer
            Write-Info "Simulator: scripted answer '$sdAnswer'"
        } else {
            $sdAnswer = Read-Host -Prompt "Type 'yes' to turn Security Defaults OFF now (anything else leaves them on)"
        }
        if ($sdAnswer -eq "yes") {
            Update-MgPolicyIdentitySecurityDefaultEnforcementPolicy -BodyParameter @{ isEnabled = $false } -ErrorAction Stop
            Write-Success "Security Defaults turned off (operator confirmed)"
            $securityDefaultsStatus = "disabled_by_operator"
        } else {
            Write-Warn "Security Defaults left ON (operator declined). CA policy entries will conflict until they are turned off."
            $securityDefaultsStatus = "left_on"
        }
    }
} catch {
    Write-Fail "Could not read or change Security Defaults: $_"
    $securityDefaultsStatus = "error"
}

# --- Step 7d: Break-glass VERIFY (customer-created; CES only checks they exist) ---
$breakGlassResult = [ordered]@{ verified = $false; upns = @($BreakGlassUpn); user_ids = @(); detail = "" }
# `pwsh -File` passes a list as one comma-joined string, so split on commas here.
$distinctUpns = @($BreakGlassUpn | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)
$breakGlassResult.upns = $distinctUpns
if ($distinctUpns.Count -lt 2) {
    $breakGlassResult.detail = "Two break-glass UPNs are required (-BreakGlassUpn); $($distinctUpns.Count) given. The customer creates them; CES only verifies."
    Write-Fail "Break-glass VERIFY: $($breakGlassResult.detail)"
} else {
    $bgProblems = @()
    foreach ($upn in $distinctUpns) {
        try {
            $escapedUpn = $upn -replace "'", "''"
            $bgUser = Get-MgUser -Filter "userPrincipalName eq '$escapedUpn'" -Property "id,userPrincipalName,accountEnabled,onPremisesSyncEnabled" -ErrorAction Stop | Select-Object -First 1
            if (-not $bgUser) {
                $bgProblems += "$upn not found"
            } elseif ($bgUser.AccountEnabled -ne $true) {
                $bgProblems += "$upn is disabled"
            } elseif ($bgUser.OnPremisesSyncEnabled -eq $true) {
                $bgProblems += "$upn is synced from on-premises (must be cloud-only)"
            } else {
                $breakGlassResult.user_ids += $bgUser.Id
                Write-Host "  [OK] break-glass $upn ($($bgUser.Id))" -ForegroundColor Green
            }
        } catch {
            $bgProblems += "$upn lookup failed: $_"
        }
    }
    if ($bgProblems.Count -eq 0) {
        $breakGlassResult.verified = $true
        $breakGlassResult.detail = "$($distinctUpns.Count) cloud-only enabled accounts found"
        Write-Success "Break-glass VERIFY passed"
    } else {
        $breakGlassResult.detail = $bgProblems -join "; "
        Write-Fail "Break-glass VERIFY failed: $($breakGlassResult.detail)"
    }
}

# --- Step 7e: Licences (FIN-21; audit steps 1 and 18) ---
# Check: an enabled SKU (default: part number containing G5) with free seats. Assign: one seat of
# that SKU to each -LicenseUpn that lacks it. Seats the tenant already owns only; nothing is bought.
$licenseResult = [ordered]@{
    check = "not_run"; sku_part_number = $null; sku_id = $null
    enabled = 0; consumed = 0; available = 0; skus = @()
    upns = @(); assigned = @(); existing = @(); failed = @(); detail = ""
    cost = "none: assigns seats the tenant already owns; never buys one"
}
$licenseSku = $null
try {
    $subscribedSkus = @(Get-MgSubscribedSku -All -ErrorAction Stop)
    $licenseResult.skus = @($subscribedSkus | ForEach-Object { $_.SkuPartNumber })
    $skuPattern = if ($LicenseSkuPartNumber) { '^' + [regex]::Escape($LicenseSkuPartNumber) + '$' } else { 'G5' }
    $licenseSku = $subscribedSkus | Where-Object { $_.SkuPartNumber -match $skuPattern -and $_.CapabilityStatus -eq 'Enabled' } | Select-Object -First 1
    if (-not $licenseSku) {
        $licenseResult.check = "missing"
        $licenseResult.detail = "No enabled SKU matching '$skuPattern' (tenant has: $($licenseResult.skus -join ', '))"
        Write-Fail "Licence check: $($licenseResult.detail)"
    } else {
        $licenseResult.sku_part_number = $licenseSku.SkuPartNumber
        $licenseResult.sku_id = $licenseSku.SkuId
        $licenseResult.enabled = [int]$licenseSku.PrepaidUnits.Enabled
        $licenseResult.consumed = [int]$licenseSku.ConsumedUnits
        $licenseResult.available = $licenseResult.enabled - $licenseResult.consumed
        if ($licenseResult.available -gt 0) {
            $licenseResult.check = "ok"
            Write-Success "Licence check: $($licenseSku.SkuPartNumber) $($licenseResult.consumed)/$($licenseResult.enabled) seats used"
        } else {
            $licenseResult.check = "no_free_units"
            $licenseResult.detail = "$($licenseSku.SkuPartNumber) has no free seats ($($licenseResult.consumed)/$($licenseResult.enabled))"
            Write-Warn "Licence check: $($licenseResult.detail)"
        }
    }
} catch {
    $licenseResult.check = "error"
    $licenseResult.detail = "Could not read subscribed SKUs: $_"
    Write-Fail "Licence check: $($licenseResult.detail)"
}

# `pwsh -File` passes a list as one comma-joined string, so split on commas here.
$distinctLicenseUpns = @($LicenseUpn | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)
$licenseResult.upns = $distinctLicenseUpns
foreach ($licUpn in $distinctLicenseUpns) {
    if (-not $licenseSku) {
        $licenseResult.failed += "$licUpn (no SKU to assign)"
        continue
    }
    try {
        $escapedLicUpn = $licUpn -replace "'", "''"
        $licUser = Get-MgUser -Filter "userPrincipalName eq '$escapedLicUpn'" -Property "id,userPrincipalName,assignedLicenses" -ErrorAction Stop | Select-Object -First 1
        if (-not $licUser) {
            $licenseResult.failed += "$licUpn (not found)"
            continue
        }
        if (@($licUser.AssignedLicenses | Where-Object { $_.SkuId -eq $licenseSku.SkuId }).Count -gt 0) {
            Write-Host "  [SKIP] licence $($licenseSku.SkuPartNumber) for $licUpn (already assigned)" -ForegroundColor DarkGray
            $licenseResult.existing += $licUpn
            continue
        }
        if ($licenseResult.available -le 0) {
            $licenseResult.failed += "$licUpn (no free seats)"
            continue
        }
        Set-MgUserLicense -UserId $licUser.Id -AddLicenses @(@{ SkuId = $licenseSku.SkuId }) -RemoveLicenses @() -ErrorAction Stop | Out-Null
        $licenseResult.assigned += $licUpn
        $licenseResult.available--
        Write-Host "  [OK] licence $($licenseSku.SkuPartNumber) for $licUpn" -ForegroundColor Green
    } catch {
        $licenseResult.failed += "$licUpn ($_)"
    }
}
if ($licenseResult.failed.Count -gt 0) {
    Write-Warn "Licence assignment failed for: $($licenseResult.failed -join '; ')"
}

# --- Step 8: Write .env File ---
Write-Info "Writing .env configuration..."

# Determine output path
if (-not $OutputPath) {
    # Default to stamper\.env relative to script location
    $scriptDir = Split-Path -Parent $PSCommandPath
    $stamperRoot = Split-Path -Parent $scriptDir
    $OutputPath = Join-Path $stamperRoot ".env"
}

# Build .env content
$envContent = @"
# Tenant Configuration
TENANT_ID=$TenantId
APP_ID=$appId
CERT_THUMBPRINT=$($cert.Thumbprint)
CERT_PATH=$cerPath
CERT_SOURCE=store

# Environment Configuration
GCC_HIGH_ENDPOINTS=$($Environment -eq 'GCCHigh')
GRAPH_ENDPOINT=$graphEndpoint
LOGIN_ENDPOINT=$loginEndpoint
EXCHANGE_ENV=$exchangeEnv
COMPLIANCE_URI=$complianceUri
AZURE_AUTH_ENDPOINT=$azureAuthEndpoint

# Storage Configuration
STORAGE_ROOT=C:\stamper-storage
STATE_DIR=C:\stamper-storage\state
EVIDENCE_DIR=C:\stamper-storage\evidence

# Logging Configuration
LOG_LEVEL=info
LOG_DIR=C:\stamper-storage\logs

# Execution Configuration
DRY_RUN=false
ENABLE_ROLLBACK=true
IDEMPOTENCY_CHECK=true
"@

try {
    $envContent | Out-File -FilePath $OutputPath -Encoding utf8 -Force -ErrorAction Stop
    Write-Success "Configuration written to: $OutputPath"
} catch {
    Write-Fail "Failed to write .env file: $_"
    Disconnect-MgGraph | Out-Null
    exit 1
}

# --- Step 9: Validate Connectivity ---
Write-Info "Validating connectivity with certificate authentication..."

$validationPassed = $false
try {
    # Disconnect current session
    Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null

    # Connect using certificate
    Connect-MgGraph `
        -ClientId $appId `
        -TenantId $TenantId `
        -CertificateThumbprint $cert.Thumbprint `
        -Environment $mgEnvironment `
        -NoWelcome `
        -ErrorAction Stop

    Write-Success "Certificate authentication successful"

    # Test API call
    $org = Get-MgOrganization -ErrorAction Stop
    Write-Success "Graph API test successful"
    Write-Info "Organization: $($org.DisplayName)"
    $validationPassed = $true

    # Show granted scopes
    $context = Get-MgContext
    Write-Info "App permissions are active (application-level scopes)"

    # Disconnect
    Disconnect-MgGraph | Out-Null
} catch {
    Write-Fail "Connectivity validation failed: $_"
    Write-Host "This may be expected if permissions need time to propagate (wait 5-10 minutes)." -ForegroundColor Yellow
}

# --- Step 10: Write the bootstrap result (no secret material) ---
if (-not $ResultPath) {
    $ResultPath = Join-Path $CertStorePath "$DisplayName.bootstrap-result.json"
}

$bootstrapResult = [ordered]@{
    schema = "ces-stamper/bootstrap-result@1"
    tenant_id = $TenantId
    display_name = $DisplayName
    environment = $Environment
    org_name = $orgName
    domain = $tenantDomain
    app_id = $appId
    cert_thumbprint = $cert.Thumbprint
    cert_source = "store"
    cert_store_ref = $certStoreRef
    cer_path = $cerPath
    cert_expires = $cert.NotAfter.ToUniversalTime().ToString("o")
    endpoints = [ordered]@{
        graph = $graphEndpoint
        login = $loginEndpoint
        compliance_uri = $complianceUri
        exchange_env = $exchangeEnv
        azure_auth = $azureAuthEndpoint
        arm = $armEndpoint
    }
    permissions = [ordered]@{ granted = $successCount; skipped = $skipCount; failed = $failCount; held = @($heldPermissions) }
    subscription = $subscriptionResult
    security_defaults = $securityDefaultsStatus
    break_glass = $breakGlassResult
    licenses = $licenseResult
    simulator = [bool]$Simulator
    validation_passed = $validationPassed
    completed_at = (Get-Date).ToUniversalTime().ToString("o")
}

try {
    $resultDir = Split-Path -Parent $ResultPath
    if ($resultDir -and -not (Test-Path $resultDir)) {
        New-Item -ItemType Directory -Path $resultDir -Force -ErrorAction Stop | Out-Null
    }
    $bootstrapResult | ConvertTo-Json -Depth 6 | Out-File -FilePath $ResultPath -Encoding utf8 -Force -ErrorAction Stop
    Write-Success "Bootstrap result written to: $ResultPath"
} catch {
    Write-Fail "Failed to write bootstrap result: $_"
    exit 1
}

# --- Final Summary ---
Write-Host ""
Write-Host "===============================================" -ForegroundColor Green
Write-Host "  Bootstrap Complete!" -ForegroundColor Green
Write-Host "===============================================" -ForegroundColor Green
Write-Host ""
Write-Host "App Registration Details:" -ForegroundColor Cyan
Write-Host "  Display Name: $DisplayName"
Write-Host "  App ID: $appId"
Write-Host "  Tenant ID: $TenantId"
Write-Host "  Environment: $Environment"
Write-Host ""
Write-Host "Certificate Details:" -ForegroundColor Cyan
Write-Host "  Thumbprint: $($cert.Thumbprint)"
Write-Host "  Private key: $certStoreRef (non-exportable; no PFX file written)"
Write-Host "  CER Path: $cerPath"
Write-Host "  Expires: $($cert.NotAfter)"
Write-Host ""
Write-Host "Tenant readiness:" -ForegroundColor Cyan
Write-Host "  Permissions: $successCount granted, $skipCount skipped, $failCount failed"
Write-Host "  Azure subscription roles: $($subscriptionResult.status)"
Write-Host "  Security Defaults: $securityDefaultsStatus"
Write-Host "  Break-glass VERIFY: $(if ($breakGlassResult.verified) { 'passed' } else { 'NOT VERIFIED - ' + $breakGlassResult.detail })"
Write-Host "  Licences: check $($licenseResult.check); $($licenseResult.assigned.Count) assigned, $($licenseResult.existing.Count) already held, $($licenseResult.failed.Count) failed"
Write-Host "  Certificate validation: $(if ($validationPassed) { 'passed' } else { 'FAILED' })"
Write-Host ""
Write-Host "Configuration:" -ForegroundColor Cyan
Write-Host "  .env Path: $OutputPath"
Write-Host "  Result Path: $ResultPath"
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "  1. Wait 5-10 minutes for permissions to propagate"
Write-Host "  2. Run preflight from the Stamper GUI (assigns the directory roles)"
Write-Host "  3. Set a certificate rotation reminder for: $($cert.NotAfter.AddMonths(-6))"
Write-Host ""

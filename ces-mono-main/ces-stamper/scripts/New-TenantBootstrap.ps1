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
    Automates the 6-step manual tenant connection setup process:
    1. Creates Entra ID app registration
    2. Generates self-signed certificate (2-year validity)
    3. Attaches certificate to app registration
    4. Grants required Microsoft Graph API permissions with admin consent
    5. Writes .env configuration file
    6. Validates connectivity

.PARAMETER TenantId
    The Azure AD tenant ID (GUID format).

.PARAMETER DisplayName
    Display name for the app registration (e.g., "CMMC-Automation").

.PARAMETER Environment
    Target environment: "Commercial" or "GCCHigh". Determines endpoints.

.PARAMETER CertPassword
    Secure password for the .pfx certificate export.

.PARAMETER OutputPath
    Path to write the .env file. Defaults to stamper\.env.

.PARAMETER CertStorePath
    Directory to store certificate files. Defaults to C:\stamper-certs.

.EXAMPLE
    .\New-TenantBootstrap.ps1 -TenantId "12345678-1234-1234-1234-123456789012" -DisplayName "CMMC-Automation" -Environment GCCHigh

.EXAMPLE
    $pwd = ConvertTo-SecureString "MyP@ssw0rd!" -AsPlainText -Force
    .\New-TenantBootstrap.ps1 -TenantId "..." -DisplayName "CMMC-Dev" -Environment Commercial -CertPassword $pwd

.NOTES
    Requires: PowerShell 7+, Global Administrator role
    Modules: Microsoft.Graph (auto-installed if missing)
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
    [SecureString]$CertPassword,

    [Parameter(Mandatory=$false)]
    [string]$OutputPath,

    [Parameter(Mandatory=$false)]
    [string]$CertStorePath = "C:\stamper-certs"
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
$graphEndpoint = if ($Environment -eq "GCCHigh") { "https://graph.microsoft.us" } else { "https://graph.microsoft.com" }
$loginEndpoint = if ($Environment -eq "GCCHigh") { "https://login.microsoftonline.us" } else { "https://login.microsoftonline.com" }
$exchangeEnv = if ($Environment -eq "GCCHigh") { "O365USGovGCCHigh" } else { "O365Default" }
$complianceUri = if ($Environment -eq "GCCHigh") { "https://ps.compliance.protection.office365.us/powershell-liveid/" } else { "https://ps.compliance.protection.outlook.com/powershell-liveid/" }
$azureAuthEndpoint = if ($Environment -eq "GCCHigh") { "https://login.microsoftonline.us/organizations" } else { "https://login.microsoftonline.com/organizations" }

Write-Info "Target Environment: $Environment"
Write-Info "Graph Endpoint: $graphEndpoint"

# Test network connectivity
Write-Info "Testing connectivity to $graphEndpoint..."
$graphHost = ([System.Uri]$graphEndpoint).Host
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

# --- Step 2: Connect to Microsoft Graph ---
Write-Info "Connecting to Microsoft Graph..."
Write-Host "  You will be prompted to sign in with Global Administrator credentials." -ForegroundColor Yellow
Write-Host "  Required scopes: Application.ReadWrite.All, AppRoleAssignment.ReadWrite.All" -ForegroundColor Yellow
Write-Host ""

try {
    Connect-MgGraph -Scopes "Application.ReadWrite.All","AppRoleAssignment.ReadWrite.All" -Environment $mgEnvironment -TenantId $TenantId -NoWelcome -ErrorAction Stop
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

# --- Step 3: Create or Get App Registration ---
Write-Info "Checking for existing app registration: '$DisplayName'..."

try {
    $existingApp = Get-MgApplication -Filter "displayName eq '$DisplayName'" -ErrorAction Stop
    if ($existingApp) {
        Write-Warn "App registration '$DisplayName' already exists"
        $app = $existingApp
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

# --- Step 4: Generate Self-Signed Certificate ---
Write-Info "Generating self-signed certificate..."

$certSubject = "CN=$DisplayName"
$certNotAfter = (Get-Date).AddYears(2)

try {
    $cert = New-SelfSignedCertificate `
        -Subject $certSubject `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -KeyExportPolicy Exportable `
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

# --- Step 5: Export Certificate ---
Write-Info "Exporting certificate files..."

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

# Prompt for certificate password if not provided
if (-not $CertPassword) {
    Write-Host ""
    Write-Host "Enter a password to protect the certificate file (.pfx):" -ForegroundColor Yellow
    $CertPassword = Read-Host -AsSecureString -Prompt "Certificate Password"
    $CertPasswordConfirm = Read-Host -AsSecureString -Prompt "Confirm Password"

    # Compare passwords
    $pwd1 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($CertPassword))
    $pwd2 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($CertPasswordConfirm))

    if ($pwd1 -ne $pwd2) {
        Write-Fail "Passwords do not match"
        Disconnect-MgGraph | Out-Null
        exit 1
    }
    Write-Host ""
}

$pfxPath = Join-Path $CertStorePath "$DisplayName.pfx"
$cerPath = Join-Path $CertStorePath "$DisplayName.cer"

try {
    # Export .pfx (private key)
    Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $CertPassword -ErrorAction Stop | Out-Null
    Write-Success "Exported .pfx certificate: $pfxPath"

    # Export .cer (public key)
    Export-Certificate -Cert $cert -FilePath $cerPath -ErrorAction Stop | Out-Null
    Write-Success "Exported .cer certificate: $cerPath"
} catch {
    Write-Fail "Failed to export certificate: $_"
    Disconnect-MgGraph | Out-Null
    exit 1
}

# --- Step 6: Attach Certificate to App Registration ---
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

    # Attach to app
    Update-MgApplication -ApplicationId $appObjectId -KeyCredentials @($keyCredential) -ErrorAction Stop
    Write-Success "Certificate attached to app registration"
} catch {
    Write-Fail "Failed to attach certificate: $_"
    Disconnect-MgGraph | Out-Null
    exit 1
}

# --- Step 7: Grant API Permissions ---
Write-Info "Granting Microsoft Graph API permissions..."

# Get Microsoft Graph service principal
try {
    $graphSP = Get-MgServicePrincipal -Filter "displayName eq 'Microsoft Graph'" -ErrorAction Stop
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
    "SecurityIncident.ReadWrite.All"
)

Write-Info "Granting $($requiredPermissions.Count) permissions..."

$successCount = 0
$skipCount = 0
$failCount = 0

foreach ($permissionName in $requiredPermissions) {
    # Find the AppRole by Value
    $appRole = $graphSP.AppRoles | Where-Object { $_.Value -eq $permissionName }

    if (-not $appRole) {
        Write-Warn "Permission '$permissionName' not found in Graph API"
        $failCount++
        continue
    }

    try {
        # Check if already granted
        $existing = Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $appSP.Id -ErrorAction SilentlyContinue |
            Where-Object { $_.AppRoleId -eq $appRole.Id -and $_.ResourceId -eq $graphSP.Id }

        if ($existing) {
            Write-Host "  [SKIP] $permissionName (already granted)" -ForegroundColor DarkGray
            $skipCount++
        } else {
            New-MgServicePrincipalAppRoleAssignment `
                -ServicePrincipalId $appSP.Id `
                -PrincipalId $appSP.Id `
                -ResourceId $graphSP.Id `
                -AppRoleId $appRole.Id `
                -ErrorAction Stop | Out-Null
            Write-Host "  [OK] $permissionName" -ForegroundColor Green
            $successCount++
        }
    } catch {
        Write-Host "  [FAIL] $permissionName : $_" -ForegroundColor Red
        $failCount++
    }
}

Write-Host ""
Write-Info "Permissions summary: $successCount granted, $skipCount skipped, $failCount failed"

if ($failCount -gt 0) {
    Write-Warn "Some permissions failed to grant. App may not have all required access."
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
CERT_PATH=$pfxPath

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

    # Show granted scopes
    $context = Get-MgContext
    Write-Info "App permissions are active (application-level scopes)"

    # Disconnect
    Disconnect-MgGraph | Out-Null
} catch {
    Write-Fail "Connectivity validation failed: $_"
    Write-Host "This may be expected if permissions need time to propagate (wait 5-10 minutes)." -ForegroundColor Yellow
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
Write-Host "  PFX Path: $pfxPath"
Write-Host "  CER Path: $cerPath"
Write-Host "  Expires: $($cert.NotAfter)"
Write-Host ""
Write-Host "Configuration:" -ForegroundColor Cyan
Write-Host "  .env Path: $OutputPath"
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "  1. Secure the certificate password (store outside source control)"
Write-Host "  2. Wait 5-10 minutes for permissions to propagate"
Write-Host "  3. Test with: stamper validate <test-plan.json>"
Write-Host "  4. Set a certificate rotation reminder for: $($cert.NotAfter.AddMonths(-6))"
Write-Host ""
Write-Host "IMPORTANT: Keep $pfxPath secure and backed up!" -ForegroundColor Red
Write-Host ""

# Graph API Permissions Setup Guide

## Required API Permissions (13 total)

Evidence Ops requires the following Microsoft Graph API permissions (Application type) for automated compliance assessment in GCC High:

| Permission | Purpose |
|-----------|---------|
| Reports.Read.All | Secure Score data |
| SecurityEvents.Read.All | Security Alerts |
| DeviceManagementManagedDevices.Read.All | Intune managed devices |
| DeviceManagementConfiguration.Read.All | Intune compliance policies |
| DeviceManagementApps.Read.All | Detected applications |
| Directory.Read.All | Groups, Users, Roles |
| Policy.Read.All | Conditional Access, Authentication Methods |
| RoleManagement.Read.Directory | Privileged role assignments |
| InformationProtectionPolicy.Read.All | DLP/sensitivity labels |
| AuditLog.Read.All | Audit log configuration |
| Group.Read.All | CUI group membership |
| User.Read.All | User attributes |
| Organization.Read.All | Tenant metadata |

## Prerequisites

1. An Azure AD App Registration in your GCC High tenant
2. A certificate for app-only authentication (cert-based auth required for GCC High)
3. The Service Principal must be created before granting permissions

## App Registration Setup

### Step 1: Create App Registration

In the Azure Government portal (portal.azure.us):
1. Navigate to Azure Active Directory > App registrations
2. Click "New registration"
3. Set name (e.g., "Evidence Ops Assessment")
4. Set supported account types to "Single tenant"
5. Register

### Step 2: Upload Certificate

1. Navigate to the app registration > Certificates & secrets
2. Upload your .cer or .pem certificate file
3. Note the thumbprint

### Step 3: Grant API Permissions

Use the following PowerShell script to grant all required permissions:

```powershell
# Connect to Microsoft Graph in GCC High
Connect-MgGraph -Environment USGov -Scopes "Application.ReadWrite.All"

# Your app registration's Object ID (from Azure portal)
$appObjectId = "<YOUR_APP_OBJECT_ID>"

# Microsoft Graph Service Principal ID in GCC High
$graphSpId = (Get-MgServicePrincipal -Filter "displayName eq 'Microsoft Graph'").Id

# Required permissions
$permissions = @(
    "Reports.Read.All",
    "SecurityEvents.Read.All",
    "DeviceManagementManagedDevices.Read.All",
    "DeviceManagementConfiguration.Read.All",
    "DeviceManagementApps.Read.All",
    "Directory.Read.All",
    "Policy.Read.All",
    "RoleManagement.Read.Directory",
    "InformationProtectionPolicy.Read.All",
    "AuditLog.Read.All",
    "Group.Read.All",
    "User.Read.All",
    "Organization.Read.All"
)

# Get the Graph Service Principal's app roles
$graphApp = Get-MgServicePrincipal -Filter "displayName eq 'Microsoft Graph'"
$appRoles = $graphApp.AppRoles

foreach ($permName in $permissions) {
    $role = $appRoles | Where-Object { $_.Value -eq $permName }
    if ($role) {
        Write-Host "Granting: $permName"
        New-MgServicePrincipalAppRoleAssignment `
            -ServicePrincipalId $appObjectId `
            -PrincipalId $appObjectId `
            -ResourceId $graphSpId `
            -AppRoleId $role.Id
    } else {
        Write-Warning "Permission not found: $permName"
    }
}

Write-Host "All permissions granted. Admin consent may still be required."
```

### Step 4: Grant Admin Consent

In the Azure Government portal:
1. Navigate to the app registration > API permissions
2. Click "Grant admin consent for [your tenant]"
3. Confirm

## Tenant Config File

Evidence Ops reads tenant credentials from `~/.stamper/tenants/{slug}.json`:

```json
{
  "client": { "slug": "your-client", "name": "Your Client Name" },
  "tenant": {
    "tenant_id": "<TENANT_ID>",
    "environment": "gcchigh"
  },
  "auth": {
    "app_id": "<APP_ID>",
    "cert_path": "/path/to/certificate.pem",
    "cert_thumbprint": "<CERT_THUMBPRINT>"
  },
  "endpoints": {
    "graph": "https://graph.microsoft.us",
    "login": "https://login.microsoftonline.us"
  }
}
```

## Verification

After setup, run Evidence Ops and check the startup logs for permission validation results:

```
GET /api/assess?mode=live&tenant=your-client
```

The console will show which permissions were verified and any warnings for missing permissions.

## PowerShell Modules (Exchange/Purview Fallback)

For Exchange Online and Purview cmdlets (no Graph API equivalents), install:

- `ExchangeOnlineManagement` - for transport rules, mailbox audit settings
- `Microsoft.Graph` - for PowerShell-based Graph queries (backup)

```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser
Install-Module Microsoft.Graph -Scope CurrentUser
```

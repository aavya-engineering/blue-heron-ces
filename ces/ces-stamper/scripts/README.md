# Tenant Bootstrap Scripts

This directory contains automation scripts for bootstrapping M365/Azure tenant connections required by the Enclave Stamper and Evidence Ops Engine.

## Overview

The bootstrap process automates the 6-step manual tenant setup:

1. Creates Entra ID app registration
2. Generates self-signed certificate (2-year validity)
3. Attaches certificate to app registration
4. Grants required Microsoft Graph API permissions with admin consent
5. Writes `.env` configuration file
6. Validates connectivity

## Prerequisites

- **PowerShell 7+** - [Download](https://aka.ms/powershell)
- **Global Administrator role** in target tenant
- Network access to Microsoft endpoints (`.us` for GCC High, `.com` for Commercial)
- Windows environment (primary operator platform)

## Usage

### Option 1: Via Stamper CLI (Recommended)

```powershell
# Commercial tenant
stamper bootstrap --tenant-id <guid> --display-name "CMMC-Dev" --environment commercial

# GCC High tenant
stamper bootstrap --tenant-id <guid> --display-name "CMMC-Automation" --environment gcchigh

# With custom paths
stamper bootstrap \
  --tenant-id <guid> \
  --display-name "CMMC-Automation" \
  --environment gcchigh \
  --output "C:\custom-path\.env" \
  --cert-store-path "C:\secure-certs"

# With certificate password (less secure - will be visible in command history)
stamper bootstrap \
  --tenant-id <guid> \
  --display-name "CMMC-Automation" \
  --environment gcchigh \
  --cert-password "MyP@ssw0rd!"
```

### Option 2: Direct PowerShell Execution

```powershell
# Navigate to scripts directory
cd stamper\scripts

# Commercial tenant
.\New-TenantBootstrap.ps1 `
  -TenantId "12345678-1234-1234-1234-123456789012" `
  -DisplayName "CMMC-Dev" `
  -Environment Commercial

# GCC High tenant
.\New-TenantBootstrap.ps1 `
  -TenantId "12345678-1234-1234-1234-123456789012" `
  -DisplayName "CMMC-Automation" `
  -Environment GCCHigh

# With pre-set certificate password
$certPassword = ConvertTo-SecureString "MySecurePassword123!" -AsPlainText -Force
.\New-TenantBootstrap.ps1 `
  -TenantId "..." `
  -DisplayName "CMMC-Automation" `
  -Environment GCCHigh `
  -CertPassword $certPassword `
  -OutputPath "C:\custom\.env" `
  -CertStorePath "C:\secure-certs"
```

## Parameters

| Parameter | Required | Description | Default |
|-----------|----------|-------------|---------|
| `TenantId` | Yes | Azure AD tenant ID (GUID format) | - |
| `DisplayName` | Yes | Display name for app registration | - |
| `Environment` | Yes | `Commercial` or `GCCHigh` | - |
| `CertPassword` | No | SecureString password for .pfx export | Interactive prompt |
| `OutputPath` | No | Path to write .env file | `stamper\.env` |
| `CertStorePath` | No | Directory for certificate storage | `C:\stamper-certs` |

## What Happens During Bootstrap

### 1. Prerequisite Check
- Verifies PowerShell 7+ installed
- Auto-installs Microsoft.Graph module if missing
- Tests network connectivity to Microsoft endpoints

### 2. Interactive Authentication
- Prompts for Global Administrator sign-in
- Requires `Application.ReadWrite.All` and `AppRoleAssignment.ReadWrite.All` scopes
- Uses device code flow for GCC High environments if needed

### 3. App Registration
- Checks for existing app by display name (idempotent)
- Creates new Entra ID app registration if not found
- Configures for single-tenant access

### 4. Certificate Generation
- Creates 2048-bit RSA self-signed certificate
- Valid for 2 years from creation date
- Stores in user certificate store (`Cert:\CurrentUser\My`)
- Exports both .pfx (private key) and .cer (public key)

### 5. Permission Granting
Automatically grants the following Microsoft Graph application permissions:

- `Policy.ReadWrite.ConditionalAccess` - Conditional access policies
- `Directory.ReadWrite.All` - Directory objects (users, groups, devices)
- `DeviceManagementConfiguration.ReadWrite.All` - Intune configuration
- `DeviceManagementManagedDevices.ReadWrite.All` - Device management
- `DeviceManagementServiceConfig.ReadWrite.All` - Intune service config
- `User.ReadWrite.All` - User management
- `Group.ReadWrite.All` - Group management
- `RoleManagement.ReadWrite.Directory` - Role assignments
- `Organization.ReadWrite.All` - Organization settings
- `Policy.ReadWrite.Authorization` - Authorization policies
- `AuditLog.Read.All` - Audit logs
- `SecurityEvents.ReadWrite.All` - Security events
- `ThreatIndicators.ReadWrite.OwnedBy` - Threat indicators
- `IdentityRiskyUser.ReadWrite.All` - Risky users
- `IdentityRiskEvent.ReadWrite.All` - Risk events

Admin consent is granted programmatically (no portal interaction needed).

### 6. .env File Generation

Creates a configuration file matching StamperConfig format:

**GCC High Example:**
```env
TENANT_ID=12345678-1234-1234-1234-123456789012
APP_ID=87654321-4321-4321-4321-210987654321
CERT_THUMBPRINT=A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8S9T0
CERT_PATH=C:\stamper-certs\CMMC-Automation.pfx

GCC_HIGH_ENDPOINTS=True
GRAPH_ENDPOINT=https://graph.microsoft.us
LOGIN_ENDPOINT=https://login.microsoftonline.us
EXCHANGE_ENV=O365USGovGCCHigh
COMPLIANCE_URI=https://ps.compliance.protection.office365.us/powershell-liveid/
AZURE_AUTH_ENDPOINT=https://login.microsoftonline.us/organizations

STORAGE_ROOT=C:\stamper-storage
STATE_DIR=C:\stamper-storage\state
EVIDENCE_DIR=C:\stamper-storage\evidence
LOG_LEVEL=info
LOG_DIR=C:\stamper-storage\logs
DRY_RUN=false
ENABLE_ROLLBACK=true
IDEMPOTENCY_CHECK=true
```

**Commercial Example:**
```env
TENANT_ID=12345678-1234-1234-1234-123456789012
APP_ID=87654321-4321-4321-4321-210987654321
CERT_THUMBPRINT=A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8S9T0
CERT_PATH=C:\stamper-certs\CMMC-Dev.pfx

GCC_HIGH_ENDPOINTS=False
GRAPH_ENDPOINT=https://graph.microsoft.com
LOGIN_ENDPOINT=https://login.microsoftonline.com
EXCHANGE_ENV=O365Default
COMPLIANCE_URI=https://ps.compliance.protection.outlook.com/powershell-liveid/
AZURE_AUTH_ENDPOINT=https://login.microsoftonline.com/organizations

STORAGE_ROOT=C:\stamper-storage
STATE_DIR=C:\stamper-storage\state
EVIDENCE_DIR=C:\stamper-storage\evidence
LOG_LEVEL=info
LOG_DIR=C:\stamper-storage\logs
DRY_RUN=false
ENABLE_ROLLBACK=true
IDEMPOTENCY_CHECK=true
```

### 7. Connectivity Validation
- Disconnects interactive session
- Reconnects using certificate-based authentication
- Tests Graph API with `Get-MgOrganization`
- Displays granted permissions

## Post-Bootstrap Verification

After bootstrap completes, verify the setup:

```powershell
# 1. Verify .env file exists
Get-Content stamper\.env

# 2. Verify certificate is in store
Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -like "*CMMC*" }

# 3. Test Stamper configuration loads
stamper validate test-plan.json

# 4. Manual connectivity test (PowerShell)
$tenantId = "..."
$appId = "..."
$thumbprint = "..."

Connect-MgGraph -ClientId $appId -TenantId $tenantId -CertificateThumbprint $thumbprint -Environment USGov
Get-MgOrganization
Disconnect-MgGraph
```

## Idempotency

The bootstrap script is **idempotent** and safe to re-run:

- If app registration exists, it will be reused
- Certificate will be regenerated and attached
- Permissions will be re-granted (skipping already-granted permissions)
- .env file will be overwritten

**Use case:** Certificate rotation, permission updates, environment migration

## Troubleshooting

### Module Installation Failures

**Symptom:** `Install-Module` fails with "Unable to download from URI"

**Solution:**
```powershell
# Trust PSGallery repository
Set-PSRepository -Name PSGallery -InstallationPolicy Trusted

# Retry installation
Install-Module Microsoft.Graph -Scope CurrentUser -Force
```

### Permission Errors During Grant

**Symptom:** `New-MgServicePrincipalAppRoleAssignment` fails with "Insufficient privileges"

**Solution:**
- Ensure you're signed in as Global Administrator
- Re-run `Connect-MgGraph` with required scopes:
  ```powershell
  Connect-MgGraph -Scopes "Application.ReadWrite.All","AppRoleAssignment.ReadWrite.All"
  ```

### GCC High Endpoint Connectivity Issues

**Symptom:** `Connect-MgGraph` fails with "Unable to connect to remote server"

**Solution:**
- Verify tenant is actually GCC High (not standard GCC)
- Test network connectivity:
  ```powershell
  Test-NetConnection -ComputerName graph.microsoft.us -Port 443
  Test-NetConnection -ComputerName login.microsoftonline.us -Port 443
  ```
- Check firewall/proxy settings
- Ensure you're using `-Environment USGov` parameter

### Certificate Not Found After Bootstrap

**Symptom:** StamperConfig validation fails with "Certificate file not found"

**Solution:**
- Verify `CERT_PATH` in .env points to existing .pfx file
- Check certificate was exported successfully:
  ```powershell
  Test-Path "C:\stamper-certs\CMMC-Automation.pfx"
  ```
- Ensure certificate password is stored securely for later use

### Permissions Not Active After Bootstrap

**Symptom:** `stamper execute` fails with "Insufficient privileges to complete the operation"

**Solution:**
- Wait 5-10 minutes for Azure AD permission propagation
- Verify permissions granted:
  ```powershell
  Connect-MgGraph -ClientId <app-id> -TenantId <tenant-id> -CertificateThumbprint <thumbprint>
  Get-MgContext | Select-Object -ExpandProperty Scopes
  ```
- Check Azure portal: App Registrations → [Your App] → API Permissions

### Certificate Expiration

**Symptom:** Authentication fails after 2 years

**Solution:**
- Certificates are valid for 2 years
- Set a calendar reminder 6 months before expiration
- Re-run bootstrap script to generate new certificate:
  ```powershell
  .\New-TenantBootstrap.ps1 -TenantId <id> -DisplayName <name> -Environment <env>
  ```
- Script will create new certificate and attach to existing app registration

## Security Best Practices

1. **Certificate Storage**
   - Store .pfx files outside source control
   - Use Azure Key Vault for production environments (future enhancement)
   - Backup certificates to secure offline storage

2. **Password Management**
   - Never commit certificate passwords to Git
   - Use environment-specific password managers
   - Prefer interactive password prompt over CLI parameter

3. **Least Privilege**
   - Review granted permissions against actual requirements
   - Remove unused permissions after initial setup
   - Use separate app registrations for dev/test/prod

4. **Audit Trail**
   - App registration changes are logged in Azure AD audit logs
   - Certificate usage is logged in sign-in logs
   - Monitor for anomalous authentication patterns

5. **Certificate Rotation**
   - Rotate certificates every 18-24 months
   - Maintain overlapping validity periods during rotation
   - Test new certificates before removing old ones

## Support

For issues not covered in troubleshooting:

1. Check Azure AD audit logs for detailed error messages
2. Verify Microsoft Graph module version: `Get-Module Microsoft.Graph -ListAvailable`
3. Test connectivity manually outside the script
4. Review PowerShell execution policy: `Get-ExecutionPolicy`

## Deprecation Notices

- **AzureAD/MSOnline modules:** End of life March 2025, use Microsoft.Graph
- **Client secrets:** Prefer certificate-based authentication for security
- **Delegated permissions:** Use application permissions for automation

## Future Enhancements

- Azure Key Vault integration for certificate storage
- Automated certificate rotation/renewal
- Multi-cloud support (AWS/GCP)
- Interactive TUI for guided setup
- Permission set templates per CMMC level

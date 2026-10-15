# Enclave Stamper

CMMC Compliance Orchestration Engine for M365/Azure GCC High environments.

## Overview

The Enclave Stamper is a task orchestration engine that consumes Executable Mission Plans from CSE-FE and executes them against M365/Azure GCC High tenant environments. It validates prechecks, walks a topologically-sorted execution graph of CMMC L2 tasks, dispatches each task to the appropriate engine adapter, collects evidence artifacts, handles rollback on failure, and validates postchecks.

## Features

- **Multi-Engine Support**: PowerShell, CLI, API, Manual Gate (Terraform/Bicep planned for Phase 4)
- **GCC High Authentication**: Certificate-based authentication for M365 GCC High environments
- **Evidence Collection**: NIST-approved SHA-256 hashing with 6-year retention support
- **State Management**: Resume-from-failure capability with idempotency checking
- **Rollback Support**: Automatic and manual rollback strategies
- **Dry-Run Mode**: Validate plans without executing tasks

## Installation

```bash
npm install
npm run build
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Required configuration for GCC High:
- `TENANT_ID`: Your GCC High tenant ID
- `APP_ID`: Entra ID app registration ID
- `CERT_THUMBPRINT`: Certificate thumbprint
- `CERT_PATH`: Path to certificate file (.pfx)

## Usage

### Execute a Plan

```bash
stamper execute path/to/plan.json
```

### Dry-Run Mode

```bash
stamper execute path/to/plan.json --dry-run
```

### Validate a Plan

```bash
stamper validate path/to/plan.json
```

## GCC High Setup

1. Register an Entra ID app in your GCC High tenant (portal.azure.us)
2. Generate a self-signed certificate:
   ```powershell
   $cert = New-SelfSignedCertificate -Subject "CN=StamperApp" -CertStoreLocation "Cert:\CurrentUser\My" -KeyExportPolicy Exportable -KeySpec Signature
   ```
3. Export certificate to .pfx and .cer files
4. Upload .cer to Entra ID app registration
5. Grant API permissions:
   - Microsoft Graph: Directory.Read.All, User.ReadWrite.All, Policy.ReadWrite.All
   - Exchange: Exchange.ManageAsApp
   - Security & Compliance: Compliance.ReadWrite.All
6. Update .env with your configuration

## Evidence Storage

Evidence artifacts are stored in the directory structure:
```
evidence/
  {plan_id}/
    {task_id}/
      {artifact_id}/
        content.json (or .pdf, .csv, etc.)
        metadata.json
```

Each artifact includes:
- SHA-256 hash for integrity verification
- Metadata (task_id, control_ids, timestamp, collector, retention_days)
- Automatic retention tracking

## Architecture

### Core Components

- **StamperEngine**: Main orchestrator
- **DependencyResolver**: Task dependency validation and topological sorting
- **TaskRunner**: Task dispatcher to engine adapters
- **StateManager**: Execution state persistence for resume capability
- **IdempotencyGuard**: Safe task re-execution logic

### Engine Adapters

- **PowerShellAdapter**: Executes PowerShell commands with M365 module support
- **CLIAdapter**: Shell command execution
- **APIAdapter**: REST API calls
- **ManualGateAdapter**: Human-in-the-loop workflow
- **TerraformAdapter**: (Phase 4) Terraform apply
- **BicepAdapter**: (Phase 4) Azure Bicep deployments

### Evidence System

- **EvidenceCollector**: Captures execution outputs
- **EvidenceStore**: File system storage with metadata
- **HashingService**: SHA-256 hashing for C3PAO compliance

## Development

### Build

```bash
npm run build
```

### Watch Mode

```bash
npm run watch
```

### Testing

```bash
npm test
```

## License

PROPRIETARY - BHD-VFS

# CRM Inheritance Package (vfsgov) — G-EUT-5 Phase 4

**Purpose:** vfsgov runs on Microsoft GCC High (Azure Government + M365 GCC High), a **FedRAMP
High**-authorized platform. For controls the platform implements, the SSP must **cite
Microsoft's Customer Responsibility Matrix (CRM)** — the shared-responsibility document that
states which control objectives Microsoft satisfies and which remain the customer's. An SSP that
claims inheritance **without** the CRM citation is a documented assessment finding.

> **BLOCKED: needs Microsoft GCC High CRM.** The CRM is obtained under NDA from
> `O365FedRAMP@microsoft.com` (and the Azure Government FedRAMP package via the Service Trust
> Portal). Until it is on file, every citation slot below is marked `BLOCKED: needs Microsoft
> CRM` — non-failing but **visibly incomplete** (plan MED-2). The tenant-side confirmations are
> real today; only the Microsoft-side citation is pending.

## Inheritance model (three buckets)

CES already computes a Shared Responsibility Matrix in the SSP
(`SharedResponsibilityMatrixGenerator`; fallback totals **12 inherited · 40 shared · 58
customer** across the 110). This package is the **evidence backing** for the inherited + shared
buckets. Three disposition types map to inheritance:

| Bucket | Meaning | CRM role |
|--------|---------|----------|
| **INHERITED** | Platform fully implements the objective | Cite CRM "Microsoft responsibility"; suite confirms tenant does not override |
| **Shared** | Platform + customer each implement part | Cite CRM shared line; suite confirms the customer-side portion |
| **ATTEST (platform-operated)** | Microsoft operates it (datacenters, maintenance) | Cite CRM/FedRAMP package; org attests its slice |

## Explicitly-inherited controls (from `vfsgov.applicability.json`)

| Control | Practice | Inheritance basis | Microsoft CRM citation | Tenant-side confirmation (suite) |
|---------|----------|-------------------|------------------------|----------------------------------|
| SC.L2-3.13.2 | Security architecture/engineering | Azure GCC High FedRAMP High | `BLOCKED: needs Microsoft CRM` | applicability INHERITED + ssp_ref |
| SC.L2-3.13.4 | Shared-resource isolation | Azure GCC High platform | `BLOCKED: needs Microsoft CRM` | applicability INHERITED + ssp_ref |
| SC.L2-3.13.7 | Split-tunneling blocked | VDI/Cloud-PC egress (platform) | `BLOCKED: needs Microsoft CRM` | UC-F VDI/egress + applicability |

## Platform-operated controls (ATTEST — Microsoft datacenter / maintenance)

These are inherited from Microsoft's physical + maintenance operations; the CRM / FedRAMP SSP is
the citation, the customer attests the office-side slice.

| Controls | Family | Basis | Microsoft CRM citation |
|----------|--------|-------|------------------------|
| MA.L2-3.7.1 / .2 / .4 / .6 | MA | Cloud maintenance is Microsoft-operated | `BLOCKED: needs Microsoft CRM` |
| PE.L1-3.10.1 … 3.10.6 | PE | Physical protection — GCC High datacenters | `BLOCKED: needs Microsoft CRM` |

*(PS.L2-3.9.1 and AT.L2-3.2.1/.3 are ATTEST but customer-org responsibilities — HR/training —
not Microsoft-inherited, so no CRM citation; see the interview matrix.)*

## Shared controls (customer confirms tenant side; CRM confirms platform side)

The ~40 shared controls (per the SRM `byFamily` split) are implemented by tenant configuration
**on top of** platform capabilities. For each, the SSP narrative should read: *"Platform provides
<X per CRM>; the tenant enforces <Y, confirmed by suite probe Z>."* The suite already supplies the
tenant-side proof (UC-A…UC-F PASS rows); the **platform side is `BLOCKED: needs Microsoft CRM`**
until the matrix is on file. Families with the largest shared surface: AC (10), SC (5), IA (5),
AU (4), CM (4), MP (3).

## What unblocks this

1. Obtain the **Microsoft GCC High CRM** (M365) + **Azure Government FedRAMP package** (Service
   Trust Portal), under NDA.
2. Wire the CRM's per-control responsibility line into the SSP via
   `SharedResponsibilityMatrixGenerator` (the generator + `AdminOpsKnowledgeBankLoader` seam
   already exists — it currently uses architecture heuristics + a fallback table).
3. Replace each `BLOCKED: needs Microsoft CRM` slot above with the CRM citation; the disposition
   rows in `vfsgov.applicability.json` already carry the `ssp_ref` anchor.

*Status: package scaffolded with every Microsoft-side citation marked BLOCKED. Tenant-side
confirmations are live. The single external dependency is the Microsoft CRM document.*

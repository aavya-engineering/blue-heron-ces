# REQ: ces-shared AdminOps evidence contract (AE-R2)

**Target:** ces-shared  
**Filed by:** ces-eo (flow-through-2026-09)  
**Date:** 2026-09-26  
**Priority:** P0 — blocks AE-R4 (EO reader) and AE-R6 (E2E tests)

## What

Publish a versioned AdminOps evidence contract as a shared TypeScript type + Zod schema
in `ces-shared/src/types/adminops-evidence.types.ts`. Both ces-ao (writer) and ces-eo (reader)
compile and validate against it.

## Schema (verbatim from FLOW-THROUGH-PLAN-2026-09-26.md AE-R2)

```typescript
import { z } from 'zod';

export const AdminOpsEvidenceOutcome = z.enum([
  'executed',
  'dry_run',
  'denied_cmmc',
  'denied_cui',
  'blocked_pending_approval',
  'approval_rejected',
  'failed',
]);

export const AdminOpsEvidenceSchema = z.object({
  contractVersion: z.string(),
  commandId: z.string(),
  tenantId: z.string(),
  tenantSlug: z.string(),
  tenantKind: z.string().optional(),
  mode: z.enum(['dry_run', 'live']),
  dryRun: z.boolean(),
  outcome: AdminOpsEvidenceOutcome,
  controlIds: z.array(z.string()).min(1),
  correlationId: z.string().optional(),
  requestorUPN: z.string().optional(),
  approverUPN: z.string().optional(),
  approvalId: z.string().optional(),
  timestamp: z.string(),
  executionTimestamp: z.string().optional(),
  preStateOutput: z.string().optional(),
  postStateOutput: z.string().optional(),
  verdict: z.string(),
  verdictRationale: z.string().optional(),
  sha256: z.string(),
});

export type AdminOpsEvidence = z.infer<typeof AdminOpsEvidenceSchema>;
```

## Why

Three independent definitions of the evidence shape exist (Stamper Zod, AO hand-copy,
EO loose parser), none in ces-shared, no version field. Without a shared contract:
- AO and EO can drift silently
- EO cannot parse AO rows safely (a dry-run row with SAT verdict would inflate SPRS)
- No compile-time guarantee that both sides agree on the shape

## Acceptance test

1. `ces-shared` unit test: `AdminOpsEvidenceSchema.parse()` accepts a conforming row and
   rejects rows missing required fields.
2. ces-ao conformance test: every execution path (success, failure, each deny, dry-run,
   pending, rejected) produces a row that passes `AdminOpsEvidenceSchema.parse()`.
3. Both `ces-ao` and `ces-eo` import the type and `npx tsc --noEmit` passes in both.

## Current EO workaround

ces-eo carries a local mirror of this schema at `src/eo/adminops/adminops-evidence.contract.ts`
until the shared version lands. When ces-shared ships AE-R2, the local file is deleted and the
import path updated.

## Status

**Closed — 2026-09-27.** Satisfied by ces-shared commit `c0b80b3` (flow-through AE-R2:
AdminOps evidence contract + never-inflate invariant). The shared schema, outcome enum,
type export, and `adminops_execution` AssessmentSource type are all shipped. EO local mirror
remains until E5 (gate: AO A4 golden) lands.

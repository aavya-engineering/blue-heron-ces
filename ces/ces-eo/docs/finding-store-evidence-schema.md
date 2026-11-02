# FindingStore Schema Extension -- Evidence Artifact Reference Tracking

**Status:** DESIGN ONLY (Sprint 1 GATE 0)
**Implementation Target:** Phase 1.2 (Evidence Artifact Reference Tracking)
**Date:** 2026-04-13

## 1. Problem Statement

The current `DriftFinding` type tracks compliance drift events but does not link findings to the specific evidence artifacts stored in Azure Blob Storage. The DOCX SSP exporter needs to reference evidence artifacts (with SHA-256 hashes) in control implementation narratives and evidence tables. A schema extension is needed to bridge FindingStore data to EvidenceStore artifacts.

## 2. P0 Field Naming Resolution

The `ControlAssessment` interface previously had duplicate fields:
- `evidence_artifact_ids` (snake_case, line 19) -- REMOVED in Sprint 1
- `evidenceArtifactIds` (camelCase, line 23) -- KEPT as canonical

All consumers now use `evidenceArtifactIds` (camelCase), consistent with TypeScript naming conventions. Affected files:
- `src/shared/types/controls.types.ts` -- field removed from interface
- `src/eo/assessment/ControlAssessor.ts` -- assignment removed from `merge()` method
- `src/eo/generation/SnippetTemplateEngine.ts` -- `buildContext()` and `fallbackNarrative()` updated

## 3. Proposed `evidenceArtifacts[]` Field Structure

Extend `DriftFinding` (or a new lookup type) with an `evidenceArtifacts` array:

```typescript
interface EvidenceArtifactRef {
  blobPath: string;        // Azure Blob path: "evidence/{tenantId}/{controlId}/{artifactId}.json"
  sha256Hash: string;      // SHA-256 hash of artifact content for integrity verification
  collectionDate: string;  // ISO-8601 timestamp of when evidence was collected
  source: 'ec_capture' | 'discovery' | 'manual' | 'imported';  // How the artifact was obtained
}
```

Usage in DriftFinding (Phase 1.2 implementation):
```typescript
export interface DriftFinding {
  // ... existing fields ...
  evidenceArtifacts?: EvidenceArtifactRef[];  // Optional: linked evidence artifacts
}
```

## 4. Hash Lookup Flow

The DOCX exporter needs to resolve evidence artifact references from control assessments to actual blob data with integrity hashes. The flow is:

```
ControlAssessment.evidenceArtifactIds[]
  |
  v
FindingStore (optional: check for drift findings related to control)
  |
  v
EvidenceStore.getArtifact(artifactId)
  -> Returns: { blobPath, sha256Hash, content, metadata }
  |
  v
SspDocxExporter
  -> Renders: artifact reference with hash in evidence table
  -> Format: "Artifact: {artifactId} | SHA-256: {hash} | Collected: {date}"
```

### Sequence:
1. `SspDocxExporter` receives `SystemSecurityPlan` with `controlImplementations[].evidenceReferences[]`
2. For each evidence reference, query `EvidenceStore` via `EcClient` to resolve blob path and SHA-256 hash
3. If `EcClient` is unavailable (graceful degradation), use artifact IDs as-is without hash verification
4. Include resolved artifact data in DOCX evidence tables with integrity hashes

## 5. Storage Location Decision

### Option A: Extend EvidenceManifest
Add `evidenceArtifacts[]` to the existing `EvidenceManifest` stored in Azure Blob Storage.

- **Pro:** Single source of truth for evidence metadata; already managed by EC
- **Con:** Requires EC to be running for artifact resolution; increases manifest size

### Option B: New `control-to-artifact-map.json`
Create a separate mapping file that links control IDs to artifact references.

- **Pro:** Can be generated offline; works without EC running; simpler cache invalidation
- **Con:** Another file to maintain; potential staleness if EC captures new artifacts

### Decision: Option A (Extend EvidenceManifest)

Rationale: The EvidenceManifest is already the canonical record of evidence artifacts in Azure Blob Storage. Extending it maintains a single source of truth. The `EcClient` graceful degradation pattern already handles the case where EC is unavailable -- the DOCX exporter will include artifact IDs without hashes in that scenario.

The manifest extension adds minimal overhead (one array field per finding) and avoids the consistency problems of a separate mapping file that could become stale.

## 6. Implementation Notes (Phase 1.2)

When implementing in Phase 1.2:

1. Add `EvidenceArtifactRef` type to `src/shared/types/drift.types.ts`
2. Extend `DriftFinding` with optional `evidenceArtifacts?: EvidenceArtifactRef[]`
3. Update `FindingStore.append()` to accept and store artifact references
4. Add `EcClient.resolveArtifactHash(artifactId: string): Promise<EvidenceArtifactRef | null>` method
5. Wire `SspDocxExporter` to resolve hashes during DOCX generation
6. Ensure backward compatibility: existing findings without `evidenceArtifacts` field continue to work

## 7. Open Questions

- Should artifact hashes be verified at DOCX generation time (re-fetch and re-hash) or trusted from collection time?
- What is the retention policy for evidence artifacts? Should expired artifacts be flagged in the SSP?
- Should the mapping support multiple artifacts per control (e.g., different collection dates)?

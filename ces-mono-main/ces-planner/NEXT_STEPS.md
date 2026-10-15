# Next Steps - CES-FE Implementation

This document outlines the remaining work to complete the CMMC Compliance Tool.

## Current Status

**COMPLETED:**
- Phase 1: Foundation (100%)
  - Project initialization with Vite + React + TypeScript
  - Database schema with Dexie (7 tables, compound indexes)
  - Schema validation with AJV (13 validators compiled)
  - YAML loading service with IndexedDB caching
  - Shared components library (9 components)
  - Utility functions and configuration

- Phase 2: Customer & Landing Page (100%)
  - Customer management (create, select, list)
  - Landing page with workflow progress visualization
  - Workflow state detection from database
  - Navigation and routing

**PENDING:**
- Phase 3: SIT Implementation (0%)
- Phase 4: RRT Implementation (0%)
- Phase 5: MPT Implementation (0%)
- Testing Infrastructure (0%)
- UI/UX Polish (0%)

## Getting Started

### 1. Install Dependencies

```bash
cd "C:\Users\Veteran\Documents\dev\BHD\ces-fe"
npm install
```

### 2. Start Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### 3. Test Current Implementation

1. Create a customer
2. Select the customer to navigate to dashboard
3. View workflow progress
4. Click on SIT/RRT/MPT buttons to see placeholder pages

## Implementation Roadmap

### Phase 3: SIT Implementation (Estimated: 2-3 days)

#### Task 8: Implement SIT Question Wizard

**Files to Create:**
1. `src/features/sit/stores/sitStore.ts` - Zustand store for SIT state
2. `src/features/sit/hooks/useSITQuestions.ts` - Load and filter SI questions
3. `src/features/sit/components/SITWizard.tsx` - Main wizard container
4. `src/features/sit/components/QuestionPage.tsx` - Single question display
5. `src/features/sit/components/AnswerInput.tsx` - Dynamic input based on answer type
6. `src/features/sit/components/AdvisorGuidance.tsx` - Collapsible guidance panel
7. `src/features/sit/types.ts` - SIT-specific types

**Implementation Steps:**
1. Create sitStore with currentStep, answers, questionBank state
2. Load SI Question Bank in useSITQuestions hook
3. Build SITWizard with navigation (back/next/submit)
4. Implement QuestionPage to display question + guidance
5. Create AnswerInput to handle enum/string/number/boolean/array types
6. Add progress indicator (X of Y questions)
7. Store answers with provenance tracking

**Reference:**
- Question schema: `public/schemas/primed SI Question Bank.schema.json`
- Question data: `public/data/primed SI Question Bank.yaml`
- Answer types defined in: `src/shared/types/questions.ts`

#### Task 9: Implement SI Baseline Generation

**Files to Create:**
1. `src/features/sit/services/baselineGenerator.ts` - Map answers to baseline
2. `src/features/sit/components/BaselineReview.tsx` - Review before save
3. `src/features/sit/hooks/useAnswerMapping.ts` - Answer → field mapping

**Implementation Steps:**
1. Create baselineGenerator service
2. Map each answer to si_baseline field using question's baseline_field_mapping
3. Build complete SIBaseline artifact with metadata
4. Validate against schema using validationService
5. Display BaselineReview component with formatted data
6. Save to IndexedDB with isImmutable = true
7. Navigate back to dashboard

**Schema Reference:**
- SI Baseline schema: `public/schemas/CES SIT Strategic Intent Baseline.schema.json`
- Validation: `src/shared/validation/validators.ts` - `validateSIBaseline()`

#### Task 10: Implement RR Question Set Derivation

**Files to Create:**
1. `src/features/sit/services/questionSetGenerator.ts` - Generate RR Q-Set
2. `src/features/sit/components/QuestionSetReview.tsx` - Review generated set

**Implementation Steps:**
1. Load RR Question Bank
2. Filter activities based on SI Baseline fields:
   - target_cmmc_level → filter by applicability_conditions.target_level
   - cui_presence → filter by applicability_conditions.cui_presence
   - boundary_strategy → filter by applicability_conditions.boundary_strategy
   - deployment_posture → filter by applicability_conditions.deployment_posture
3. Build RRQuestionSet artifact with filtered activities
4. Validate against schema
5. Save to IndexedDB linked to baselineId
6. Navigate to dashboard

**Schema Reference:**
- RR Question Set schema: `public/schemas/CES SIT Scenario-Specific Question Set.schema.json`
- RR Question Bank: `public/data/primed RR Question Bank.yaml`

### Phase 4: RRT Implementation (Estimated: 3-4 days)

#### Task 11: Implement RRT Question Wizard

**Files to Create:**
1. `src/features/rrt/stores/rrtStore.ts` - Zustand store for RRT state
2. `src/features/rrt/hooks/useRRTQuestions.ts` - Load RR Question Set from DB
3. `src/features/rrt/components/RRTWizard.tsx` - Main wizard
4. `src/features/rrt/components/RRQuestionPage.tsx` - Single RR question
5. `src/features/rrt/components/EvidenceCollector.tsx` - Attach evidence
6. `src/features/rrt/components/ProvenanceSelector.tsx` - Select provenance class
7. `src/features/rrt/components/AutofillButton.tsx` - Dev mode autofill
8. `src/features/rrt/services/autofillService.ts` - Generate plausible answers
9. `src/features/rrt/types.ts` - RRT-specific types

**Implementation Steps:**
1. Create rrtStore with persist middleware
2. Load RR Question Set from database
3. Display activities and questions in order
4. Show mapped requirements for each question
5. Capture answers with provenance class enum
6. Allow evidence references (file paths, hashes)
7. Implement autofill (dev mode only) - populate reasonable answers
8. Store all data in rrtStore

**Dev Mode Autofill Logic:**
- For boolean: Random true/false
- For enum: Select first valid option
- For string: Generate sample text
- For number: Random within reasonable range

#### Task 12: Implement Readiness Posture Generation

**Files to Create:**
1. `src/features/rrt/services/postureGenerator.ts` - Generate posture artifact
2. `src/features/rrt/components/PostureReview.tsx` - Review before save
3. `src/features/rrt/hooks/useRequirementMapping.ts` - Map answers to requirements

**Implementation Steps:**
1. Load CMMC Requirements from domain data
2. Map RRT answers to requirement results:
   - If answer indicates full compliance → status = "met"
   - If answer indicates partial compliance → status = "partial"
   - If answer indicates non-compliance → status = "not_met"
   - If insufficient data → status = "unknown"
3. Build evidence index from collected evidence references
4. Compute control_status_summary (count met/partial/not_met/unknown)
5. Generate key_findings based on critical gaps
6. Validate ReadinessPosture against schema
7. Save to IndexedDB
8. Navigate to dashboard

**Schema Reference:**
- Readiness Posture schema: `public/schemas/CES RRT Readiness Posture.schema.json`
- CMMC Requirements: `public/data/domain CES CMMC Fundamental Requirements Store.yaml`

### Phase 5: MPT Implementation (Estimated: 4-5 days)

#### Task 13: Implement Gap Analysis

**Files to Create:**
1. `src/features/mpt/services/gapCompiler.ts` - Identify gaps
2. `src/features/mpt/types.ts` - GapSet, TaskCatalog types

**Implementation Steps:**
1. Load Readiness Posture from DB
2. Filter requirement_results where status = "not_met", "partial", or "unknown"
3. Load CMMC Requirements and Assessor KB for context
4. Build GapSet with requirement details, current status, expected state
5. Return structured gap data for task compilation

#### Task 14: Implement Task Compilation

**Files to Create:**
1. `src/features/mpt/services/taskCompiler.ts` - Build task catalog

**Implementation Steps:**
1. Load Tech Stack Mapping (vendor capabilities)
2. For each gap, identify matching vendor capabilities
3. Build task catalog with:
   - Implementation tasks from vendor configurations
   - Dependencies between tasks
   - Priority based on requirement criticality
   - Estimated effort/cost
4. Return TaskCatalog for plan generation

#### Task 15: Implement Artifact Generators

**Files to Create:**
1. `src/features/mpt/services/manualPlanGenerator.ts` - Manual Plan
2. `src/features/mpt/services/execPlanGenerator.ts` - Executable Plan
3. `src/features/mpt/services/proposalGenerator.ts` - Proposal + SOW
4. `src/features/mpt/services/manifestGenerator.ts` - Tenant Manifest
5. `src/features/mpt/services/validator.ts` - Cross-artifact validation

**Implementation Steps:**

**Manual Plan:**
1. Group tasks into logical milestones
2. Define steps with actions, responsibilities, completion criteria
3. Map requirements to steps
4. Validate against schema

**Executable Plan:**
1. Convert tasks to executable format
2. Define engine (PowerShell, Ansible, etc.)
3. Specify args, prechecks, postchecks
4. Set dependencies
5. Validate against schema

**Proposal:**
1. Generate line items from task catalog
2. Map each item to plan steps
3. Calculate costs (from vendor cost models)
4. Create SOW sections
5. Validate against schema

**Tenant Manifest:**
1. Define normative controls from requirement results
2. Create drift policies for automated monitoring
3. Set up evidence monitors for continuous collection
4. Validate against schema

**Cross-Validation:**
1. Ensure proposal line items map to manual plan steps
2. Ensure exec plan tasks cover manual plan controls
3. Ensure tenant manifest monitors match plan artifacts
4. Fail save if validation errors

#### Task 16: Implement MPT UI

**Files to Create:**
1. `src/features/mpt/components/MPTGenerator.tsx` - Main orchestrator
2. `src/features/mpt/components/PlanViewer.tsx` - Display Manual Plan
3. `src/features/mpt/components/ExecPlanViewer.tsx` - Display Exec Plan
4. `src/features/mpt/components/ProposalViewer.tsx` - Display Proposal
5. `src/features/mpt/components/ManifestViewer.tsx` - Display Manifest
6. `src/features/mpt/components/GapAnalysisPanel.tsx` - Show gaps
7. `src/features/mpt/hooks/useMPTGeneration.ts` - Orchestrate generation
8. `src/features/mpt/stores/mptStore.ts` - State (no persist)

**Implementation Steps:**
1. Create MPTGenerator with generation button
2. On click, run all generators in sequence
3. Display progress indicator
4. Show all 4 artifacts in tabs or accordion
5. Save complete MissionPlan to DB
6. Navigate to dashboard

## Testing Strategy

### Unit Tests (Vitest)
Create tests for:
- Validation functions (validators.ts)
- Data loading (dataLoader.ts)
- Store actions (sitStore, rrtStore, appStore)
- Service functions (baselineGenerator, postureGenerator)

### Integration Tests
Test complete workflows:
- Customer → SIT → SI Baseline
- SI Baseline → RR Q-Set
- RR Q-Set → RRT → Readiness Posture
- Readiness Posture → MPT → Mission Plan

### E2E Tests (Playwright)
Test UI workflows:
- Create customer and select
- Complete SIT wizard
- Complete RRT wizard
- Generate mission plan
- Test autofill functionality

## Development Tips

### Debugging Data Loading
```typescript
// Check if schemas loaded
console.log('Schemas loaded:', schemaLoader.isLoaded());

// Check cached YAML data
const cached = await dbHelpers.getQuestionBank('SI_QUESTION_BANK');
console.log('Cached SI QB:', cached);
```

### Database Inspection
```typescript
// In browser console
const db = new Dexie('CMMCComplianceTool');
await db.open();
const customers = await db.customers.toArray();
console.log(customers);
```

### Testing Validation
```typescript
import { validationService } from '@/shared/validation/validators';

const result = validationService.validateSIBaseline(myData);
if (!result.valid) {
  console.error('Validation errors:', result.errors);
}
```

## File Structure Reference

```
src/
├── features/
│   ├── customer/           ✅ COMPLETE
│   ├── landing/            ✅ COMPLETE
│   ├── sit/                ⚠️  NEEDS: 10 files
│   ├── rrt/                ⚠️  NEEDS: 12 files
│   └── mpt/                ⚠️  NEEDS: 18 files
├── shared/                 ✅ COMPLETE
├── App.tsx                 ✅ COMPLETE
├── main.tsx                ✅ COMPLETE
└── index.css               ✅ COMPLETE
```

## Questions?

Refer to:
- `PLAN.md` - Original implementation plan
- `README.md` - Project overview and setup
- `docs/context/IMPLEMENTATION_LOG.md` - What's been done
- `docs/context/VAULT.md` - Project context
- `docs/context/RESEARCH_SUMMARY.md` - Technical patterns

## Contact

For implementation questions, refer to the PLAN.md and JSON schemas in `public/schemas/`.

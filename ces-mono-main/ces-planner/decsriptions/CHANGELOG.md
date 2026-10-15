**META TO CLAUDE CODE AI OPERATING OFF /PIPELINE FLOW: This is an old document. This tool has been created twice, with specifications and requirements iterating each time. Treat this file as a source of contextual & intent understanding, and lessons learned in creation of previous CMMC tools. NOTE: SOME SPECIFICATIONS WITHIN THIS FILE MAY CONFLICT OR CONTRADICT NEWER FILES -- basically any other artifact or information you find within these folders supersedes this information if conflicting or causes ambiguity, or drift**


# CES Frontend - Changelog

## Project Evolution Summary
This document tracks all major changes, bug fixes, and feature additions made to the CES (CMMC Engagement System) Frontend application.

---

## Phase 1: Data-Driven Enumeration & Answer Type Fixes

### Objective
Convert all appropriate questions to use enumerated/structured answer types instead of free-form text, making the system fully data-driven.


### Objective
Move CMMC target level selection to customer creation (instead of first SI question) and ensure clean state management.

### Database Changes (`src/lib/db.ts`)
- Added `targetLevel` field to `StoredCustomer` interface
- Customers now store: name, sitAnswers, targetLevel, createdAt, updatedAt

### UI Changes (`src/pages/MenuPage.tsx`)

#### Customer Creation Dialog
- Added target level dropdown (L1/L2/L3) with descriptions:
  - L1: "Level 1 - Foundational (FCI)"
  - L2: "Level 2 - Advanced (CUI)" (default)
  - L3: "Level 3 - Expert (Enhanced CUI)"
- Target level saved with customer record

#### SI Baseline Generation Flow
- Removed target level from G-01 question dependency
- `handleGenerateSIBaseline` now:
  1. Validates customer has targetLevel set
  2. Clears all SIT answers (`sitStore.resetDraft()`)
  3. Sets targetLevel in SIT store from customer record
  4. Navigates to SIT capture page

#### State Clearing Logic
- **On app load** (MenuPage useEffect):
  - Clears all session artifacts (customer, SI baseline, RR questions, readiness posture)
  - Resets SIT draft answers
  - Prevents persisted answers from previous sessions

- **On customer switch** (handleLoadCustomer):
  - Clears SI baseline, RR questions, readiness posture
  - Resets SIT draft answers
  - Loads customer-specific artifacts

### SIT Capture Page Changes (`src/pages/SITCapturePage.tsx`)
- Questions filtered by `targetLevel` from customer (not from G-01 answer)
- `applicableQuestions` memo filters based on `applies_to_levels` metadata
- Questions without level metadata included by default (backwards compatibility)

### Impact
- **Workflow**: Create customer with level → Generate SI Baseline → Answer filtered questions
- **Data integrity**: No preset/default values unless loading existing SI Baseline
- **User experience**: Clear separation between customer setup and SI capture

---

## Phase 4: Admin Management Functions

### Objective
Provide admin tools for bulk deletion of customers and SI baselines with cascade delete.

### Features Added (`src/pages/MenuPage.tsx`)

#### Admin Section
- New "Admin Functions" section with red border for visibility
- Two primary buttons:
  - **Delete Customers**: Shows count of existing customers
  - **Delete SI Baselines**: Shows count of existing baselines
- Buttons disabled when no data exists

#### Delete Customers Dialog
- **Multi-select interface**:
  - Checkboxes for each customer
  - Displays: customer name, target level, creation date
  - Shows selected count in delete button

- **Cascade delete**:
  - Deletes all RR Question Sets for selected customers
  - Deletes all Readiness Postures for selected customers
  - Deletes customer records

- **State management**:
  - Clears currently loaded artifacts if deleted customer is active
  - Refreshes artifact list after deletion

#### Delete SI Baselines Dialog
- **Multi-select interface**:
  - Checkboxes for each SI baseline
  - Displays: baseline ID, target level, creation date
  - Shows selected count in delete button

- **Cascade delete**:
  - Deletes all RR Question Sets tied to selected baselines
  - Deletes all Readiness Postures tied to selected baselines
  - Deletes SI baseline records

- **State management**:
  - Clears currently loaded artifacts if deleted baseline is active
  - Refreshes artifact list after deletion

### UI Components
- Used Headless UI Dialog component for modal dialogs
- Confirmation prompts before destructive operations
- Clear visual feedback for selected items

---

## Phase 6: Menu Page Workflow Enhancements

### Objective
Improve home page (MenuPage) to support independent SI Baseline selection and clearer RR question generation flow.

### Data Model Clarification
**Hierarchical Relationships**:
```
Customer (independent)
SI Baseline (independent, reusable across customers)
  ↓
Customer + SI Baseline selection
  └─ RR Question Set (tied to customerId + siBaselineId)
      └─ Readiness Posture (tied to customerId + siBaselineId + rrQuestionSetId)
          └─ MPT Output (tied to all parent artifacts)
```

### UI Changes (`src/pages/MenuPage.tsx`)

#### SI Baseline Section Redesign
- **Before**: Only visible when customer loaded, simple generate button
- **After**: Always visible, includes selection dropdown similar to Customer section

**New Features**:
- Dropdown to select from all available SI Baselines
- Shows: baseline ID, target level, creation date
- "Generate New SI Baseline" button when customer is selected
- Helpful messaging when no baselines exist
- Clear visual hierarchy matching Customer section

#### Generate SI Specific RR Questions Section
- **Visibility**: Shows when SI Baseline is loaded
- **Customer requirement**: Requires customer to be selected (shows warning if not)
- **Button behavior**: 
  - Generates RR questions tied to both `customerId` and `siBaselineId`
  - Shows loading state ("Generating...")
  - Disabled during generation

**Success Notification**:
- Green success banner appears after generation
- Shows checkmark and confirmation message
- Displays number of questions created
- Auto-dismisses after 5 seconds

**State Management**:
- Added `showRRGeneratedNotification` state
- Automatic timeout to clear notification
- No automatic navigation (user stays on menu page)

### Handler Updates

#### handleLoadSIBaseline
- Clears RR Question Set and Readiness Posture when loading new baseline
- Maintains customer context

#### handleGenerateRRQuestions
- Changed from navigating to RRT page to showing notification
- Saves RR Question Set with both `customerId` and `siBaselineId`
- Sets success notification state
- Better error handling with user-friendly messages

### Impact
- **Clarity**: Clear separation between reusable baselines and customer-specific artifacts
- **Flexibility**: Users can select any baseline for any customer
- **Workflow**: Users remain on menu page after generation, can see status
- **Data integrity**: Proper foreign key relationships enforced

---

## Technical Architecture

### State Management
- **Zustand Stores**:
  - `sitStore`: Manages SIT capture state with persist middleware
  - `appStore`: Manages currently loaded artifacts (customer, baseline, RR questions, posture)
  - `rrtStore`: Manages RRT activity execution

### Database (IndexedDB via Dexie)
- **Tables**:
  - `customers`: Customer records with target level
  - `siBaselines`: Reusable SI baseline templates
  - `rrQuestionSets`: Customer + baseline specific RR questions
  - `readinessPostures`: Customer + baseline + RR question set specific posture data

### Data Flow
1. **Customer Creation** → Select target level upfront
2. **SI Baseline** → Generate from SIT capture OR select existing
3. **RR Questions** → Generate from customer + baseline combination
4. **Readiness Posture** → Derive from RR question answers
5. **Mission Plan** → Generate from complete readiness posture

### Key Files Modified
- `src/pages/MenuPage.tsx`: Main hub with all workflow controls
- `src/pages/SITCapturePage.tsx`: SI capture wizard with level filtering
- `src/lib/db.ts`: Database schema and tables
- `src/stores/sitStore.ts`: SIT state management
- `src/components/sit/AnswerTypeMultiSelect.tsx`: Multi-select answer component
- `public/data/primed SI Question Bank.yaml`: Reduced question bank

---

#-

## Future Considerations

### Potential Enhancements
- Add RR Question Set selector (similar to SI Baseline selector)
- Add Readiness Posture selector (similar to SI Baseline selector)
- Export/import functionality for baselines and question sets
- Audit trail for artifact creation and modifications
- Versioning for SI baselines and question banks
- Undo/redo for bulk delete operations

### Known Limitations
- RR question generation creates new set each time (no update mechanism)
- No duplicate detection for SI baselines with identical answers
- Limited validation on foreign key relationships at UI level
- Success notifications not persistent (disappear on page refresh)

---

## Git History

All changes committed to **dev branch** and pushed to **GitHub origin/dev**.

**Key Commits**:
- Data-driven enumeration and multi_select fixes
- Navigation bug fix (AnswerTypeMultiSelect type guard)
- Customer workflow restructure with target level
- Admin bulk delete functionality
- SI Question Bank reduction to 14 questions
- Menu page workflow enhancements

---

*Last Updated: February 4, 2026*
*Project: CES Frontend (ces-fe)*
*Branch: dev*

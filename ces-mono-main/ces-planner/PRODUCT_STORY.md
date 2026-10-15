/fa# CES — The Design Story

## What this system is

CES (Compliance Execution System) is a desktop tool that helps VFS advisors guide their clients through CMMC certification. CMMC — Cybersecurity Maturity Model Certification — is a Department of Defense requirement. Any company that handles Controlled Unclassified Information (CUI) for the DoD must prove its cybersecurity controls meet a specific level (L1, L2, or L3). Failing an assessment means losing contracts.

The problem is that preparing for CMMC is brutally complex. There are 110 security controls at Level 2 alone. Each one has assessment objectives, evidence requirements, and implementation nuance that differs based on the company's tech stack, deployment posture, and risk tolerance. Most advisors work from spreadsheets, tribal knowledge, and fragmented vendor docs. It takes weeks of manual analysis to produce a compliance roadmap — and the result is usually a static document that can't adapt when assumptions change.

CES replaces that entire workflow. An advisor sits down with a client, walks through three sequential tools, and walks out with a validated, actionable compliance plan — complete with step-by-step implementation guidance, evidence requirements, cost estimates, and a tenant configuration manifest. The whole process takes hours, not weeks.

## Why it's built this way

### Offline-first, no backend

CES runs entirely in the browser. There is no server, no REST API, no cloud dependency. Everything is stored in IndexedDB via Dexie. This is a deliberate choice:

- **Security**: Advisors handle sensitive client data (organizational security posture, gap analysis, evidence of control failures). Keeping it local eliminates an entire class of data handling risk.
- **Portability**: Advisors work on-site at client facilities, sometimes with limited connectivity. The tool must work without internet.
- **Simplicity**: No infrastructure to manage, no auth to configure, no API versioning to maintain.

Domain knowledge — CMMC requirements, evidence archetypes, Microsoft technical guidance — ships as YAML and JSON files in `/public/data/`. These are loaded once, cached in IndexedDB, and used throughout the session. Updating domain knowledge means updating a YAML file, not deploying a service.

### Three tools, one chain

The system is built around three sequential tools that form an artifact dependency chain:

```
Customer → SI Baseline → RR Question Set → Readiness Posture → Mission Plan
```

Each tool produces a JSON artifact. Each artifact references its upstream parent by ID. Baselines are immutable — once created, they never change. This guarantees that downstream artifacts always reflect the original strategic intent. If the client's intent changes, you create a new baseline and regenerate everything downstream.

This chain isn't an implementation detail — it's the core design concept. Everything in the system flows from it.

## The three tools

### 1. SIT — Strategic Intent Tool

**What it captures**: Where does the client want to end up?

The SIT is a short wizard (10-15 questions) that captures destination-level compliance intent. These aren't technical questions — they're strategic ones:

- What CMMC level are you targeting?
- Is CUI present in your environment?
- What's your deployment posture — cloud-native, hybrid, on-prem?
- What's your boundary strategy — enclave or whole-network?
- What's your evidence collection target — high automation or manual?
- Are you willing to accept Plans of Action & Milestones (POA&Ms)?

Each question maps to a specific field in the SI Baseline schema (via `sets_its_fields`). Every question includes advisor guidance: why it matters, what the CMMC impact is, common pitfalls, and how the answer affects downstream RRT scoping and MPT phasing.

**What it produces**: An SI Baseline — a frozen snapshot of strategic intent. This baseline drives everything that follows. It determines which questions get asked in the RRT, which gaps get flagged, and how tasks get prioritized in the mission plan.

The baseline is validated against a JSON schema before saving. Once saved, it's immutable.

### 2. RRT — Readiness Recon Tool

**What it captures**: Where is the client right now?

The RRT assesses current compliance posture. It has four phases:

**Phase 1 — Preamble**: Five high-level questions about the client's current environment: license tier (E3/E5/GCC High), security archetype (greenfield vs. hardened), endpoint management, monitoring/SIEM setup, and policy documentation state. These sound simple, but they drive a powerful bulk derivation engine.

**Phase 2 — Bulk Review**: This is where the RRT gets interesting. Using the preamble answers, the system cross-references Implementation Patterns, the Vendor Playbook, and the Tech Ref to automatically derive the likely implementation status of 200+ vendor actions. For example: if the client has E5 + GCC High + "moderate hardening" archetype, the system knows that Conditional Access MFA policies are probably configured, but DLP policies likely need customization.

The advisor sees a sortable table of derived statuses. They can accept, override, or investigate each one. This bulk derivation typically handles 60-80% of the assessment automatically, turning a week of manual review into a 30-minute validation exercise.

**Phase 3 — Deep Dive**: For controls that need detailed investigation, the wizard presents one question at a time with evidence collection capabilities. Each question shows mapped CMMC requirements, expected evidence archetypes, assessor methods, and step-by-step collection instructions. The advisor can attach evidence items with provenance tracking.

**Phase 4 — Posture Review**: The system generates a Readiness Posture — a control-by-control status summary (met/partial/not_met/unknown) with key findings and evidence index.

**What it produces**: A Readiness Posture artifact. This is the gap analysis input — it tells the MPT exactly which controls are satisfied and which need work.

### 3. MPT — Mission Planning Tool

**What it produces**: Everything the advisor needs to deliver to the client.

The MPT runs a multi-stage pipeline:

**Gap compilation**: Compares the Readiness Posture against the SI Baseline's target level. Every control that's not_met, partial, or unknown becomes a gap. Each gap gets classified as `configure` (the vendor stack supports it — just turn it on), `customize` (scripting or customization needed), or `manual` (outside the stack — write a policy, train people).

**Task catalog**: For each gap, the system builds a detailed task by cross-referencing five data sources:
- **Implementation Patterns** — what actions address this practice
- **Vendor Playbook** — M365-specific implementation details (portal paths, PowerShell commands, evidence collection commands)
- **Tech Ref** — Microsoft's official GCC High CMMC L2 guidance per service
- **Assessor KB** — how assessors verify this control
- **Evidence Archetype Catalog** — what evidence to collect, in what form, with what retention

Each task includes: what to do, how to verify it, what evidence to produce, who owns it, effort estimates (5-category breakdown), priority, and dependencies.

**Artifact generation**: The task catalog feeds into six generators:

1. **Manual Mission Plan** — A traditional, gap-driven, task-oriented compliance roadmap grouped by CMMC domain. Each step includes implementation actions with vendor details, supplemental CMMC guidance, evidence collection instructions, verification steps, and completion criteria. Downloads as styled HTML.

2. **Tech Ref Implementation Guide** — A control-driven guide covering all 110 CMMC L2 controls (not just gaps). For each control: posture status badge, Microsoft implementation guidance by service with clickable doc links, GCC High customer responsibilities, assessment objectives, and evidence requirements with quality tier examples (strong/adequate/weak). Downloads as styled HTML.

3. **Proposal** — Cost estimate with phase breakdown, LOE hours by task type, assumptions, and payment schedule.

4. **Tenant Manifest** — Vendor-specific configuration requirements: required licenses, services, prerequisites, integration points.

5. **Exclusions Report** — Requirements excluded from scope based on SI Baseline scenario (e.g., mobile controls excluded when BYOD is not allowed), with justifications.

6. **Traceability Report** — CMMC requirement → task mapping matrix showing which tasks address which requirements and identifying any coverage gaps.

All artifacts are validated for cross-artifact alignment before saving.

## The data architecture

### Domain knowledge as data, not code

The system's intelligence lives in YAML files, not in application code. This is intentional — domain knowledge evolves independently of the application:

| File | Purpose |
|------|---------|
| `CMMC Fundamental Requirements Store` | Authoritative CMMC 2.0 requirements with assessment objectives, design rules, and common pitfalls |
| `SI Question Bank` | Strategic intent questions with advisor guidance and field mappings |
| `RR Question Bank` | 200+ control-granular activities with applicability rules and evidence expectations |
| `Implementation Patterns` | Maps CMMC practices to implementation action sequences |
| `Vendor Playbook (M365)` | Microsoft 365 actions: portal paths, PowerShell, evidence commands, and configure/customize/manual signals |
| `Tech Ref (GCC High G5)` | Official Microsoft technical reference: per-control guidance by service, assessment objectives, customer responsibilities |
| `Evidence Archetype Catalog` | 50+ canonical evidence types with collection methods, acceptable forms, and retention guidance |
| `Assessor Evidence Matrix` | Maps practices to evidence archetypes with strength tiers (strong/adequate/weak) and anti-patterns |
| `Assessor Knowledge Base` | Verification methods and assessment approaches per requirement |
| `Capability Taxonomy` | Hierarchical vendor capability classification |

When Microsoft updates their GCC High guidance, or CMMC 2.0 gets a revision, or the assessor community changes evidence expectations — you update a YAML file. The application logic stays the same.

### Schema validation

Every generated artifact is validated against a CES JSON schema using AJV before persistence. Schemas live in `/public/schemas/`. Validation is blocking for generated artifacts (the pipeline halts on failure) and non-blocking for domain data (warnings are logged but don't prevent loading).

This ensures that no matter what combination of inputs produces an artifact, the output conforms to a known contract. Downstream consumers (the HTML exporters, the file manager, future integrations) can rely on the schema.

### IndexedDB as the database

All persistent state lives in IndexedDB via Dexie:

- **Customers** — name, contact info, target level
- **SI Baselines** — immutable strategic intent snapshots, linked to customer
- **RR Question Sets** — scenario-filtered question sets, linked to baseline
- **Readiness Postures** — control-by-control status, linked to question set
- **Mission Plans** — composite artifact (plan + proposal + manifest), linked to posture
- **Domain data cache** — parsed YAML files with version tracking
- **Question bank cache** — parsed question banks

Compound indexes (`[customerId+baselineId]`) enable fast queries down the chain. The data loader service deduplicates concurrent requests to prevent double-fetching during initialization.

## The UI model

### Dashboard as command center

The landing page isn't a passive status display — it's an interactive command center. Five cards represent the five artifacts in the chain (Customer → Baseline → Question Set → Posture → Plan). Each card:

- Shows the currently selected artifact in a dropdown
- Provides actions: create new, view JSON, export, delete
- Visually indicates completion state (green background = complete)
- Shows the next required action (green-50 background = next step)

Selecting an artifact in any card automatically resets downstream selections. Deleting an artifact cascade-deletes everything downstream. The dependency chain is always consistent.

### Wizard pattern

Both SIT and RRT use a progressive wizard pattern: one question per page, with progress indicator, back/forward navigation, and advisor guidance panels. This is deliberate — the questions build on each other, and showing all questions at once would overwhelm both the advisor and the client.

The RRT adds a unique twist: the bulk review phase (Phase 2) presents a table-based interface for validating derived answers, while the deep dive (Phase 3) returns to one-question-at-a-time. This hybrid approach matches how advisors actually work — validate the automated results quickly, then dive deep where needed.

### File manager and artifact viewers

The Generated Artifacts Panel at the bottom of the dashboard serves as a file manager for all persisted artifacts. It groups artifacts by customer chain, supports batch operations, and provides three ways to interact with each artifact:

- **View** — Opens a floating, draggable JSON viewer panel (can open multiple simultaneously)
- **Save As** — Downloads raw JSON
- **Download** — Downloads formatted output (styled HTML for plans/reports, plain text for proposals)

The formatted HTML exports are self-contained — all CSS is inline, no external dependencies. An advisor can email the HTML file to a client and it renders correctly in any browser.

## Why each piece matters

The value of CES isn't any single feature — it's the pipeline. Each piece amplifies the others:

- **SIT captures intent** so the RRT knows what to ask and what to skip
- **RRT bulk derivation** turns weeks of manual assessment into an hour of validation
- **Posture quantification** (met/partial/not_met/unknown) makes gaps concrete and measurable
- **Gap classification** (configure/customize/manual) tells the advisor and client how hard each fix is
- **Vendor-specific guidance** (portal paths, PowerShell, evidence commands) makes tasks actionable, not abstract
- **Evidence quality tiers** (strong/adequate/weak) help advisors explain what "good enough" looks like
- **Schema validation** guarantees artifact consistency across the entire chain
- **Immutable baselines** prevent scope creep from corrupting downstream artifacts

The net result: an advisor can sit down with a client who has never thought about CMMC, and in a single session produce a validated, actionable compliance roadmap that would normally take a consulting team weeks to develop. The roadmap includes not just what to do, but exactly how to do it in the client's specific Microsoft environment, what evidence to collect, and how an assessor will verify it.

That's the design story. Every architectural decision — offline-first, YAML-driven domain knowledge, the three-tool pipeline, immutable baselines, bulk derivation, vendor-specific playbooks, schema validation — exists to make that outcome possible.

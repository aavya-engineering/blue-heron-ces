# CES-FE: CMMC Compliance Tool

A production-ready CMMC compliance tool built with React, TypeScript, and Vite that guides VFS advisors through Strategic Intent capture (SIT), Readiness Recon (RRT), and Mission Planning (MPT).

## Features

- **Customer Management**: Create and select customers for compliance workflows
- **Strategic Intent Tool (SIT)**: Capture compliance goals, scope, and constraints
- **Readiness Recon Tool (RRT)**: Evaluate current compliance posture with evidence collection
- **Mission Planning Tool (MPT)**: Generate actionable compliance roadmaps
- **Schema-Driven Workflows**: All artifacts validated against JSON schemas
- **IndexedDB Storage**: Persistent local storage with Dexie
- **Immutable Artifacts**: SI Baseline locked from edits after generation

## Tech Stack

- **Frontend**: React 18 + TypeScript
- **Build Tool**: Vite 6
- **State Management**: Zustand with persist middleware
- **Database**: IndexedDB via Dexie
- **Validation**: AJV (JSON Schema validation)
- **Data Format**: YAML question banks, JSON schema artifacts
- **UI Components**: Headless UI + Tailwind CSS
- **Routing**: React Router v6

## Project Structure

```
ces-fe/
├── data/                           # Source YAML files (read-only)
├── decsriptions/                   # Specifications and schemas (read-only)
│   └── CES_13_Schemas_canonical_v4/
├── public/
│   ├── data/                       # Runtime YAML files (copied from data/)
│   └── schemas/                    # Runtime JSON schemas
├── src/
│   ├── features/                   # Feature-based modules
│   │   ├── customer/               # Customer management
│   │   ├── landing/                # Landing page and workflow progress
│   │   ├── sit/                    # Strategic Intent Tool
│   │   ├── rrt/                    # Readiness Recon Tool
│   │   └── mpt/                    # Mission Planning Tool
│   ├── shared/                     # Shared infrastructure
│   │   ├── components/             # Reusable UI components
│   │   ├── db/                     # Dexie database schema
│   │   ├── hooks/                  # Shared React hooks
│   │   ├── services/               # Data loading and schema services
│   │   ├── stores/                 # Zustand stores
│   │   ├── types/                  # TypeScript types
│   │   ├── utils/                  # Utility functions
│   │   └── validation/             # AJV validators
│   ├── App.tsx                     # Root component
│   ├── main.tsx                    # Entry point
│   └── index.css                   # Global styles
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## Getting Started

### Prerequisites

- Node.js 18+ and npm

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Development

The app runs on `http://localhost:5173` by default in dev mode.

**Dev Mode Features:**
- Autofill buttons (visible only in dev)
- Database reset functionality
- Schema validation debug panel

### Building

```bash
npm run build
```

Output will be in the `dist/` directory.

## Database Schema

IndexedDB stores:
- **customers**: Customer records
- **si_baselines**: Strategic Intent Baselines (immutable)
- **rr_question_sets**: Scenario-specific RR Question Sets
- **readiness_postures**: Readiness Posture artifacts
- **mission_plans**: Mission Plan artifacts (Manual Plan, Exec Plan, Proposal, Manifest)
- **question_banks_cache**: Cached YAML question banks
- **domain_data_cache**: Cached domain data (CMMC requirements, evidence matrix, etc.)

## Workflow

1. **Customer Selection**: Create or select a customer
2. **SIT**: Answer strategic intent questions → Generate SI Baseline
3. **RRT**: Answer readiness questions with evidence → Generate Readiness Posture
4. **MPT**: Review gaps → Generate 4 artifacts (Manual Plan, Exec Plan, Proposal, Manifest)

## Architecture Decisions

- **Feature-based structure**: Organized by domain (sit, rrt, mpt) rather than layer
- **Zustand for state**: Lightweight, persistent state management
- **Dexie for storage**: IndexedDB with compound indexes for efficient queries
- **AJV for validation**: 10x faster than Zod for JSON Schema compliance
- **YAML for data**: Human-readable question banks, validated at runtime

## Schema Validation

All generated artifacts are validated against JSON schemas before saving. Validation errors are logged to the console with context.

## License

Proprietary - VFS Internal Tool

## Support

For questions or issues, contact the VFS development team.

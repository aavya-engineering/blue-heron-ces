# STACK-PLURAL-ROADMAP — what "Stamper supports other stacks" requires

**Written:** 2026-07-25 (GP-STAMPER-1 M3). **Status:** RATIFIED as drafted
(founder, 2026-07-25) with two decisions recorded:
- **Q3 answered — GovCloud default:** pilot registry entries and `AwsCliAdapter`
  assume `aws-us-gov` partition/endpoints unless the tenant record says otherwise
  (mirror of GCC-High on the MS side).
- **Q4 answered — stack/credential surface lives in ces-shared:** "things like
  that live in ces-shared" (founder). This matches existing architecture — the MS
  stack-provider/endpoint seam is already `ces-shared/stack`
  (`getActiveStackProvider`). §2b and Phase 2 updated accordingly; ces-tenant
  remains the *session/registry* owner, ces-shared the *stack schema* owner.
- Q1/Q2 (where AWS knowledge lives; pilot control list) remain open → Phase 0.
This doc scopes future goals; it builds nothing.
**Calibrated goal it serves:** "Microsoft is first-class, and Stamper supports other
stacks (founder, 2026-07-25) — the engine is stack-plural by design, not
Microsoft-only." Founder facts: **MS + AWS are the live stacks** in engagements.

## 1. What exists per stack today (repo ground truth, verified 2026-07-25)

### Microsoft — first-class, end to end
- **Execution:** `PowerShellAdapter` behind six session engines (`mgraph`, `az`,
  `exchange`, `ipps`, `teams`, `spo`), persistent sessions via ces-tenant's
  `PersistentSessionFactory`, GCC-High connect injection per command channel,
  injection guard at the interpolation chokepoint, get-then-set idempotency,
  evidence commands per registry entry.
- **Knowledge:** `cmmc-l2-commands.registry.json` — 150 entries (mgraph 89,
  exchange 24, manual_gate 20, ipps 11, az 5, teams 1);
  `infra-cmmc-l2-commands.registry.json` — 73 entries (az 68, mgraph 5).
- **Verification:** `OutputVerificationEngine` — jsonpath over command output with
  deliberate PS-shape tolerance (case-insensitive segments/equals mirroring `-eq`,
  single-element array unwrap). Genuine value mismatches still fail.
- **Simulation:** `tenant-stacksim` replays the MS surface (523-call inventory);
  ces-tester drives deterministic scenarios against it.

### AWS — live in engagements (founder fact), NOT represented in this repo
- **Zero** AWS-specific code, adapters, or registry entries (the only greps that
  match "aws" are `rawScore`/`rawScopeExclusions`). No `aws` engine in any
  registry. AWS work today therefore runs OUTSIDE registry-driven automation —
  where its operational knowledge currently lives (runbooks? another repo? manual
  practice?) is **founder input needed** (open question Q1 below).

### Stack-agnostic seams that already exist (the good news)
- `IEngineAdapter` is minimal and stack-neutral (`execute`/`validate`/`getName`).
- `TaskRunner` routes engines by name; generic `cli` (spawns any CLI with an args
  vector — structurally injection-safer than string-assembled shells) and `api`
  adapters are already registered, plus `manual_gate` for human steps.
- The registry entry schema (set/get/evidence commands, idempotency mode,
  verification descriptor, `manual_only`, layer/sequence hints) contains nothing
  Microsoft-specific except the command text and engine names.
- SPRS/control methodology (ces-shared `sprs-weights/2.0.0`) is control-based and
  stack-neutral by construction.

## 2. What "first-class AWS" requires (the three axes GP-STAMPER-1 names)

### 2a. Registry shape
- Add a **stack dimension** to registry metadata (per-file `stack: "aws"` or
  per-entry field — decide with Muster/EO since they consume registries as data
  and must be able to filter by stack).
- New `aws-cmmc-l2-commands.registry.json` using the SAME entry schema; engine
  value `awscli` (JSON output mode mandatory, `--output json`). Start from the
  control set the founder's live AWS engagements actually touch (Q2).
- Evidence commands: `aws` CLI reads (describe-*/get-*/list-*) — the
  evidence-centric property carries over unchanged.

### 2b. Adapter seam
- `AwsCliAdapter`: thin `IEngineAdapter` over the existing CLI-spawn pattern —
  args-vector spawn (no shell string assembly), per-task `--profile`/region
  injection, JSON stdout capture. No persistent-session machinery needed (aws CLI
  is stateless per call) — simpler than the PS path, not harder.
- **Stack/credential schema belongs to ces-shared** (founder decision 2026-07-25,
  matching the existing `ces-shared/stack` provider seam): the stack-kind field,
  AWS partition/endpoint table (GovCloud default per Q3), and credential-shape
  schema (profile name / role ARN; secrets stay out of git per existing policy)
  extend ces-shared's TenantConfig/stack surface. ces-tenant then consumes that
  schema for registry records and any session/credential resolution it owns.
  Filed from here as a ces-shared goal — not a reach-over.
- Injection guard: the PS guard stays PS-scoped at its chokepoint; the AWS path's
  safety property is the args-vector spawn + a value-level metacharacter guard
  reused from the same denylist logic (extract the pure guard into a shared
  helper — small, mechanical).

### 2c. Verification-engine generality
- `OutputVerificationEngine`'s jsonpath core is already stack-neutral; its PS
  tolerances (casing, array unwrap) are harmless for AWS JSON. Add per-engine
  normalization hooks only if a real AWS output shape demands one — do not
  pre-build generality (YAGNI, and the FIDELITY commits' lesson: tolerance
  boundaries must stay tight so "verified" keeps meaning verified).
- stacksim has no AWS story. Options, cheapest first: (a) record/replay fixture
  mode inside `AwsCliAdapter` tests; (b) a small `aws-stacksim` sibling following
  tenant-stacksim's pattern. (b) only when AWS control coverage justifies it.

## 3. Sequenced roadmap (each phase = one future goal, HIL-gated)

| Phase | Goal (candidate tag) | Scope | Exit gate |
|---|---|---|---|
| 0 | GP-STAMPER-AWS-0 | Founder Q&A (Q1-Q3) + pick 5-10 pilot controls from live AWS engagement reality; write the pilot registry entries on paper | Founder ratifies pilot control list |
| 1 | G-STAMPER-AWS-1 | Registry stack dimension + `awscli` engine + `AwsCliAdapter` (dry-run + JSON verification path) + shared value-guard extraction; suite-covered | tsc/jest green; dry-run of pilot plan end-to-end |
| 2 | G-SHARED-AWS-1 (filed against ces-shared; ces-tenant consumes) | Stack-kind + GovCloud partition/endpoint table + AWS credential schema on the ces-shared stack surface; ces-tenant registry records + Stamper consume it | AO/EO/tester unaffected (grep + suites); live `aws sts get-caller-identity` smoke |
| 3 | G-STAMPER-AWS-2 | Live pilot: execute + verify the pilot controls against a real AWS account; evidence artifacts land in plan-data tree | Every pilot control produces verified evidence; idempotent re-run converges |
| 4 | (breadth, post-pilot) | Coverage growth, Muster/EO stack-aware consumption, sim/replay fixtures, GUI surfacing | scoped later |

## 4. Founder questions (status as of 2026-07-25 ratification)

- **Q1 (OPEN → Phase 0):** Where does today's live AWS engagement knowledge live
  (runbooks, scripts, a repo I haven't seen)? That corpus seeds the pilot registry.
- **Q2 (OPEN → Phase 0):** Which controls do live AWS engagements actually
  implement today? (Drives the Phase-0 pilot list; guessing from 800-171 alone
  would be backwards.)
- **Q3 (ANSWERED):** GovCloud (`aws-us-gov`) is the default assumption, as
  GCC-High is on the MS side; per-tenant override allowed.
- **Q4 (ANSWERED):** Stack/credential schema surface belongs to **ces-shared**
  ("things like that live in ces-shared" — founder); Phase 2 refiled as
  G-SHARED-AWS-1 with ces-tenant as consumer.

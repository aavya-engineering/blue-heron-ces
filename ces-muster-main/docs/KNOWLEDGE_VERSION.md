# Knowledge Version — domain knowledge bank files

## Pinned SHA

```
4a00bee5d5e618cf55da2469ec12307ebc620418
```

## Source

- **Repo:** `C:/Users/mhsut/DevProjects/ces`
- **Source paths:** `ces-planner/public/data/` and `ces-planner/public/schemas/`
- **Destination:** `public/knowledge/`
- **Copy date:** 2026-07-05

## Knowledge Bank Files with SHA-256 Hashes

| File | SHA-256 |
|------|---------|
| `public/knowledge/domain CES CMMC Fundamental Requirements Store.yaml` | `04505fa548ab96bbca0bcd333e60c0631f184fb1a269af7adc7120fb1025385b` |
| `public/knowledge/domain Assessor Approach Knowledge Base.yaml` | `9448e888538acb6a6159efbe79d6ef846b060104f0f9776a680f5c7773efd54f` |
| `public/knowledge/domain Assessor Evidence Matrix.yaml` | `66fa2f1f2466c18ca50b9c18be08a0fe2e286e5255fdbd2d75781ea2ae2abda4` |
| `public/knowledge/domain Capability Taxonomy.yaml` | `e6cfc99550b79bf61d076a165bfefe333bcebd54233d72f7e8bb2eaeb922cad1` |
| `public/knowledge/domain Evidence Archetype Catalog.yaml` | `8198e925790f3de7cb6d4a2f27093bba8342a1e0072aa7785d17effb207ae984` |
| `public/knowledge/domain Implementation Patterns.yaml` | `b6a861f882186267886d4af47d2b20bd1f0c3b0c04bd14e698eab2738195c59c` |
| `public/knowledge/domain Tech Stack Compliance Mapping.yaml` | `03d5f6e2924dcd5cafe3b984a33f10c38b41fc5e597b2272b80ce4d2b1f882f3` |
| `public/knowledge/primed RR Question Bank.yaml` | `a7d97b22a02097719b2d2329b06f0a75d4d1c50e623c867803cbf92b0f842f39` |
| `public/knowledge/CES RRT Readiness Posture.schema.json` | `b7041d5de1fe76e80ae51d09a57b4338241ef4e4b5c7d4d21cef8b2f60d6706d` |

## Notes

Files are served as static assets from `public/knowledge/` (accessible at `/knowledge/*.yaml` at runtime). They are byte-identical copies from ces-planner — no modifications were made to knowledge bank content.

The drift check script (`scripts/check-vendor-drift.mjs`) covers all 9 knowledge bank files alongside the 10 code files for a total of 19 pinned assets.

## Addendum 2026-09-08 — the rest of Planner's stores (founder directive: "copy the helpful ones to muster")

Copied byte-for-byte from `ces-planner/public/` (planner untouched since 2026-06-13; the pinned
tree above is still current) and pinned in `vendor-manifest.json` (54 new entries; `npm run
check:drift` green, 111 files). Purpose: let Muster generate every Planner output
(see `ces-strategy/docs/MUSTER-PLANNER-OUTPUTS-PLAN-2026-09-08.md`).

| Destination | What | Why Muster needs it |
|---|---|---|
| `public/knowledge/primed SI Question Bank.yaml` | the SIT bank (`sets_its_fields` per question) | replaces `siBaselineAdapter`'s 5-field stub bank; full si_baseline.* field map |
| `public/knowledge/primed TCP / CUI Boundary / BTC / Policy Inputs Question Bank.yaml` | the four optional-input banks | the questions Muster must ask (or derive) to supply TCP, CUI boundary, BTC confirmation, policy inputs |
| `public/knowledge/help BTC / CUI Boundary / TCP Guidance.yaml`, `help Glossary.yaml` | help overlays | coach panel / help tab for the new inputs |
| `public/knowledge/fedramp-inheritance-table.yaml` | FedRAMP inheritance | `compileGapSet` arg 8 (inherited dispositions) — currently passed as absent |
| `public/knowledge/gcc-high-g5-cmmc-2-tech-ref-structured.json` | GCC High G5 tech ref (1.9 MB) | `buildTechRefIndex` → `compileTaskCatalog` arg 7 (currently `undefined`) and the Tech Ref Implementation Guide output |
| `public/knowledge/CES BTC Activation Package.yaml` | BTC activation package | BTC confirmation input |
| `public/schemas/planner/*` (20) | Planner's output contracts (Manual Mission Plan, Tenant/Infrastructure Manifest, Proposal, TCP, SI Baseline, CUI Boundary, Readiness Posture, domain schemas) | validate what Muster generates against Planner's own contracts (PLAN-2 gate 4) |
| `public/templates/policies/*` (21) | Handlebars policy templates + `registry.yaml` | PLAN-2 slice 5 (policy docs) |

Not copied: `playbook-generation-prompt.md` (authoring prompt, not runtime), `CES BTC Activation
Package.json` (duplicate of the yaml), `CES MPT Executable Mission Plan Schema.json.obsolete`.
Nothing under `public/knowledge/` is imported by code yet beyond the six banks `compilerBanks.ts`
loads — wiring is the plan's work, not this copy's.

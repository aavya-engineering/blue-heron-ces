# Storage Environment Variable Overrides

All CES pipeline packages resolve storage paths from a single root. The variables below control every tier of the path hierarchy. Higher-precedence overrides win; lower-precedence defaults apply when the higher-precedence variable is absent.

---

## Variable Reference

| Variable | Scope | Default Value | Precedence | Notes |
|----------|-------|---------------|-----------|-------|
| `CES_PIPELINE_ROOT` | All packages | `C:\CES_Pipeline` (Windows) / `<cwd>/ces-pipeline` (POSIX) | Highest — overrides everything below | Set this to move the entire pipeline to a custom location. |
| `STORAGE_ROOT` | Stamper, EvidenceOps, AdminOps | `{CES_PIPELINE_ROOT}/{Module}/storage` | Package-level override | Overrides the `storage/` sub-tree for the specific package that reads it. Does not affect other packages. |
| `STATE_DIR` | Stamper | `{STORAGE_ROOT}/state` | Sub-path override | Path where Stamper writes `execution-state.json` and `change-log.jsonl`. |
| `EVIDENCE_DIR` | Stamper | `{STORAGE_ROOT}/evidence` | Sub-path override | Path where Stamper writes structured evidence artifacts. |
| `LOG_DIR` | Stamper | `{STORAGE_ROOT}/logs` | Sub-path override | Path where Stamper writes execution reports. |
| `STAMPER_EVIDENCE_DIR` | Stamper (dev mode) | `{CES_PIPELINE_ROOT}/Stamper/plan-data/dev/evidence` | Dev override only | Overrides evidence dir in dev/dry-run mode only. Not used in production execution. |

---

## Precedence Rules

1. Explicit env var (e.g. `STATE_DIR`) wins over all computed defaults.
2. `STORAGE_ROOT` overrides the module's computed `{CES_PIPELINE_ROOT}/{Module}/storage` path.
3. `CES_PIPELINE_ROOT` overrides the OS-default root; all module roots are derived from it.
4. OS default: `C:\CES_Pipeline` on Windows, `<cwd>/ces-pipeline` on POSIX.

---

## Resolved Path Examples (default `CES_PIPELINE_ROOT`)

```
C:\CES_Pipeline\
  Planner\
    customers\                  ← getPlannerCustomersRoot()
      <customer-name>\
        inputs\
        outputs\
  Stamper\
    plan-data\                  ← getStamperPlanDataRoot()
      <tenant-slug>\
        plans\
        evidence\
        logs\
        state\
    storage\                    ← getModuleStorageRoot('Stamper')
      state\
      evidence\
      logs\
  EvidenceOps\
    storage\                    ← getModuleStorageRoot('EvidenceOps')
  AdminOps\
    storage\                    ← getModuleStorageRoot('AdminOps')
    evidence-store\
      <domain>\
        <use-case-id>\
          <year>\
            <month>\
```

---

## See Also

- `shared/src/storage/node.ts` — canonical path resolver implementations
- `shared/src/storage/contract.ts` — FE-safe constants (no node:* imports)
- `strategy/ces-dataflow-objects.md` — unified artifact layout overview

# Punchlist Sync — flat finding table (2026-07-04, commit a0d6ae1)

One row per headline finding, formatted for import into `cesPunchlist.xlsx`. Stable IDs = the
`GAP-<module>-<SPEC-NN.R#>-<seq>` from the per-module gap files. This is the curated top set (the P0s,
P1s, and the high-leverage P2s); the complete ~123-finding list lives in the per-module `gaps-*.md`.
Effort: S = <½ day, M = ~1–3 days, L = >3 days / decomposable.

| Finding ID | Module | Dim | Severity | Effort | Goal | Statement |
|---|---|---|:--:|:--:|:--:|---|
| GAP-stamper-04.R8-1 | stamper | 04 | P0 | S | G-ENG-1 | Unescaped PowerShell interpolation → live-tenant command injection (shared adapter) |
| GAP-ao-04.R8-01 | ao | 04 | P0 | S | G-ENG-1 | Same injection via the shared ces-stamper PowerShellAdapter (imported by AO) |
| GAP-eo-04.R11-01 | eo | 04 | P0 | S | G-ENG-2 | multer 1.x HIGH DoS vuln shipped in EO prod deps |
| GAP-eo-04.R11-02 | eo | 04 | P1 | S | G-ENG-2 | js-yaml + uuid moderate prod vulns; no CI audit gate |
| GAP-eo-04.R14-01 | eo | 04 | P1 | S | G-ENG-2 | os.tmpdir() uploads never cleaned (the multer-CVE surface) |
| GAP-stamper-04.R3-1 | stamper | 04 | P1 | S | G-ENG-2 | Plaintext `--cert-password` CLI flag (profile anti-target) |
| GAP-ao-04.R1-01 | ao | 04 | P1 | M | G-ENG-4 | No authentication on the AO HTTP server |
| GAP-eo-04.R1-01 | eo | 04 | P1 | M | G-ENG-4 | EO auth off-by-default exposes all 104 /api/* routes |
| GAP-stamper-04.R1-1 | stamper | 04 | P1 | M | G-ENG-4 | No route authN on the 12 Stamper GUI routers |
| GAP-planner-03.R2-01 | planner | 03 | P1 | M | G-ENG-4 | Permissive AJV (strict/validateSchema:false) passes invalid artifacts |
| GAP-planner-11.R6-01 | planner | 11 | P1 | M | G-ENG-4 | Legacy no-tuple Dexie reads can leak another customer's artifacts |
| GAP-shared-03.R7-01 | shared | 03 | P1 | M | G-ENG-6 | stamper↔EO schema contract DRAFT/unratified, consumer-only validation |
| GAP-shared-11.R4-01 | shared | 11 | P1 | M | G-ENG-6 | CesRepository has no WORM/append-only guard on evidence records |
| GAP-eo-01.R12-01 | eo | 01 | P1 | M | G-ENG-6 | No CMMC obligation→requirement→test traceability (mandatory L3) |
| GAP-eo-09.R4-01 | eo | 09 | P1 | M | G-ENG-6 | No durable audit trail for privileged EO operations |
| GAP-shared-07.R3-01 | shared | 07 | P2 | M | G-ENG-3 | CI has no lint gate |
| GAP-shared-07.R4-02 | shared | 07 | P2 | M | G-ENG-3 | CI has no typecheck gate |
| GAP-shared-07.R6-03 | shared | 07 | P2 | M | G-ENG-3 | CI has no coverage gate |
| GAP-shared-07.R7-04 | shared | 07 | P2 | S | G-ENG-3 | CI has no `npm audit` gate (recurrence guard for the vulns) |
| GAP-shared-05.R7-01 | shared | 05 | P2 | M | G-ENG-3 | No coverage tooling installed in any workspace; no threshold |
| GAP-eo-02.R10-01 | eo | 02 | P2 | L | G-ENG-6 | 4,100-line / 104-route EoServer.ts monolith |
| GAP-shared-06.R1-01 | shared | 06 | P2 | S | G-ENG-5 | Versions frozen at 0.1.0 fleet-wide; no SemVer discipline |
| GAP-shared-06.R3-01 | shared | 06 | P2 | S | G-ENG-5 | No changelogs (except EO) |
| GAP-shared-10.R1-01 | shared | 10 | P2 | S | G-ENG-5 | ces-shared has no README |
| GAP-eo-10.R1-01 | eo | 10 | P2 | S | G-ENG-5 | ces-eo has no root README |
| GAP-ao-10.R1-01 | ao | 10 | P2 | S | G-ENG-5 | ces-ao has no README |
| GAP-eo-09.R1-01 | eo | 09 | P2 | M | G-ENG-6 | 280 console.* calls; winston declared but unused (dead dep) |
| GAP-stamper-09.R1-01 | stamper | 09 | P2 | M | G-ENG-6 | console.* sprawl + winston dead-dep + silent catch{} |
| GAP-ao-09.R3-01 | ao | 09 | P2 | M | G-ENG-6 | No request IDs / structured logger (~4 console calls) |
| GAP-shared-02.R4-01 | shared | 02 | P2 | S | G-ENG-3 | No machine dependency-cycle check in CI |
| GAP-eo-03.R1-01 | eo | 03 | P2 | M | G-ENG-6 | No API versioning / OpenAPI on 104 routes |

**Not re-raised (DUP → existing tracks):** evidence signing → G8(a)/G11; blob-WORM → G8(b)/G10; EO
auth also tracked under G8(c)/G12 (but the gate work is new); hash-order → G8(d) fixed; RSA-PSS/WORM
deferrals → G8 risk-acceptances (pending Azure); multi-stack + DB-hardening → cesPunchlist existing rows.

**Import note:** the punchlist XLSX (`cesPunchlist.xlsx`) is a Planner-exported task board of ~product
roadmap items (multi-stack, SSP generation, evidence collection, dead-code scan, refactor) — few map
1:1 to these engineering findings, so these import as *new* rows rather than updates. Extraction:
`docs/specs/gaps/punchlist-import.csv` (dependency-free unzip of the sheet's shared strings).

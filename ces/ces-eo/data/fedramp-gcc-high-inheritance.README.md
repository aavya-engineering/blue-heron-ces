# fedramp-gcc-high-inheritance.json (schema 2.0)

Per-control FedRAMP inheritance data for a Microsoft 365 GCC High + Azure Government tenant, read by
`src/eo/ssp/SharedResponsibilityMatrixGenerator.ts` (CRM, SSP section 2.3) and rendered by
`src/eo/ssp/FedRampInheritanceGenerator.ts` (SSP section 2.4). Re-authored 2026-10-27 (plan item W3.4,
founder decision B10 "fix this problem").

## Top level

| Field | Meaning |
|---|---|
| `schema_version` | `"2.0"`. |
| `authorization_package`, `authorization_reference` | The Microsoft authorizations relied on. `ato_date` is `null`: no authorization date was verified from a fetched source, so none is printed. |
| `source`, `url`, `last_verified` | The Microsoft Product Placemat for CMMC 2.0 (Preview Sept 2024 workbook) and the day its values were read. |
| `coverage_definition` | Microsoft's own definition of "Microsoft Coverage" / "Shared Coverage" / "Customer Responsibility". |
| `inheritance_rule` | How the EO `inheritance` value is derived from the Placemat value (see below). |
| `condition_semantics` | Meaning of the two Muster gates (`physical_facility_count_zero`, `customer_equipment_count_zero`). |
| `sources[]` | Every source consulted (`key`, `name`, `url`, `accessed`). The `key` is what the section 2.4 footnote column cites. |
| `excluded_ids[]` | Ids carried by the previous file that are not NIST SP 800-171 Rev 2 requirements (SP 800-53 text): SC.L2-3.13.17, SI.L2-3.14.9 to SI.L2-3.14.14. The loader treats them as Customer with the reason. |
| `muster_table_notes[]` | Where this file and Muster's `public/knowledge/fedramp-inheritance-table.yaml` disagree (AU.L2-3.3.7, IA.L2-3.5.10) or agree; printed as a note under section 2.4. |
| `inherited_controls[]` | One row per control, all 110 (the array keeps its historical name). |
| `control_families` | Counts per family for the scenario in `control_families_scenario` (azure-gov, no AdminOps credit, both counts 0). The generator recomputes counts at run time; this block is informational. |

## Row fields

| Field | Meaning |
|---|---|
| `controlId`, `nistRef`, `requirement` | The ces-shared reference id (`cmmc-l2-controls.reference.json`), its numeric SP 800-171 reference and the requirement text copied verbatim from the reference. The loader matches rows by `nistRef` (B4-neutral: the L1/L2 tag is ignored). |
| `inheritance` | `full` (Inherited when conditions are met and AdminOps does not also implement), `partial` (Shared), `none` (Customer). |
| `architectures` | Architectures the Microsoft portion applies to; `azure-gov` and `byod` on every row (the GCC High service side is the same under both). `hybrid` is never listed, so an undetected architecture yields Customer for all rows. |
| `conditions` | Muster gates. Only PE.L1-3.10.1/3/4/5 and PE.L2-3.10.2 (`physical_facility_count_zero`) and MA.L2-3.7.1/2/3/6 (`customer_equipment_count_zero`) carry one. Count 0 → Inherited; count > 0 → Shared; count null/absent → Shared, "pending facts". |
| `microsoftResponsibility` | What Microsoft does for this control (service side), written against the control text. |
| `customerResponsibility` | What the organization must still do; where the Microsoft Technical Reference Guide publishes a customer responsibility statement for the control, the text follows it (`customerResponsibilitySource`). |
| `placematCoverage`, `placematSheet`, `placematPrimaries`, `nist80053` | Microsoft's published GCC High value, verbatim, with the workbook sheet it came from (`Control Information` tab, or the `List` tab for the 19 practices the Control Information tab shows as `#N/A`), the primary services Microsoft lists, and the SP 800-53 mapping it gives. |
| `basis` | `Microsoft Product Placemat (GCC High Responsibility)` when `inheritance` equals the Placemat value, else `BHD assessment` (always accompanied by `note`). |
| `source`, `sourceUrl` | The Placemat name and download page. |
| `verified` | `true`: the Placemat value was read from the downloaded workbook on `last_verified`. |
| `note` | Reason for a BHD assessment, founder decisions, and Muster disagreements. |

## Derivation rule

- Placemat `Customer Responsibility` → `none` (CM.L2-3.4.8 only).
- Placemat `Microsoft Coverage` → `full` only where the requirement is satisfied wholly inside Microsoft's
  authorization boundary for the organization's in-scope assets: datacenter physical protection (PE, gated on
  facility count), maintenance of system components when the organization owns no equipment (MA.L2-3.7.1/2/3/6,
  gated), and IA.L2-3.5.11 (authentication feedback is obscured by the service and OS defaults).
- Everything else → `partial`. The 42 rows where the Placemat says `Microsoft Coverage` but the control text
  names an organizational duty on the organization's tenant configuration, deployed Azure resources, endpoints,
  media, personnel or documents (for example CA.L2-3.12.4, the organization's own SSP) are `partial` with
  `basis: "BHD assessment"` and a note. The Placemat value is never raised (no row claims more than Microsoft does).
- AU.L2-3.3.7 is Shared by founder decision B10 (2026-10-27): the build deploys customer resources whose clocks
  Microsoft does not manage.

## Regeneration

The file is generated from an authored table (one Microsoft sentence, one customer sentence and an optional
note per control) joined to the reference ids and the Placemat workbook. The generator script lives outside the
repository (session scratchpad, W3.4 log); edit the JSON directly for single-row corrections and keep
`requirement` verbatim from the reference, which the tests assert.

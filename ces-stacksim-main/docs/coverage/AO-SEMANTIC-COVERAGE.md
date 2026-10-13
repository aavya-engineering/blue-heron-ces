# AO semantic coverage (M6) - 95 AO commands on the gcc-high-g5 seed

Generated 2026-09-28T18:01:43.915Z by `npm run coverage:ao` (src/coverage/AoSemanticRunner.ts).
A fresh `m365_azure` tenant (gcc-high-g5 seed set, no harness-injected objects) runs every AO command's real
get/set text through the shimmed PowerShell modules, in AO's registry order: GET, SET, paired GET.

**PASS 95 - HONEST-OPEN 0 - FAIL 0** (of 95)

read = the output carries the seeded data / deliberate gap the command exists to find. write = the paired read
differs after the write. HONEST-OPEN = the sim serves the command but the command's own read cannot observe it;
reason + REQ (docs/requirements/) given. Expectations: `coverage/ao-semantic-expectations.json`.

| Op | Expectation | Status | Detail |
|---|---|---|---|
| A-01 | write observed by paired read | PASS | paired read observes the write |
| A-02 | write observed by paired read | PASS | paired read observes the write |
| A-03 | write observed by paired read | PASS | paired read observes the write |
| A-04 | write observed by paired read | PASS | paired read observes the write |
| A-05 | write observed by paired read | PASS | paired read observes the write |
| A-06 | write observed by paired read | PASS | paired read observes the write |
| A-07 | write observed by paired read | PASS | paired read observes the write |
| A-08 | read contains `True` | PASS | read carries "True" |
| A-09 | read contains `62e90394-69f5-4237-9190-012177145e10` | PASS | read carries "62e90394-69f5-4237-9190-012177145e10" |
| A-10 | write observed by paired read | PASS | paired read observes the write |
| A-18 | write observed by paired read | PASS | paired read observes the write |
| A-19 | write observed by paired read | PASS | paired read observes the write |
| A-20 | write observed by paired read | PASS | paired read observes the write |
| B-13 | write observed by paired read | PASS | paired read observes the write |
| B-14 | write observed by paired read | PASS | paired read observes the write |
| A-11 | read contains `Sim Inactive User` | PASS | read carries "Sim Inactive User" |
| A-12 | read contains `Partner Guest` | PASS | read carries "Partner Guest" |
| A-13 | read contains `Require Compliant Device` | PASS | read carries "Require Compliant Device" |
| A-14 | write observed by paired read | PASS | paired read observes the write |
| A-15 | read contains `sim.user2@` | PASS | read carries "sim.user2@" |
| A-16 | write observed by paired read | PASS | paired read observes the write |
| A-17 | write observed by paired read | PASS | paired read observes the write |
| B-01 | write observed by paired read | PASS | paired read observes the write |
| B-02 | read contains `noncompliant` | PASS | read carries "noncompliant" |
| B-03 | read contains `10.0.19044` | PASS | read carries "10.0.19044" |
| B-04 | read contains `nonCompliant` | PASS | read carries "nonCompliant" |
| B-05 | write observed by paired read | PASS | paired read observes the write |
| B-06 | write observed by paired read | PASS | paired read observes the write |
| B-07 | write observed by paired read | PASS | paired read observes the write |
| B-08 | write observed by paired read | PASS | paired read observes the write |
| B-09 | write observed by paired read | PASS | paired read observes the write |
| B-10 | read contains `SIM-LAPTOP-008` | PASS | read carries "SIM-LAPTOP-008" |
| B-11 | read contains `KIOSK-SHOP-01` | PASS | read carries "KIOSK-SHOP-01" |
| B-12 | read contains `Sim Standard Autopilot` | PASS | read carries "Sim Standard Autopilot" |
| C-01 | read contains `Sim Legacy HR Connector` | PASS | read carries "Sim Legacy HR Connector" |
| C-02 | write observed by paired read | PASS | paired read observes the write |
| C-03 | write observed by paired read | PASS | paired read observes the write |
| C-04 | read contains `Microsoft.KeyVault` | PASS | read carries "Microsoft.KeyVault" |
| C-05 | read contains `sim-cert-1` | PASS | read carries "sim-cert-1" |
| C-06 | write observed by paired read | PASS | paired read observes the write |
| C-07 | read contains `ManagedIdentity` | PASS | read carries "ManagedIdentity" |
| C-08 | read contains `Sim Legacy HR Connector` | PASS | read carries "Sim Legacy HR Connector" |
| C-09 | write observed by paired read | PASS | paired read observes the write |
| C-10 | write observed by paired read | PASS | paired read observes the write |
| D-01 | read contains `FileSensitivityLabelRemoved` | PASS | read carries "FileSensitivityLabelRemoved" |
| D-02 | read contains `CMMC-CUI-Block` | PASS | read carries "CMMC-CUI-Block" |
| D-03 | write observed by paired read | PASS | paired read observes the write |
| D-04 | read contains `AnonymousLinkCreated` | PASS | read carries "AnonymousLinkCreated" |
| D-05 | read contains `CUI Repository` | PASS | read carries "CUI Repository" |
| D-06 | write observed by paired read | PASS | paired read observes the write |
| D-07 | read contains `Sim CUI Retention 7y` | PASS | read carries "Sim CUI Retention 7y" |
| D-08 | read contains `Shop Floor Team` | PASS | read carries "Shop Floor Team" |
| D-09 | write observed by paired read | PASS | paired read observes the write |
| D-10 | read contains `AnonymousLinkCreated` | PASS | read carries "AnonymousLinkCreated" |
| D-11 | write observed by paired read | PASS | paired read observes the write |
| E-01 | write observed by paired read | PASS | paired read observes the write |
| E-02 | read contains `RecordType` | PASS | read carries "RecordType" |
| E-03 | read contains `send-to-sim-law-1` | PASS | read carries "send-to-sim-law-1" |
| E-04 | read contains `AlertTriggered` | PASS | read carries "AlertTriggered" |
| E-05 | read contains `AlertTriggered` | PASS | read carries "AlertTriggered" |
| E-06 | read contains `Count` | PASS | read carries "Count" |
| E-07 | read contains `Add member to role.` | PASS | read carries "Add member to role." |
| E-08 | read contains `sim.user3` | PASS | read carries "sim.user3" |
| E-09 | read contains `MailItemsAccessed` | PASS | read carries "MailItemsAccessed" |
| E-10 | read contains `Close-ComplianceCase` | PASS | read carries "Close-ComplianceCase" |
| F-01 | read contains `62` | PASS | read carries "62" |
| F-02 | read contains `self-service password reset` | PASS | read carries "self-service password reset" |
| F-03 | read contains `windows10EndpointProtectionConfiguration` | PASS | read carries "windows10EndpointProtectionConfiguration" |
| F-04 | read contains `Block Legacy Authentication` | PASS | read carries "Block Legacy Authentication" |
| F-05 | read contains `62` | PASS | read carries "62" |
| F-06 | read contains `sim-nsg-1` | PASS | read carries "sim-nsg-1" |
| F-07 | write observed by paired read | PASS | paired read observes the write |
| F-08 | write observed by paired read | PASS | paired read observes the write |
| F-09 | read contains `multifactor` | PASS | read carries "multifactor" |
| F-10 | read contains `Sim Service Principal 2` | PASS | read carries "Sim Service Principal 2" |
| F-11 | write observed by paired read | PASS | paired read observes the write |
| F-12 | write observed by paired read | PASS | paired read observes the write |
| F-13 | write observed by paired read | PASS | paired read observes the write |
| F-14 | write observed by paired read | PASS | paired read observes the write |
| G-01 | read contains `Sim Contractor` | PASS | read carries "Sim Contractor" |
| G-02 | write observed by paired read | PASS | paired read observes the write |
| G-03 | read contains `Sim Contractor` | PASS | read carries "Sim Contractor" |
| G-04 | read contains `LinkClicked` | PASS | read carries "LinkClicked" |
| G-05 | read contains `E007` | PASS | read carries "E007" |
| G-06 | read contains `sim.user3` | PASS | read carries "sim.user3" |
| G-07 | read contains `DataExfiltrationRuleMatch` | PASS | read carries "DataExfiltrationRuleMatch" |
| G-08 | read contains `Partner Guest One` | PASS | read carries "Partner Guest One" |
| H-01 | write observed by paired read | PASS | paired read observes the write |
| H-02 | write observed by paired read | PASS | paired read observes the write |
| H-03 | write observed by paired read | PASS | paired read observes the write |
| H-04 | write observed by paired read | PASS | paired read observes the write |
| H-05 | read contains `New-ComplianceCase` | PASS | read carries "New-ComplianceCase" |
| H-06 | write observed by paired read | PASS | paired read observes the write |
| H-07 | read contains `Failed` | PASS | read carries "Failed" |
| H-08 | read contains `Sim continuity plan test overdue` | PASS | read carries "Sim continuity plan test overdue" |

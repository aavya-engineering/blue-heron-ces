# FD-5 Option B (PLAN-E2E-AO-DEMO.md, rev 2.1) — ces-tester-owned stub rollup manifest.
#
# WHY THIS EXISTS: ces-shared's PrerequisiteChecker marks `Microsoft.Graph`
# (the ROLLUP meta-module) as `required: true`
# (ces-shared/src/prereq/PrerequisiteChecker.ts:30-37) and probes it with
# `Get-Module -ListAvailable Microsoft.Graph`. tenant-stacksim/psmodules/ ships
# the sub-modules (Microsoft.Graph.Authentication, .Users, .Applications, ...)
# but NO bare `Microsoft.Graph` rollup, so under stacksim's shadowed
# PSModulePath Stamper's GUI Connect bails with `prereq_blocked` and never
# reaches `phase:'done'` — which leaves `tenantConnectionState` un-set and the
# Execute button permanently refused (public/index.html:7703-7708).
#
# This manifest is a PRESENCE SHIM ONLY: it exports nothing and implements
# nothing. Every real Graph cmdlet still resolves from tenant-stacksim's own
# shims, which stay authoritative. The shim directory is APPENDED to
# PSModulePath (never a wholesale replacement — `enableStacksimMode` replaces,
# which would clobber the sim's shims), so the sim wins every name collision.
#
# See docs/requirements/REQ-STACKSIM-NO-MICROSOFT-GRAPH-ROLLUP-SHIM.md.

@{
    RootModule           = ''
    ModuleVersion        = '2.0.0'
    GUID                 = '2f5d6e1a-4c93-4a2e-9b6d-0f1a7c8e5b30'
    Author               = 'ces-tester'
    CompanyName          = 'CES'
    Description          = 'Presence-only stub of the Microsoft.Graph rollup module for tenant-stacksim runs. Exports nothing; real cmdlets come from tenant-stacksim/psmodules.'
    PowerShellVersion    = '5.1'
    FunctionsToExport    = @()
    CmdletsToExport      = @()
    VariablesToExport    = @()
    AliasesToExport      = @()
    PrivateData          = @{ PSData = @{ Tags = @('ces-tester', 'stacksim', 'shim') } }
}

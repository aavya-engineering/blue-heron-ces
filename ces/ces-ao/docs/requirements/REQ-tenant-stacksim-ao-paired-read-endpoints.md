# REQ-tenant-stacksim-ao-paired-read-endpoints — serve the paired reads AO adopted for tenant-stacksim's REQ-ces-ao-paired-reads

- **From:** ces-ao (FC-AO-2, 2026-09-28)
- **To:** tenant-stacksim (Graph shims + resolvers)
- **Answers:** `tenant-stacksim/docs/requirements/REQ-ces-ao-paired-reads.md` ("If AO adopts the beta URI, file a REQ back and the sim will serve it")
- **Status:** CLOSED (2026-09-28, FC-AO-3) — B-08 now PASSes on the rerun matrix (`stateChanged=true`); tenant-stacksim
  closed this independently while FC-AO-3 was in flight (matrix run `mmulk40yp` on ces-mono `00eb329`, PASS 95 ·
  HONEST-OPEN 0 · FAILING 0). A-07's optional per-user-MFA follow-up (row below) was not part of this REQ's
  acceptance and remains open only if tenant-stacksim wants to track it separately.
- **Evidence:** AO 95-op matrix, 2026-09-28 (`test/integration/ao95.matrix.stacksim.test.ts`, `docs/AO-95-OP-MATRIX.md`).

## What

AO changed the paired reads (registry `get_command`) of A-07, B-05, B-08, C-09 and D-03 so each read looks at the
field its set changes, using the real Microsoft Graph / Security & Compliance surface. B-05, C-09 and D-03 now PASS on
the sim; A-07 PASSes on its Authenticator-configuration read. Two reads are real-Graph-correct but not served by the sim:

| Op | Read AO needs (real service) | What the sim does today | Ask |
|---|---|---|---|
| B-08 | `Get-MgDeviceAppManagementAndroidManagedAppProtectionApp -AndroidManagedAppProtectionId '<policy id>' -All` (Graph `GET /deviceAppManagement/androidManagedAppProtections/{id}/apps`) — lists the apps the set added | No such shim function (`The term 'Get-MgDeviceAppManagementAndroidManagedAppProtectionApp' is not recognized`); the URI form returns 404. The set's `New-MgDeviceAppManagementAndroidManagedAppProtectionApp` already stores into `androidManagedAppProtectionApps`. | Export the Get cmdlet (and/or the `/apps` URI) reading `androidManagedAppProtectionApps` filtered by the policy id, returning `id` + `mobileAppIdentifier`. |
| A-07 (optional follow-up) | Per-user MFA requirement: `GET /beta/users/{id}/authentication/requirements` (`perUserMfaState`) | 404 on the beta URI (the sim stores `perUserMfaState` on the user and serves it only through `Get-MgUser -Property perUserMfaState`, which real Graph v1.0 does not have) | Serve the beta URI from the user's `perUserMfaState`. AO's A-07 read today uses the Microsoft Authenticator configuration state (the other half of the set), which the sim serves; AO will add the requirement read once this lands. |

## Acceptance

AO matrix: B-08 PASS (paired read shows the added app: `stateChanged=true`). For A-07, a probe of the beta URI returns
`{"perUserMfaState":"enforced"}` after the set.

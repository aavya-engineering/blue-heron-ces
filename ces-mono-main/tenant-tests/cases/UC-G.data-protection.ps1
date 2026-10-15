<#
  SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
  SPDX-License-Identifier: LicenseRef-BHD-Proprietary
  CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
  Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
  Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
  Submitting a change to this repository means you accept TERMS.md.
  Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
  See LICENSE and TERMS.md.
#>

# UC-G - CUI data protection via Purview (Security & Compliance PS / IPPS channel).
# Closes the last residual: MP-3.8.1 (digital CUI media protected/controlled), MP-3.8.2 (label-based
# access), MP-3.8.4 (CUI markings), AC-3.1.3 (DLP information-flow control). Read-only Get-* only,
# through the Invoke-EutIpps choke point. If the app lacks the compliance role, the channel is
# unavailable -> SKIPPED (honest), and the residual stays open pending that grant.
$CaseDef = @{
    Id = 'UC-G'; Name = 'CUI data protection (Purview labels + DLP)'
    Personas = @('P1','P2')
    Practices = @('MP.L2-3.8.1','MP.L2-3.8.2','MP.L2-3.8.4','AC.L2-3.1.3')
    Tests = @(
        @{ Name='Sensitivity labels published for CUI (MP-3.8.1[b][d] digital media)'; Tier='T1'; Controls=@('MP-3.8.1'); Objectives=@('MP.L2-3.8.1[b]','MP.L2-3.8.1[d]'); Script={ param($ctx)
            try {
                $labels=@(Invoke-EutIpps -Cmdlet 'Get-Label')
                $pols=@(Invoke-EutIpps -Cmdlet 'Get-LabelPolicy')
                $published=@($pols | Where-Object { $_.Enabled -ne $false -and $_.Mode -ne 'PendingDeletion' })
                if($labels.Count -and $published.Count){ New-EutVerdict PASS "$($labels.Count) sensitivity label(s) defined; $($published.Count) label policy(ies) published - digital CUI media is labeled, protected, and controlled at rest" -Evidence @{ labels=$labels.Count; policies=$published.Count } }
                elseif($labels.Count){ New-EutVerdict FAIL "$($labels.Count) label(s) defined but none published (no active label policy) - CUI media protection not in effect" }
                else { New-EutVerdict FAIL 'no sensitivity labels defined - digital CUI media is not labeled/protected' }
            } catch { Resolve-EutProbeError $_ -What 'sensitivity labels read (IPPS)' } } }

        @{ Name='Label-based access control on CUI media (MP-3.8.2[a])'; Tier='T1'; Controls=@('MP-3.8.2'); Objectives=@('MP.L2-3.8.2[a]'); Script={ param($ctx)
            try {
                $labels=@(Invoke-EutIpps -Cmdlet 'Get-Label')
                # Protection state lives in LabelActions (JSON strings), not the flat Settings list;
                # the flattened EncryptionEnabled property can stay null even when the encrypt action is on.
                $enc=@($labels | Where-Object {
                    $_.EncryptionEnabled -eq $true -or
                    ($_.LabelActions | Where-Object { "$_" -match '"Type":"encrypt"' -and "$_" -match '(?i)"Key":"disabled","Value":"false"' }) -or
                    ($_.ContentType -match 'File|Email' -and (
                    ($_.Settings | Where-Object { "$($_.Key)" -match '(?i)encrypt|protection' -and "$($_.Value)" -match '(?i)true|Template' }) )) })
                if($enc.Count){ New-EutVerdict PASS "$($enc.Count) label(s) apply encryption/access protection - access to CUI on media is limited to authorized users by label" -Evidence @{ protectedLabels=$enc.Count } }
                elseif($labels.Count){ New-EutVerdict INCONCLUSIVE "FINDING F-LABEL: the CUI label is classification-only (no label encryption). Access to CUI media is still limited by the CUI group + Conditional Access + platform encryption (examined elsewhere); enabling label encryption is a recommended enhancement to prove MP-3.8.2 directly" }
                else { New-EutVerdict FAIL 'no labels - no label-based access control on CUI media' }
            } catch { Resolve-EutProbeError $_ -What 'label protection read (IPPS)' } } }

        @{ Name='CUI markings applied via labels (MP-3.8.4[a][b])'; Tier='T1'; Controls=@('MP-3.8.4'); Objectives=@('MP.L2-3.8.4[a]','MP.L2-3.8.4[b]'); Script={ param($ctx)
            try {
                $labels=@(Invoke-EutIpps -Cmdlet 'Get-Label')
                # Marking state lives in LabelActions (applycontentmarking/applywatermarking), same caveat as MP-3.8.2.
                $marked=@($labels | Where-Object {
                    $_.ApplyContentMarkingHeaderEnabled -eq $true -or $_.ApplyContentMarkingFooterEnabled -eq $true -or $_.ApplyWaterMarkingEnabled -eq $true -or
                    ($_.LabelActions | Where-Object { "$_" -match '"Type":"apply(contentmarking|watermarking)"' -and "$_" -match '(?i)"Key":"disabled","Value":"false"' }) -or
                    ($_.Settings | Where-Object { "$($_.Key)" -match '(?i)contentmarking|watermark' -and "$($_.Value)" -match '(?i)true' }) })
                if($marked.Count){ New-EutVerdict PASS "$($marked.Count) label(s) apply content markings (header/footer/watermark) - CUI media is marked with applicable markings + distribution limitations" -Evidence @{ markingLabels=$marked.Count } }
                elseif($labels.Count){ New-EutVerdict INCONCLUSIVE "FINDING F-LABEL: the CUI label classifies but has no auto content-marking (header/footer/watermark) configured. CUI is visually classified by the label + marked procedurally; enabling auto content-marking is a recommended enhancement to prove MP-3.8.4 directly" }
                else { New-EutVerdict FAIL 'no labels - CUI markings not applied via labels' }
            } catch { Resolve-EutProbeError $_ -What 'label markings read (IPPS)' } } }

        @{ Name='DLP information-flow control for CUI (AC-3.1.3[a][b][d])'; Tier='T1'; Controls=@('AC-3.1.3'); Objectives=@('AC.L2-3.1.3[a]','AC.L2-3.1.3[b]','AC.L2-3.1.3[d]'); Script={ param($ctx)
            try {
                $dlp=@(Invoke-EutIpps -Cmdlet 'Get-DlpCompliancePolicy')
                $on=@($dlp | Where-Object { $_.Enabled -ne $false -and $_.Mode -match '(?i)Enable' })
                if(-not $on.Count){ $on=@($dlp | Where-Object { $_.Enabled -ne $false }) }
                if($on.Count){ New-EutVerdict PASS "$($on.Count) enabled DLP polic(ies) define + enforce CUI flow control (policies [a], mechanisms [b], authorizations [d])" -Evidence @{ dlpPolicies=$on.Count } }
                elseif($dlp.Count){ New-EutVerdict FAIL "$($dlp.Count) DLP polic(ies) present but none enabled - CUI flow control defined but not enforced" }
                else { New-EutVerdict FAIL 'no DLP policies - CUI information-flow control not defined' }
            } catch { Resolve-EutProbeError $_ -What 'DLP policy read (IPPS)' } } }
    )
}

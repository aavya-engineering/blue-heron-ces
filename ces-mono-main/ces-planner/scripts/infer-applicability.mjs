// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Inference Script: Draft `applicability` blocks for RR Question Bank activities.
 *
 * Reads the RR Question Bank YAML and applies heuristic rules based on:
 *   - CMMC requirement domain prefix (PE, MP, MA, AC, SC, etc.)
 *   - NIST practice ID (specific controls with known deployment/scope implications)
 *   - Activity name keywords
 *   - Evidence archetype IDs
 *
 * Outputs a YAML report with proposed applicability blocks per activity,
 * including confidence level and reasoning for SME review.
 *
 * Usage: node scripts/infer-applicability.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import YAML from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BANK_PATH = resolve(ROOT, 'public/data/primed RR Question Bank.yaml');
const OUTPUT_PATH = resolve(ROOT, 'scripts/applicability-draft.yaml');

// ---------------------------------------------------------------------------
// Heuristic rule definitions
// ---------------------------------------------------------------------------

/**
 * Each rule returns an applicability fragment (or null) for a given activity.
 * Rules are composable — multiple rules can contribute to the same activity.
 */
const rules = [
  // -----------------------------------------------------------------------
  // RULE 1 — Physical & Environmental (PE domain)
  // PE practices are about physical access control, visitor escorts, physical
  // access logs, etc. Irrelevant for pure cloud environments.
  // -----------------------------------------------------------------------
  {
    id: 'PE_DOMAIN',
    description: 'PE domain activities require physical infrastructure — exclude for cloud-only',
    confidence: 'high',
    test(activity) {
      const domain = extractDomain(activity);
      if (domain !== 'PE') return null;
      return {
        excludes: [{ deployment_posture: ['cloud_only'] }],
        reason: `PE domain (Physical & Environmental Protection) requires on-prem or hybrid infrastructure`,
      };
    },
  },

  // -----------------------------------------------------------------------
  // RULE 2 — Media Protection physical media activities (MP domain)
  // MP.L1-3.8.3 (media disposal), MP.L2-3.8.1 (media protection),
  // MP.L2-3.8.2 (media access), MP.L2-3.8.3 (media sanitization),
  // MP.L2-3.8.4/5/7 (media marking, transport, removable media)
  // Physical media controls are irrelevant for cloud-only orgs.
  // MP.L2-3.8.6 (CUI on portable storage) and MP.L2-3.8.9 (backups)
  // may still apply to cloud.
  // -----------------------------------------------------------------------
  {
    id: 'MP_PHYSICAL_MEDIA',
    description: 'Physical media protection activities — exclude for cloud-only',
    confidence: 'medium',
    test(activity) {
      const domain = extractDomain(activity);
      if (domain !== 'MP') return null;
      const practiceId = extractPracticeId(activity);
      // These specific practices deal with physical media handling
      const physicalMediaPractices = [
        '3.8.1', '3.8.2', '3.8.3', '3.8.4', '3.8.5', '3.8.7',
      ];
      if (physicalMediaPractices.some((p) => practiceId?.includes(p))) {
        return {
          excludes: [{ deployment_posture: ['cloud_only'] }],
          reason: `MP practice ${practiceId} covers physical media handling — not applicable to cloud-only deployments`,
        };
      }
      return null;
    },
  },

  // -----------------------------------------------------------------------
  // RULE 3 — Maintenance (MA domain) — on-site maintenance activities
  // MA.L2-3.7.1 (system maintenance), MA.L2-3.7.2 (control maintenance tools),
  // MA.L2-3.7.3 (equipment sanitization), MA.L2-3.7.6 (maintenance personnel)
  // These assume physical access to systems.
  // MA.L2-3.7.5 (nonlocal maintenance) applies to all postures.
  // -----------------------------------------------------------------------
  {
    id: 'MA_ONSITE',
    description: 'On-site maintenance activities — exclude for cloud-only',
    confidence: 'medium',
    test(activity) {
      const domain = extractDomain(activity);
      if (domain !== 'MA') return null;
      const practiceId = extractPracticeId(activity);
      const onsitePractices = ['3.7.1', '3.7.2', '3.7.3', '3.7.6'];
      if (onsitePractices.some((p) => practiceId?.includes(p))) {
        return {
          excludes: [{ deployment_posture: ['cloud_only'] }],
          reason: `MA practice ${practiceId} covers on-site maintenance — not applicable to cloud-only`,
        };
      }
      return null;
    },
  },

  // -----------------------------------------------------------------------
  // RULE 4 — CUI-specific L2 practices
  // Many L2 practices explicitly reference CUI in their name/title.
  // If the org has no CUI (no_cui), these are not applicable.
  // Note: FCI-only orgs may still need L1 practices but not CUI-specific L2.
  // -----------------------------------------------------------------------
  {
    id: 'CUI_IN_NAME',
    description: 'Activities with CUI in name — exclude when no CUI present',
    confidence: 'high',
    test(activity) {
      const name = (activity.name || '').toLowerCase();
      if (!name.includes('cui')) return null;
      return {
        excludes: [{ cui_presence: ['no_cui'] }],
        reason: `Activity name references CUI — not applicable when no CUI is present`,
      };
    },
  },

  // -----------------------------------------------------------------------
  // RULE 5 — Mobile device controls
  // AC.L2-3.1.18 (control connection of mobile devices)
  // AC.L2-3.1.19 (encrypt CUI on mobile devices)
  // These are relevant only when BYOD is allowed.
  // -----------------------------------------------------------------------
  {
    id: 'MOBILE_DEVICE',
    description: 'Mobile device activities — exclude when BYOD not allowed',
    confidence: 'high',
    test(activity) {
      const practiceId = extractPracticeId(activity);
      const name = (activity.name || '').toLowerCase();
      const mobilePractices = ['3.1.18', '3.1.19'];
      const isMobile =
        mobilePractices.some((p) => practiceId?.includes(p)) ||
        name.includes('mobile device');
      if (!isMobile) return null;
      return {
        excludes: [{ byod_posture: ['not_allowed'] }],
        reason: `Mobile device control — not applicable when BYOD is not allowed`,
      };
    },
  },

  // -----------------------------------------------------------------------
  // RULE 6 — Wireless access controls
  // AC.L2-3.1.16 (wireless access authorization)
  // AC.L2-3.1.17 (wireless access protection)
  // SC.L2-3.13.16 if referencing wireless
  // Relevant only for on-prem/hybrid with wireless networks.
  // -----------------------------------------------------------------------
  {
    id: 'WIRELESS',
    description: 'Wireless access activities — exclude for cloud-only',
    confidence: 'medium',
    test(activity) {
      const practiceId = extractPracticeId(activity);
      const name = (activity.name || '').toLowerCase();
      const wirelessPractices = ['3.1.16', '3.1.17'];
      const isWireless =
        wirelessPractices.some((p) => practiceId?.includes(p)) || name.includes('wireless');
      if (!isWireless) return null;
      return {
        excludes: [{ deployment_posture: ['cloud_only'] }],
        reason: `Wireless access control — not applicable to cloud-only deployments`,
      };
    },
  },

  // -----------------------------------------------------------------------
  // RULE 7 — L2 practices generally assume CUI presence
  // L2 exists to protect CUI. If an org is L1-only (FCI only, no CUI),
  // then L2-specific practices should not appear. However, this is already
  // handled by applies_to_levels. This rule catches L1 activities that
  // mention CUI — they should be excluded for no_cui orgs.
  // -----------------------------------------------------------------------
  {
    id: 'L2_CUI_ASSUMPTION',
    description: 'L2-only activities assume CUI — exclude for no_cui + fci_only',
    confidence: 'medium',
    test(activity) {
      const levels = activity.applies_to_levels || [];
      if (levels.includes('L1')) return null; // L1-inclusive activities apply broadly
      if (!levels.includes('L2')) return null;
      // Only L2+ activities
      return {
        excludes: [{ cui_presence: ['no_cui', 'fci_only'] }],
        reason: `L2-only practice — CUI protection intent; not needed for FCI-only or no-CUI orgs`,
      };
    },
  },

  // -----------------------------------------------------------------------
  // RULE 8 — Remote access practices
  // AC.L2-3.1.12 (monitor/control remote access sessions)
  // AC.L2-3.1.14 (route remote access via managed access control points)
  // AC.L2-3.1.15 (authorize remote execution of privileged commands)
  // Boost priority for hybrid/cloud deployments where remote access is primary.
  // -----------------------------------------------------------------------
  {
    id: 'REMOTE_ACCESS',
    description: 'Remote access practices — boost for cloud/hybrid deployments',
    confidence: 'medium',
    test(activity) {
      const practiceId = extractPracticeId(activity);
      const name = (activity.name || '').toLowerCase();
      const remotePractices = ['3.1.12', '3.1.14', '3.1.15'];
      const isRemote =
        remotePractices.some((p) => practiceId?.includes(p)) || name.includes('remote access');
      if (!isRemote) return null;
      return {
        boost_when: [{ deployment_posture: ['cloud_only', 'hybrid'] }],
        reason: `Remote access control — higher priority for cloud/hybrid where remote access is primary`,
      };
    },
  },

  // -----------------------------------------------------------------------
  // RULE 9 — Audit/accountability practices
  // AU domain activities are more critical when evidence_posture_target
  // demands higher rigor (c3pao_ready, continuous_compliance).
  // -----------------------------------------------------------------------
  {
    id: 'AUDIT_BOOST',
    description: 'Audit practices — boost for C3PAO-ready and continuous compliance',
    confidence: 'medium',
    test(activity) {
      const domain = extractDomain(activity);
      if (domain !== 'AU') return null;
      return {
        boost_when: [{ evidence_posture_target: ['c3pao_ready', 'continuous_compliance'] }],
        reason: `Audit/logging practice — higher priority when evidence rigor target is C3PAO-ready or continuous`,
      };
    },
  },

  // -----------------------------------------------------------------------
  // RULE 10 — Assessment practices (CA domain)
  // CA.L2-3.12.1 through 3.12.4 are about security assessments.
  // Boost when assessment_route is certification (external assessment).
  // -----------------------------------------------------------------------
  {
    id: 'CA_CERTIFICATION',
    description: 'Assessment practices — boost for certification route',
    confidence: 'medium',
    test(activity) {
      const domain = extractDomain(activity);
      if (domain !== 'CA') return null;
      return {
        boost_when: [{ assessment_route: ['certification'] }],
        reason: `Security assessment practice — higher priority when targeting external certification`,
      };
    },
  },

  // -----------------------------------------------------------------------
  // RULE 11 — Cryptography practices
  // SC.L2-3.13.10 (key management), SC.L2-3.13.11 (FIPS crypto)
  // Boost when tenant_model_preference requires higher assurance
  // (gcc_high, dod_il5, dod_il6).
  // -----------------------------------------------------------------------
  {
    id: 'CRYPTO_TENANT',
    description: 'Cryptography practices — boost for GCC-High/IL5+ tenants',
    confidence: 'medium',
    test(activity) {
      const practiceId = extractPracticeId(activity);
      const cryptoPractices = ['3.13.10', '3.13.11'];
      if (!cryptoPractices.some((p) => practiceId?.includes(p))) return null;
      return {
        boost_when: [{ tenant_model_preference: ['gcc_high', 'dod_il5', 'dod_il6'] }],
        reason: `Cryptographic practice — higher priority for GCC-High/IL5+ where FIPS requirements are strict`,
      };
    },
  },

  // -----------------------------------------------------------------------
  // RULE 12 — Personnel security (PS domain)
  // PS.L2-3.9.1 (screen personnel), PS.L2-3.9.2 (protect CUI during actions)
  // Exclude for no_cui.
  // -----------------------------------------------------------------------
  {
    id: 'PS_CUI',
    description: 'Personnel security — exclude when no CUI',
    confidence: 'medium',
    test(activity) {
      const domain = extractDomain(activity);
      if (domain !== 'PS') return null;
      const levels = activity.applies_to_levels || [];
      if (levels.includes('L1')) return null;
      return {
        excludes: [{ cui_presence: ['no_cui'] }],
        reason: `Personnel security practice for CUI environments — not applicable when no CUI`,
      };
    },
  },

  // -----------------------------------------------------------------------
  // RULE 13 — Incident response boost for certification
  // IR domain activities become more critical when certification is the target
  // and when assessment timing is tight.
  // -----------------------------------------------------------------------
  {
    id: 'IR_CERTIFICATION',
    description: 'Incident response — boost for certification route',
    confidence: 'low',
    test(activity) {
      const domain = extractDomain(activity);
      if (domain !== 'IR') return null;
      return {
        boost_when: [{ assessment_route: ['certification'] }],
        reason: `IR practices gain scrutiny in C3PAO assessments — boost priority`,
      };
    },
  },

  // -----------------------------------------------------------------------
  // RULE 14 — Multi-enclave activities
  // Universal BOUNDARY and DATAFLOW activities get boosted for multi-enclave
  // and hybrid boundary scenarios — more complex scoping needed.
  // -----------------------------------------------------------------------
  {
    id: 'MULTI_ENCLAVE_BOOST',
    description: 'Scoping activities — boost for complex boundary strategies',
    confidence: 'medium',
    test(activity) {
      const id = activity.id || '';
      if (!id.includes('UNIV-BOUNDARY') && !id.includes('UNIV-DATAFLOW')) return null;
      return {
        boost_when: [{ boundary_strategy: ['multiple_enclaves', 'hybrid_boundary'] }],
        reason: `Scoping activity — more critical for multi-enclave and hybrid boundary scenarios`,
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractDomain(activity) {
  const reqs = activity.mapped_requirements || [];
  if (reqs.length > 0 && reqs[0] !== 'FOUNDATION') {
    const match = reqs[0].match(/^([A-Z]{2})\./);
    if (match) return match[1];
  }
  // Fallback: parse from activity ID
  const idMatch = (activity.id || '').match(/RR-ACT-([A-Z]{2})_/);
  return idMatch ? idMatch[1] : null;
}

function extractPracticeId(activity) {
  const reqs = activity.mapped_requirements || [];
  if (reqs.length > 0 && reqs[0] !== 'FOUNDATION') {
    // Extract numeric portion: AC.L2-3.1.3 → 3.1.3
    const match = reqs[0].match(/\d+\.\d+\.\d+/);
    return match ? match[0] : null;
  }
  return null;
}

function extractAllActivities(bank) {
  const activities = [];
  const activityBank = bank?.ces?.activity_bank;
  if (!activityBank) return activities;

  // Universal
  if (activityBank.universal?.activities) {
    activities.push(...activityBank.universal.activities);
  }
  // Level-specific
  if (activityBank.level_specific) {
    for (const level of ['L1', 'L2', 'L3']) {
      if (activityBank.level_specific[level]?.activities) {
        activities.push(...activityBank.level_specific[level].activities);
      }
    }
  }
  return activities;
}

function mergeApplicability(existing, fragment) {
  const merged = { ...existing };
  if (fragment.excludes) {
    merged.excludes = [...(merged.excludes || []), ...fragment.excludes];
  }
  if (fragment.requires_any) {
    merged.requires_any = [...(merged.requires_any || []), ...fragment.requires_any];
  }
  if (fragment.boost_when) {
    merged.boost_when = [...(merged.boost_when || []), ...fragment.boost_when];
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('Reading RR Question Bank...');
const raw = readFileSync(BANK_PATH, 'utf-8');
const bank = YAML.load(raw);
const activities = extractAllActivities(bank);
console.log(`Found ${activities.length} activities.\n`);

const results = [];
let matchCount = 0;
let noMatchCount = 0;

const ruleHitCounts = {};
rules.forEach((r) => (ruleHitCounts[r.id] = 0));

for (const activity of activities) {
  let applicability = {};
  const matchedRules = [];

  for (const rule of rules) {
    const fragment = rule.test(activity);
    if (fragment) {
      applicability = mergeApplicability(applicability, fragment);
      matchedRules.push({
        rule_id: rule.id,
        confidence: rule.confidence,
        reason: fragment.reason,
      });
      ruleHitCounts[rule.id]++;
    }
  }

  const hasApplicability = matchedRules.length > 0;
  if (hasApplicability) matchCount++;
  else noMatchCount++;

  results.push({
    id: activity.id,
    name: activity.name,
    applies_to_levels: activity.applies_to_levels,
    domain: extractDomain(activity),
    practice_id: extractPracticeId(activity),
    current_mapped_requirements: activity.mapped_requirements,
    proposed_applicability: hasApplicability ? applicability : null,
    matched_rules: hasApplicability ? matchedRules : [],
    needs_sme_review: hasApplicability,
  });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const summary = {
  total_activities: activities.length,
  activities_with_proposed_rules: matchCount,
  activities_unchanged: noMatchCount,
  coverage_percent: ((matchCount / activities.length) * 100).toFixed(1) + '%',
  rule_hit_counts: ruleHitCounts,
  si_baseline_fields_used: [
    'deployment_posture',
    'cui_presence',
    'byod_posture',
    'boundary_strategy',
    'evidence_posture_target',
    'assessment_route',
    'tenant_model_preference',
  ],
  filter_type_breakdown: {
    excludes: results.filter((r) => r.proposed_applicability?.excludes?.length > 0).length,
    boost_when: results.filter((r) => r.proposed_applicability?.boost_when?.length > 0).length,
    requires_any: results.filter((r) => r.proposed_applicability?.requires_any?.length > 0).length,
  },
};

const output = { summary, activities: results };

console.log('=== SUMMARY ===');
console.log(`Total activities:     ${summary.total_activities}`);
console.log(`With proposed rules:  ${summary.activities_with_proposed_rules} (${summary.coverage_percent})`);
console.log(`Unchanged:            ${summary.activities_unchanged}`);
console.log();
console.log('Rule hit counts:');
for (const [id, count] of Object.entries(ruleHitCounts)) {
  if (count > 0) console.log(`  ${id}: ${count}`);
}
console.log();
console.log('Filter type breakdown:');
console.log(`  excludes:     ${summary.filter_type_breakdown.excludes} activities`);
console.log(`  boost_when:   ${summary.filter_type_breakdown.boost_when} activities`);
console.log(`  requires_any: ${summary.filter_type_breakdown.requires_any} activities`);
console.log();

// Write full output
const yamlOutput = YAML.dump(output, { lineWidth: 120, noRefs: true });
writeFileSync(OUTPUT_PATH, yamlOutput, 'utf-8');
console.log(`Full report written to: ${OUTPUT_PATH}`);

// Also print activities that HAVE proposed rules (the interesting ones)
console.log('\n=== ACTIVITIES WITH PROPOSED APPLICABILITY ===\n');
for (const r of results.filter((r) => r.proposed_applicability)) {
  console.log(`${r.id}  (${r.name})`);
  if (r.proposed_applicability.excludes) {
    for (const exc of r.proposed_applicability.excludes) {
      const [field, values] = Object.entries(exc)[0];
      console.log(`  EXCLUDE when ${field} = [${values.join(', ')}]`);
    }
  }
  if (r.proposed_applicability.boost_when) {
    for (const boost of r.proposed_applicability.boost_when) {
      const [field, values] = Object.entries(boost)[0];
      console.log(`  BOOST  when ${field} = [${values.join(', ')}]`);
    }
  }
  for (const mr of r.matched_rules) {
    console.log(`  ← ${mr.rule_id} (${mr.confidence}): ${mr.reason}`);
  }
  console.log();
}

// ============================================================
// Assembly rule engine
// Carriers often miss connected items, not just lines.
// These rules fire on a *combined* view of both sides and emit
// AssemblyFinding[] when expected related components are absent.
// ============================================================

import type {
  AssemblyFinding,
  NormalizedScopeItem,
  CompareSeverity,
  ScopeSource,
} from './scope-types.ts';

export type AssemblyRule = {
  id: string;
  name: string;
  trade_group: string;
  /** If any of these canonical keys / regex hits any item on either side, the rule fires. */
  trigger_keys: string[];
  /** Canonical keys (or regex strings) that should be present somewhere on each side. */
  expected_related_keys: string[];
  optional_related_keys?: string[];
  missing_severity: CompareSeverity;
  explanation_template: string;
};

function matches(item: NormalizedScopeItem, needle: string): boolean {
  if (!needle) return false;
  if (item.canonical_key === needle) return true;
  const desc = `${item.canonical_key} ${item.cleaned_description} ${item.raw_description}`.toLowerCase();
  if (needle.startsWith('regex:')) {
    try {
      return new RegExp(needle.slice(6), 'i').test(desc);
    } catch {
      return false;
    }
  }
  return desc.includes(needle.toLowerCase());
}

function anyMatch(items: NormalizedScopeItem[], needle: string): boolean {
  return items.some((i) => matches(i, needle));
}

function presentNeedles(items: NormalizedScopeItem[], needles: string[]): string[] {
  return needles.filter((n) => anyMatch(items, n));
}

function missingNeedles(items: NormalizedScopeItem[], needles: string[]): string[] {
  return needles.filter((n) => !anyMatch(items, n));
}

// ------------------------------------------------------------
// Rules
// ------------------------------------------------------------

const ROOF_REPLACEMENT_BASE_ASSEMBLY: AssemblyRule = {
  id: 'ROOF_REPLACEMENT_BASE_ASSEMBLY',
  name: 'Roof replacement — base assembly',
  trade_group: 'roof',
  trigger_keys: [
    'laminated_comp_shingle_without_felt',
    'regex:laminated.*comp.*shingle',
    'regex:roof\\s*replacement',
    'tearoff_comp_shingles_laminated',
    'regex:tear\\s*off.*shingles?',
  ],
  expected_related_keys: [
    'regex:tear\\s*off|remove\\s+shingles',
    'regex:laminated.*comp.*shingle',
    'regex:roofing\\s*felt|underlayment',
    'drip_edge',
    'asphalt_starter',
    'hip_ridge_cap_composition',
    'regex:pipe\\s*jack|roof\\s*flashing',
    'regex:valley\\s*metal',
  ],
  optional_related_keys: [
    'dumpster_20yd',
    'regex:sheathing\\s*renail|re[-\\s]?nail.*sheathing',
    'regex:caulk',
    'gooseneck_vent',
    'water_barrier_joint_taping',
    'regex:permit',
    'regex:supervision',
    'regex:tarp',
    'regex:high\\s*roof\\s*charge',
  ],
  missing_severity: 'warning',
  explanation_template:
    'Roof replacement scopes should be reviewed as a full assembly. Missing related components may cause the estimate to understate the actual work required to complete the roof system.',
};

const FLORIDA_ROOF_CODE_UPGRADE_ASSEMBLY: AssemblyRule = {
  id: 'FLORIDA_ROOF_CODE_UPGRADE_ASSEMBLY',
  name: 'Florida roof — code upgrade assembly',
  trade_group: 'roof',
  trigger_keys: [
    'regex:laminated.*comp.*shingle',
    'regex:tear\\s*off',
  ],
  expected_related_keys: [
    'regex:re[-\\s]?nail.*sheathing|re[-\\s]?nailing.*sheathing',
    'regex:secondary\\s*water\\s*barrier|water\\s*barrier\\s*joint\\s*taping|seam\\s*tape',
    'drip_edge',
    'asphalt_starter',
    'regex:underlayment|roofing\\s*felt',
  ],
  missing_severity: 'warning',
  explanation_template:
    'Florida roof work commonly requires system-level code and installation components. Missing items should be reviewed for code compliance, manufacturer requirements, or project-specific documentation.',
};

const EXTERIOR_ELEVATION_REPAIR_ASSEMBLY: AssemblyRule = {
  id: 'EXTERIOR_ELEVATION_REPAIR_ASSEMBLY',
  name: 'Exterior elevation repair assembly',
  trade_group: 'exterior',
  trigger_keys: [
    'regex:seal\\s*(&|and)?\\s*paint\\s*stucco',
    'paint_stucco',
    'clean_pressure_chemical_spray',
    'stucco_patch_small_repair',
  ],
  expected_related_keys: [
    'clean_pressure_chemical_spray',
    'regex:seal\\s*(&|and)?\\s*paint|paint_stucco',
    'regex:uniformity\\s*paint|paint_stucco',
  ],
  optional_related_keys: ['stucco_patch_small_repair'],
  missing_severity: 'warning',
  explanation_template:
    'Exterior elevation repairs should be reviewed by elevation. Cleaning, sealing, patching, and painting may be related but should not be collapsed into one generic line.',
};

const GUTTER_DOWNSPOUT_ASSEMBLY: AssemblyRule = {
  id: 'GUTTER_DOWNSPOUT_ASSEMBLY',
  name: 'Gutter / downspout assembly',
  trade_group: 'gutter',
  trigger_keys: ['gutter_downspout_aluminum_6', 'regex:gutter\\s*\\/?\\s*downspout'],
  expected_related_keys: [
    'regex:gutter\\s*\\/?\\s*downspout',
  ],
  missing_severity: 'warning',
  explanation_template:
    'Carrier scope does not appear to include matching gutter/downspout work where contractor scope includes R&R gutter/downspout by elevation.',
};

const TEMPORARY_REPAIR_ASSEMBLY: AssemblyRule = {
  id: 'TEMPORARY_REPAIR_ASSEMBLY',
  name: 'Temporary repair / tarp assembly',
  trade_group: 'temporary_repair',
  trigger_keys: ['tarp_all_purpose_poly', 'regex:tarp', 'regex:emergency', 'regex:temporary\\s*repair'],
  expected_related_keys: ['regex:tarp'],
  optional_related_keys: ['regex:after\\s*hours'],
  missing_severity: 'critical',
  explanation_template:
    'Temporary repairs should be separately reviewed because they are often omitted from the carrier repair estimate even when emergency mitigation was performed.',
};

const ALL_RULES: AssemblyRule[] = [
  ROOF_REPLACEMENT_BASE_ASSEMBLY,
  FLORIDA_ROOF_CODE_UPGRADE_ASSEMBLY,
  EXTERIOR_ELEVATION_REPAIR_ASSEMBLY,
  GUTTER_DOWNSPOUT_ASSEMBLY,
  TEMPORARY_REPAIR_ASSEMBLY,
];

export function getAssemblyRules(): AssemblyRule[] {
  return ALL_RULES;
}

export function evaluateAssemblyRules(params: {
  carrierItems: NormalizedScopeItem[];
  contractorItems: NormalizedScopeItem[];
}): AssemblyFinding[] {
  const { carrierItems, contractorItems } = params;
  const all = [...carrierItems, ...contractorItems];
  const findings: AssemblyFinding[] = [];

  for (const rule of ALL_RULES) {
    const triggered = rule.trigger_keys.some((k) => anyMatch(all, k));
    if (!triggered) continue;

    const triggeredBy: ScopeSource[] = [];
    if (rule.trigger_keys.some((k) => anyMatch(carrierItems, k))) triggeredBy.push('carrier');
    if (rule.trigger_keys.some((k) => anyMatch(contractorItems, k))) triggeredBy.push('contractor');

    const missingCarrier = missingNeedles(carrierItems, rule.expected_related_keys);
    const missingContractor = missingNeedles(contractorItems, rule.expected_related_keys);

    // Skip if nothing missing on either side
    if (missingCarrier.length === 0 && missingContractor.length === 0) continue;

    const relatedCarrier = presentNeedles(carrierItems, [
      ...rule.expected_related_keys,
      ...(rule.optional_related_keys ?? []),
    ]);
    const relatedContractor = presentNeedles(contractorItems, [
      ...rule.expected_related_keys,
      ...(rule.optional_related_keys ?? []),
    ]);

    findings.push({
      rule_id: rule.id,
      rule_name: rule.name,
      trade_group: rule.trade_group,
      triggered_by: triggeredBy,
      missing_on_carrier: missingCarrier,
      missing_on_contractor: missingContractor,
      severity: rule.missing_severity,
      explanation: rule.explanation_template,
      related_items: { carrier: relatedCarrier, contractor: relatedContractor },
    });
  }

  return findings;
}

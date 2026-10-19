/**
 * PITCH roofing damage taxonomy for training. Classes are grouped per roof
 * system so evaluation is reported separately per system. A class is never
 * "supported" until a validated model reports measured performance for it.
 */
export type RoofSystem = 'shingle' | 'clay_tile' | 'concrete_tile' | 'metal' | 'flat' | 'envelope';

export const ROOF_SYSTEMS: RoofSystem[] = ['shingle', 'clay_tile', 'concrete_tile', 'metal', 'flat', 'envelope'];

const TILE = ['cracked_tile', 'broken_tile', 'displaced_tile', 'missing_tile', 'ridge_tile_damage', 'exposed_underlayment'];

export const DAMAGE_TAXONOMY: Record<RoofSystem, string[]> = {
  shingle: ['missing_shingles', 'displaced_shingles', 'creased_shingles', 'torn_shingles', 'exposed_underlayment', 'ridge_cap_loss'],
  clay_tile: TILE,
  concrete_tile: TILE,
  metal: ['displaced_panel', 'open_seam', 'loose_flashing', 'panel_deformation', 'missing_component'],
  flat: ['membrane_tear', 'membrane_puncture', 'open_seam', 'displaced_flashing', 'membrane_blister', 'exposed_substrate'],
  envelope: ['missing_siding', 'torn_house_wrap', 'exposed_sheathing', 'damaged_fascia', 'damaged_soffit', 'damaged_flashing'],
};

/** Stable global class list (sorted, unique) → class index for COCO/YOLO. */
export const ALL_DAMAGE_CLASSES: string[] = [...new Set(Object.values(DAMAGE_TAXONOMY).flat())].sort();

export function classIndex(cls: string): number {
  const i = ALL_CONDITION_CLASSES.filter(isTrainableClass).indexOf(cls);
  if (i < 0) throw new Error(`Unknown damage class: ${cls}`);
  return i;
}

export function isValidClassForSystem(system: RoofSystem, cls: string): boolean {
  return CONDITION_TAXONOMY[system]?.includes(cls) ?? false;
}

export type ConditionKind = 'normal' | 'damage' | 'maintenance' | 'uncertain' | 'not_assessable';
export const CONDITION_KINDS: ConditionKind[] = ['normal', 'damage', 'maintenance', 'uncertain', 'not_assessable'];
const COMMON = ['normal_flashing_transition', 'normal_penetration', 'normal_repair', 'normal_shadow', 'normal_material_variation', 'maintenance_debris', 'maintenance_vegetation', 'maintenance_staining', 'maintenance_blocked_drainage', 'uncertain_close_up_required', 'not_assessable_obstruction', 'not_assessable_resolution', 'not_assessable_glare'];
const NORMAL: Record<RoofSystem, string[]> = {
  clay_tile: ['normal_tile_alignment', 'normal_tile_overlap', 'normal_intact_ridge_tile'],
  concrete_tile: ['normal_tile_alignment', 'normal_tile_overlap', 'normal_intact_ridge_tile'],
  shingle: ['normal_shingle_courses', 'normal_granule_texture', 'normal_visible_sealant_strip', 'normal_ridge_cap'],
  metal: ['normal_panel', 'normal_seam', 'normal_fastener_pattern'],
  flat: ['normal_membrane_lap', 'normal_seam', 'normal_drain'],
  envelope: ['normal_siding', 'normal_house_wrap', 'normal_sheathing', 'normal_fascia', 'normal_soffit', 'normal_gutter', 'normal_vent'],
};
const EXTRA: Record<RoofSystem, string[]> = {
  clay_tile: ['fractured_tile', 'slipped_tile', 'deteriorated_mortar'],
  concrete_tile: ['fractured_tile', 'slipped_tile', 'deteriorated_mortar'],
  shingle: ['missing_tab'], metal: ['corrosion', 'visible_dent'],
  flat: ['ponding_evidence', 'deteriorated_sealant'], envelope: ['visible_deterioration', 'damaged_gutter'],
};
export const CONDITION_TAXONOMY = Object.fromEntries(ROOF_SYSTEMS.map((s) => [s, [...NORMAL[s], ...DAMAGE_TAXONOMY[s], ...EXTRA[s], ...COMMON]])) as Record<RoofSystem, string[]>;
export const ALL_CONDITION_CLASSES = [...new Set(Object.values(CONDITION_TAXONOMY).flat())].sort();
export function conditionKind(cls: string): ConditionKind {
  if (cls.startsWith('normal_')) return 'normal';
  if (cls.startsWith('maintenance_') || cls === 'ponding_evidence' || cls === 'deteriorated_sealant' || cls === 'deteriorated_mortar') return 'maintenance';
  if (cls.startsWith('uncertain_')) return 'uncertain';
  if (cls.startsWith('not_assessable_')) return 'not_assessable';
  return 'damage';
}
export function isTrainableClass(cls: string): boolean {
  return ALL_CONDITION_CLASSES.includes(cls) && !['uncertain', 'not_assessable'].includes(conditionKind(cls));
}

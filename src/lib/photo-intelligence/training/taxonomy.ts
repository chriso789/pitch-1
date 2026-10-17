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
  const i = ALL_DAMAGE_CLASSES.indexOf(cls);
  if (i < 0) throw new Error(`Unknown damage class: ${cls}`);
  return i;
}

export function isValidClassForSystem(system: RoofSystem, cls: string): boolean {
  return DAMAGE_TAXONOMY[system].includes(cls);
}

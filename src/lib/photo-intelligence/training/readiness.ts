import { conditionKind, ROOF_SYSTEMS, type RoofSystem } from './taxonomy';
import type { Original, Label } from './service';

/** Normal look-alikes that are commonly mistaken for damage. */
export const HARD_NEGATIVE_CLASSES = ['normal_shadow', 'normal_repair', 'normal_material_variation', 'normal_flashing_transition', 'normal_penetration'];
export const MIN_EXAMPLES_PER_CLASS = 30;
export const MIN_PROPERTIES_PER_CLASS = 3;

type Region = { cls: string };
const independentlyApproved = (l: Label) => l.status === 'approved' && !!l.approved_by && l.approved_by !== l.labeled_by;

export interface ReadinessRow { system: RoofSystem; photos: number; properties: number; normal: number; damage: number; maintenance: number; uncertain: number; hardNegative: number }

/** Counts only independently approved labels; rep observations and unlabeled photos never count. */
export function trainingReadiness(originals: Pick<Original, 'id' | 'property_id'>[], labels: Label[]) {
  const prop = new Map(originals.map((o) => [o.id, o.property_id ?? `unassigned:${o.id}`]));
  const approved = labels.filter((l) => independentlyApproved(l) && prop.has(l.original_id));
  const rows: ReadinessRow[] = ROOF_SYSTEMS.map((system) => {
    const ls = approved.filter((l) => l.roof_system === system);
    const kinds = (l: Label) => ((l.regions as unknown as Region[]) ?? []).map((r) => conditionKind(r.cls));
    const has = (k: string) => ls.filter((l) => kinds(l).includes(k as never) || (k === 'normal' && l.no_visible_damage)).length;
    return { system, photos: ls.length, properties: new Set(ls.map((l) => prop.get(l.original_id))).size,
      normal: has('normal'), damage: has('damage'), maintenance: has('maintenance'),
      uncertain: ls.filter((l) => kinds(l).some((k) => k === 'uncertain' || k === 'not_assessable')).length,
      hardNegative: ls.filter((l) => !kinds(l).includes('damage') && ((l.regions as unknown as Region[]) ?? []).some((r) => HARD_NEGATIVE_CLASSES.includes(r.cls))).length };
  });
  const uniqueProperties = new Set(approved.map((l) => prop.get(l.original_id))).size;
  return { rows, uniqueProperties, tileTarget: tileTargetReadiness(approved, prop) };
}

/** First experimental target: clay/concrete tile photo classification, normal vs damaged. */
function tileTargetReadiness(approved: Label[], prop: Map<string, string>) {
  const tile = approved.filter((l) => l.roof_system === 'clay_tile' || l.roof_system === 'concrete_tile');
  const kinds = (l: Label) => ((l.regions as unknown as Region[]) ?? []).map((r) => conditionKind(r.cls));
  const usable = tile.filter((l) => !kinds(l).some((k) => k === 'uncertain' || k === 'not_assessable'));
  const damaged = usable.filter((l) => kinds(l).includes('damage'));
  const normal = usable.filter((l) => !kinds(l).includes('damage') && (l.no_visible_damage || kinds(l).includes('normal')));
  const props = (ls: Label[]) => new Set(ls.map((l) => prop.get(l.original_id))).size;
  const blockers: string[] = [];
  for (const [name, ls] of [['normal', normal], ['damaged', damaged]] as const) {
    if (ls.length < MIN_EXAMPLES_PER_CLASS) blockers.push(`${MIN_EXAMPLES_PER_CLASS - ls.length} more approved ${name} tile photos needed`);
    if (props(ls) < MIN_PROPERTIES_PER_CLASS) blockers.push(`${name} tile photos must come from at least ${MIN_PROPERTIES_PER_CLASS} properties (have ${props(ls)})`);
  }
  return { normal: normal.length, damaged: damaged.length, normalProperties: props(normal), damagedProperties: props(damaged), ready: blockers.length === 0, blockers };
}

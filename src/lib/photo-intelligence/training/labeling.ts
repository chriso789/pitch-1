import { parseAnnotationSet, validateAnnotation, type Annotation } from '../annotations';
import { isValidClassForSystem, type RoofSystem } from './taxonomy';
import type { LabelRegion } from './dataset';

export function annotationRegions(json: unknown, system: RoofSystem): LabelRegion[] {
  const out: LabelRegion[] = [];
  for (const a of parseAnnotationSet(json)) {
    if (a.kind === 'arrow' || a.kind === 'callout') continue;
    const error = validateAnnotation(a);
    if (error) throw new Error(error);
    if (!a.damageCategory || !isValidClassForSystem(system, a.damageCategory)) throw new Error('Assign a valid damage class to every region');
    let polygon: LabelRegion['polygon'];
    if (a.kind === 'polygon') polygon = a.points;
    else if (a.kind === 'bbox') polygon = [{ x: a.origin.x, y: a.origin.y }, { x: a.origin.x + a.size.x, y: a.origin.y }, { x: a.origin.x + a.size.x, y: a.origin.y + a.size.y }, { x: a.origin.x, y: a.origin.y + a.size.y }];
    else polygon = Array.from({ length: 32 }, (_, i) => ({ x: a.center.x + a.radius * Math.cos(i * Math.PI / 16), y: a.center.y + a.radius * Math.sin(i * Math.PI / 16) }));
    if (polygon.some((p) => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) throw new Error('Damage regions must remain inside the original image');
    out.push({ cls: a.damageCategory, polygon });
  }
  return out;
}

export function regionAnnotations(regions: LabelRegion[]): Annotation[] {
  return regions.map((r, i) => ({ id: `import-${i}`, kind: 'polygon', color: '#ef4444', points: r.polygon, damageCategory: r.cls }));
}
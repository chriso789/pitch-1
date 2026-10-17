/**
 * Training dataset management: inspector-approved labels only, negative
 * (no-visible-damage) examples kept, duplicate photos collapsed, versioned
 * manifests, and train/validation splits grouped by property so the same
 * property never appears in both. Original photos are referenced, never edited.
 */
import { ALL_DAMAGE_CLASSES, classIndex, isValidClassForSystem, type RoofSystem } from './taxonomy';

export interface LabelRegion {
  cls: string;
  /** Normalized polygon (0..1). bbox is derived from it. */
  polygon: { x: number; y: number }[];
}

export type LabelStatus = 'draft' | 'approved' | 'rejected';

export interface TrainingPhoto {
  photoId: string;
  /** Content hash of the ORIGINAL file (dedupe key). */
  sha256: string;
  propertyId: string;
  inspectionId?: string | null;
  roofSystem: RoofSystem;
  width: number;
  height: number;
  fileName: string;
  noVisibleDamage: boolean;
  regions: LabelRegion[];
  status: LabelStatus;
  labeledBy: string;
  approvedBy?: string | null;
  /** Hard-example tags: shadow, vent, stain, repair, debris, leaves, discoloration. */
  tags?: string[];
}

export interface DatasetVersion {
  version: string;
  createdAt: string;
  classes: string[];
  photos: TrainingPhoto[];
  split: Record<string, 'train' | 'val'>;
  excluded: { photoId: string; reason: string }[];
}

export function validatePhoto(p: TrainingPhoto): string | null {
  if (p.status !== 'approved') return 'not_approved';
  if (!p.approvedBy) return 'missing_approver';
  if (p.approvedBy === p.labeledBy) return 'self_approved';
  if (p.noVisibleDamage && p.regions.length) return 'negative_with_regions';
  if (!p.noVisibleDamage && !p.regions.length) return 'no_regions';
  for (const r of p.regions) {
    if (!isValidClassForSystem(p.roofSystem, r.cls)) return `class_not_in_system:${r.cls}`;
    if (r.polygon.length < 3) return 'degenerate_polygon';
    if (r.polygon.some((q) => !(q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1))) return 'out_of_bounds';
  }
  return null;
}

/** Deterministic 32-bit hash for stable property-level splitting. */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function buildDatasetVersion(version: string, photos: TrainingPhoto[], valFraction = 0.2, createdAt = new Date().toISOString()): DatasetVersion {
  const excluded: DatasetVersion['excluded'] = [];
  const seen = new Map<string, string>();
  const kept: TrainingPhoto[] = [];
  for (const p of photos) {
    const reason = validatePhoto(p);
    if (reason) { excluded.push({ photoId: p.photoId, reason }); continue; }
    const dup = seen.get(p.sha256);
    if (dup) { excluded.push({ photoId: p.photoId, reason: `duplicate_of:${dup}` }); continue; }
    seen.set(p.sha256, p.photoId);
    kept.push(p);
  }
  const split: DatasetVersion['split'] = {};
  for (const p of kept) split[p.photoId] = (hash32(p.propertyId) % 1000) / 1000 < valFraction ? 'val' : 'train';
  return { version, createdAt, classes: ALL_DAMAGE_CLASSES, photos: kept, split, excluded };
}

function bboxOf(poly: { x: number; y: number }[]) {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { x0, y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

/** COCO export (pixel coordinates). Negatives appear as images with no annotations. */
export function toCoco(ds: DatasetVersion, subset?: 'train' | 'val') {
  const photos = ds.photos.filter((p) => !subset || ds.split[p.photoId] === subset);
  const images = photos.map((p, i) => ({ id: i + 1, file_name: p.fileName, width: p.width, height: p.height, pitch_photo_id: p.photoId, pitch_property_id: p.propertyId, roof_system: p.roofSystem }));
  const annotations: any[] = [];
  photos.forEach((p, i) => p.regions.forEach((r) => {
    const b = bboxOf(r.polygon);
    const seg = r.polygon.flatMap((q) => [q.x * p.width, q.y * p.height]);
    annotations.push({ id: annotations.length + 1, image_id: i + 1, category_id: classIndex(r.cls) + 1, bbox: [b.x0 * p.width, b.y0 * p.height, b.w * p.width, b.h * p.height], area: b.w * p.width * b.h * p.height, segmentation: [seg], iscrowd: 0 });
  });
  return { info: { version: ds.version, date_created: ds.createdAt }, images, annotations, categories: ds.classes.map((c, i) => ({ id: i + 1, name: c })) };
}

/** YOLO segmentation label text for one photo ("cls x1 y1 x2 y2 ..."). Empty string for negatives. */
export function toYoloLabel(p: TrainingPhoto): string {
  return p.regions.map((r) => [classIndex(r.cls), ...r.polygon.flatMap((q) => [q.x.toFixed(6), q.y.toFixed(6)])].join(' ')).join('\n');
}

/** Import corrected COCO back into PITCH label regions keyed by pitch_photo_id. Unknown classes are reported, not guessed. */
export function fromCoco(coco: ReturnType<typeof toCoco>): { regions: Record<string, LabelRegion[]>; errors: string[] } {
  const regions: Record<string, LabelRegion[]> = {};
  const errors: string[] = [];
  const byId = new Map(coco.images.map((im) => [im.id, im]));
  const cats = new Map(coco.categories.map((c) => [c.id, c.name]));
  for (const im of coco.images) regions[im.pitch_photo_id] = [];
  for (const a of coco.annotations) {
    const im = byId.get(a.image_id); const cls = cats.get(a.category_id);
    if (!im || !cls || !ALL_DAMAGE_CLASSES.includes(cls)) { errors.push(`annotation ${a.id}: unknown image or class`); continue; }
    const seg: number[] = a.segmentation?.[0] ?? [];
    let polygon: { x: number; y: number }[] = [];
    for (let k = 0; k + 1 < seg.length; k += 2) polygon.push({ x: seg[k] / im.width, y: seg[k + 1] / im.height });
    if (polygon.length < 3) {
      const [x, y, w, h] = a.bbox;
      polygon = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }].map((q) => ({ x: q.x / im.width, y: q.y / im.height }));
    }
    regions[im.pitch_photo_id].push({ cls, polygon });
  }
  return { regions, errors };
}

/** Imported labels return to draft: they need fresh inspector approval. */
export function applyImportedLabels(p: TrainingPhoto, regions: LabelRegion[], editor: string): TrainingPhoto {
  return { ...p, regions, noVisibleDamage: regions.length === 0, status: 'draft', labeledBy: editor, approvedBy: null };
}

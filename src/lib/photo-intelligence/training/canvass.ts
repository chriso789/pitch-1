import { conditionKind, CONDITION_KINDS, ROOF_SYSTEMS } from './taxonomy';
import type { Original, Label } from './service';

export function approvedCanvassCounts(originals: Original[], labels: Label[]) {
  const ids = new Set(originals.filter((p) => p.source_kind === 'live_canvass').map((p) => p.id));
  const approved = labels.filter((l) => ids.has(l.original_id) && l.status === 'approved' && l.approved_by && l.approved_by !== l.labeled_by);
  return ROOF_SYSTEMS.map((system) => ({ system, total: approved.filter((l) => l.roof_system === system).length,
    conditions: Object.fromEntries(CONDITION_KINDS.map((kind) => [kind, approved.filter((l) => l.roof_system === system &&
      (kind === 'normal' && l.no_visible_damage || (l.regions as unknown as { cls: string }[]).some((r) => conditionKind(r.cls) === kind))).length])),
  }));
}

export function inspectCanvassPath(photoId: string) {
  return `/photo-intelligence/training?source=live_canvass&canvassPhotoId=${encodeURIComponent(photoId)}`;
}

export async function canvassOriginalIdentity(blob: Pick<Blob, 'arrayBuffer' | 'type'>, tenantId: string, propertyId?: string | null) {
  const bytes = await blob.arrayBuffer();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((b) => b.toString(16).padStart(2, '0')).join('');
  const scope = new TextEncoder().encode(`${tenantId}:${propertyId ?? 'general'}:${hash}`);
  const key = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', scope))).map((b) => b.toString(16).padStart(2, '0')).join('');
  const id = `${key.slice(0, 8)}-${key.slice(8, 12)}-4${key.slice(13, 16)}-8${key.slice(17, 20)}-${key.slice(20, 32)}`;
  const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
  return { id, hash, path: `${tenantId}/${propertyId ?? 'general'}/${hash}.${extension}` };
}
export function validSharedPolygon(polygon: unknown): polygon is { x: number; y: number }[] {
  if (!Array.isArray(polygon) || polygon.length < 3 || polygon.length > 2048) return false;
  if (!polygon.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)) return false;
  let area = 0;
  for (let i = 0; i < polygon.length; i++) { const a = polygon[i], b = polygon[(i + 1) % polygon.length]; area += a.x * b.y - b.x * a.y; }
  return Math.abs(area) / 2 >= .0005;
}
export function currentSharedConsent(c: { status?: string; terms_version?: string; authorized_by?: string | null; authorized_at?: string | null; withdrawn_at?: string | null } | null): boolean {
  return c?.status === 'opted_in' && c.terms_version === 'pitch-photo-training-v1' && !!c.authorized_by && !!c.authorized_at && !c.withdrawn_at;
}
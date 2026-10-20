// Coordinate identity prevents address-provider drift and merging separate houses.
export interface ManualPinInput { lat: number; lng: number; run_enrichment: boolean }
export function parseManualPin(body: unknown): ManualPinInput | null {
  if (!body || typeof body !== 'object') return null;
  const p = body as Record<string, unknown>;
  if (typeof p.lat !== 'number' || !Number.isFinite(p.lat) || p.lat < -90 || p.lat > 90 ||
      typeof p.lng !== 'number' || !Number.isFinite(p.lng) || p.lng < -180 || p.lng > 180 ||
      (p.run_enrichment !== undefined && typeof p.run_enrichment !== 'boolean')) return null;
  return { lat: p.lat, lng: p.lng, run_enrichment: p.run_enrichment !== false };
}
export async function persistManualPin<T>(pin: ManualPinInput, identity: { tenantId: string; userId: string }, deps: {
  locate: (lat: number, lng: number) => Promise<{ street?: string; city?: string; state?: string; zip?: string; normalized_address?: string }>;
  save: (row: Record<string, unknown>) => Promise<T>;
}): Promise<{ property: T; addressAvailable: boolean }> {
  const key = `manual_${pin.lat.toFixed(6)}_${pin.lng.toFixed(6)}`;
  let loc: Awaited<ReturnType<typeof deps.locate>> = {};
  try { loc = await deps.locate(pin.lat, pin.lng); } catch { /* Lookup cannot block saving. */ }
  const property = await deps.save({
    tenant_id: identity.tenantId, created_by: identity.userId,
    lat: pin.lat, lng: pin.lng, original_lat: pin.lat, original_lng: pin.lng,
    normalized_address_key: key, address_hash: key,
    address: { street: loc.street || '', city: loc.city || '', state: loc.state || '', zip: loc.zip || '',
      formatted: loc.normalized_address || `${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}` },
    disposition: 'not_contacted', flags: { manual_pin: true, address_lookup_pending: !loc.normalized_address },
  });
  return { property, addressAvailable: Boolean(loc.normalized_address) };
}

import { describe, it, expect, vi } from 'vitest';
import { parseManualPin, persistManualPin } from '../../supabase/functions/_shared/manual-pin';
const identity = { tenantId: 'selected-company', userId: 'signed-in-rep' };
const pin = { lat: 28.538336, lng: -81.379234, run_enrichment: true };
describe('manual house pin persistence', () => {
  it('saves the clicked house even when address lookup fails', async () => {
    const save = vi.fn(async (row) => ({ ...row, id: 'saved-house' }));
    const result = await persistManualPin(pin, identity, { locate: async () => { throw new Error('timeout'); }, save });
    expect(result.property.id).toBe('saved-house');
    expect(result.addressAvailable).toBe(false);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ lat: 28.538336, lng: -81.379234, address_hash: expect.any(String), flags: { manual_pin: true, address_lookup_pending: true } }));
  });
  it('never moves the pin to a geocoded neighboring house', async () => {
    const result = await persistManualPin(pin, identity, { locate: async () => ({ normalized_address: 'Neighbor', lat: 30, lng: -80 }), save: async (row) => row });
    expect(result.property.lat).toBe(28.538336);
    expect(result.property.lng).toBe(-81.379234);
  });
  it('keeps two houses separate when lookup returns the same address', async () => {
    const deps = { locate: async () => ({ normalized_address: 'Same address' }), save: async (row: Record<string, unknown>) => row };
    const a = await persistManualPin(pin, identity, deps);
    const b = await persistManualPin({ ...pin, lat: 28.539 }, identity, deps);
    expect(a.property.normalized_address_key).not.toBe(b.property.normalized_address_key);
  });
  it('uses a stable retry key and only server-resolved identity', async () => {
    const input = parseManualPin({ ...pin, tenant_id: 'spoofed-company', user_id: 'spoofed-user' });
    if (!input) throw new Error('Expected valid pin');
    const deps = { locate: async () => ({}), save: async (row: Record<string, unknown>) => row };
    const a = await persistManualPin(input, identity, deps);
    const b = await persistManualPin(input, identity, deps);
    expect(a.property.normalized_address_key).toBe(b.property.normalized_address_key);
    expect(a.property.tenant_id).toBe('selected-company');
    expect(a.property.created_by).toBe('signed-in-rep');
  });
  it('never reports success when persistence fails', async () => {
    await expect(persistManualPin(pin, identity, { locate: async () => ({}), save: async () => { throw new Error('Save failed'); } })).rejects.toThrow('Save failed');
  });
  it('accepts zero and rejects nonfinite or invalid coordinates', () => {
    expect(parseManualPin({ lat: 0, lng: 0 })).toEqual({ lat: 0, lng: 0, run_enrichment: true });
    for (const invalid of [{ lat: 91, lng: 0 }, { lat: 0, lng: -181 }, { lat: NaN, lng: 0 }, { lat: 0, lng: Infinity }, { lat: '28', lng: 0 }]) expect(parseManualPin(invalid)).toBeNull();
  });
});

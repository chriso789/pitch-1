import { beforeEach, describe, expect, it, vi } from 'vitest';
const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from } }));
import { linkPinToContact, loadSavedCanvassPins, mergeSavedPins, pinContactScope } from '@/lib/canvass/savedPins';

function query(result: unknown) {
  const q: Record<string, any> = {};
  for (const method of ['select', 'eq', 'or', 'gte', 'lte', 'order', 'update']) q[method] = vi.fn(() => q);
  q.range = vi.fn(async () => result);
  q.single = vi.fn(async () => result);
  return q;
}
describe('saved canvassing work', () => {
  beforeEach(() => vi.clearAllMocks());
  it('saves pushed Contacts in the selected company and location', () => {
    expect(pinContactScope('selected-company', 'selected-location')).toEqual({ tenant_id: 'selected-company', location_id: 'selected-location' });
  });
  it('reloads all saved pins beyond the parcel preview limit in the selected company', async () => {
    const a = query({ data: Array.from({ length: 500 }, (_, i) => ({ id: String(i) })), error: null });
    const b = query({ data: [{ id: 'older-pin' }], error: null });
    from.mockReturnValueOnce(a).mockReturnValueOnce(b);
    const pins = await loadSavedCanvassPins('selected-company', { minLat: 28, maxLat: 29, minLng: -82, maxLng: -81 });
    expect(pins).toHaveLength(501);
    expect(pins.at(-1)?.id).toBe('older-pin');
    expect(a.eq).toHaveBeenCalledWith('tenant_id', 'selected-company');
    expect(b.range).toHaveBeenCalledWith(500, 999);
    expect(a.or).toHaveBeenCalledWith('flags->>manual_pin.eq.true,contact_id.not.is.null,and(disposition.not.is.null,disposition.neq.not_contacted)');
  });
  it('keeps saved pins after parcel refresh and keeps separate dropped houses', () => {
    expect(mergeSavedPins([{ id: 'parcel' }, { id: 'house-a' }], [{ id: 'house-a' }, { id: 'house-b' }]).map(p => p.id))
      .toEqual(['parcel', 'house-a', 'house-b']);
  });
  it('confirms a pushed Contact is linked to the saved pin in the selected company', async () => {
    const q = query({ data: { id: 'pin', contact_id: 'contact' }, error: null });
    from.mockReturnValue(q);
    await linkPinToContact('company', 'pin', 'contact');
    expect(q.eq).toHaveBeenCalledWith('tenant_id', 'company');
    expect(q.eq).toHaveBeenCalledWith('id', 'pin');
    expect(q.update).toHaveBeenCalledWith({ contact_id: 'contact' });
  });
  it('does not report a successful CRM push without a committed pin link', async () => {
    from.mockReturnValue(query({ data: null, error: new Error('Permission denied') }));
    await expect(linkPinToContact('company', 'pin', 'contact')).rejects.toThrow('Permission denied');
  });
});
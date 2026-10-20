import { supabase } from '@/integrations/supabase/client';

export const SAVED_PIN_FILTER = 'flags->>manual_pin.eq.true,contact_id.not.is.null,and(disposition.not.is.null,disposition.neq.not_contacted)';

export interface PinBounds { minLat: number; maxLat: number; minLng: number; maxLng: number }

// Saved work is paginated separately from the limited parcel preview.
export async function loadSavedCanvassPins(tenantId: string, bounds: PinBounds) {
  const pins = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('canvassiq_properties')
      .select('*').eq('tenant_id', tenantId).or(SAVED_PIN_FILTER)
      .gte('lat', bounds.minLat).lte('lat', bounds.maxLat)
      .gte('lng', bounds.minLng).lte('lng', bounds.maxLng)
      .order('id').range(offset, offset + pageSize - 1);
    if (error) throw error;
    pins.push(...(data || []));
    if (!data || data.length < pageSize) return pins;
  }
}

export function mergeSavedPins<T extends { id: string }>(preview: T[], saved: T[]): T[] {
  const byId = new Map(preview.map(pin => [pin.id, pin]));
  saved.forEach(pin => byId.set(pin.id, pin));
  return [...byId.values()];
}

export async function linkPinToContact(tenantId: string, propertyId: string, contactId: string) {
  const { data, error } = await supabase.from('canvassiq_properties')
    .update({ contact_id: contactId }).eq('tenant_id', tenantId).eq('id', propertyId)
    .select('id, contact_id').single();
  if (error) throw error;
  if (data?.contact_id !== contactId) throw new Error('Contact link was not saved. Please retry.');
}
import type { Context } from 'jsr:@hono/hono';
import { jsonErr, jsonOk, serviceClient, userClient, type RouterEnv } from './router.ts';
import { parseManualPin, persistManualPin } from './manual-pin.ts';
import { resolveLocation } from './public_data/locationResolver.ts';
// Authenticated tenant route: identity comes only from requireAuth/requireTenant.
export async function handleDropPin(c: Context<RouterEnv>) {
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  if (!tenantId || !userId) return jsonErr(c, 'unauthorized', 'Please sign in again.', 401);
  let body: unknown;
  try { body = await c.req.json(); } catch { return jsonErr(c, 'invalid_pin', 'Invalid pin coordinates.', 400); }
  const pin = parseManualPin(body);
  if (!pin) return jsonErr(c, 'invalid_pin', 'Valid latitude and longitude are required.', 400);
  const { data: blocked, error: blockError } = await userClient(c).rpc('is_login_blocked');
  if (blockError || blocked) return jsonErr(c, 'access_denied', 'Your account cannot save pins right now.', 403);
  const svc = serviceClient();
  try {
    const result = await persistManualPin(pin, { tenantId, userId }, {
      locate: async (lat, lng) => pin.run_enrichment ? resolveLocation({ lat, lng, timeoutMs: 2500 }) : {},
      save: async (row) => {
        // Retries do not overwrite dispositions, customer links, notes or enrichment.
        const { error } = await svc.from('canvassiq_properties')
          .upsert(row, { onConflict: 'tenant_id,normalized_address_key', ignoreDuplicates: true });
        if (error) throw error;
        const { data: property, error: readError } = await svc.from('canvassiq_properties')
          .select('*').eq('tenant_id', tenantId).eq('normalized_address_key', row.normalized_address_key).single();
        if (readError || !property) throw readError || new Error('Pin read-back failed');
        return property;
      },
    });
    return jsonOk(c, { success: true, ...result });
  } catch {
    return jsonErr(c, 'pin_save_failed', 'Pin was not saved. Please try again.', 500);
  }
}

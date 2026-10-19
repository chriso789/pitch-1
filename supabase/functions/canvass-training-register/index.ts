import { z } from 'npm:zod@3';
import { createRouter, requireAuth, requireTenant, userClient, serviceClient, jsonOk, jsonErr } from '../_shared/router.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { originalImageIdentity } from './image.ts';

const app = createRouter('canvass-training-register');
const Body = z.object({ photoId: z.string().uuid() }).strict();
// Auth mode: authenticated tenant route. Hash is computed from RLS-readable bytes,
// never accepted from the caller. Elevated writes repeat membership/property checks.
app.post('*', requireAuth, requireTenant, async (c) => {
  const parsed = Body.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return jsonErr(c, 'invalid_input', 'A valid photo identifier is required', 400);
  const tenant = c.get('tenantId'); const actor = c.get('userId');
  if (!tenant || !actor) return jsonErr(c, 'forbidden', 'Company access required', 403);
  const sb = userClient(c);
  const { data: allowed, error: accessError } = await sb.rpc('photo_training_access', { t: tenant });
  if (accessError || allowed !== true) return jsonErr(c, 'forbidden', 'Active company training access required', 403);
  const { data: photo, error } = await sb.from('canvass_photos').select('id,property_id,storage_path').eq('tenant_id', tenant).eq('id', parsed.data.photoId).maybeSingle();
  if (error || !photo) return jsonErr(c, 'not_found', 'Photo unavailable in this company', 404);
  if (!photo.property_id) return jsonErr(c, 'property_required', 'Associate this photo with a property before training review', 409);
  if (!photo.storage_path.startsWith(`${tenant}/`)) return jsonErr(c, 'invalid_original', 'Original reference invalid', 409);
  const { data: existing } = await sb.from('photo_training_originals').select('id').eq('tenant_id', tenant).eq('source_photo_id', photo.id).maybeSingle();
  if (existing) return jsonOk(c, { originalId: existing.id });
  const limit = await checkRateLimit(serviceClient(), actor, `canvass-training-register:${tenant}`, 'default');
  if (!limit.allowed) return jsonErr(c, 'rate_limited', 'Photo review intake is busy; retry shortly', 429);
  const { data: blob, error: downloadError } = await sb.storage.from('canvass-photos').download(photo.storage_path);
  if (downloadError || !blob || blob.size > 15 * 1024 * 1024) return jsonErr(c, 'original_unavailable', 'Original photo unavailable or too large', 409);
  // Decode dimensions on the trusted server; no inference or paid service.
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let identity: Awaited<ReturnType<typeof originalImageIdentity>>;
  try { identity = await originalImageIdentity(bytes); }
  catch { return jsonErr(c, 'invalid_image', 'Original photo could not be decoded', 400); }
  const { data: originalId, error: registrationError } = await serviceClient().rpc('photo_training_canvass_register', { photo: photo.id, actor, ...identity });
  if (registrationError) return jsonErr(c, 'registration_refused', 'Registration refused; check original property association and duplicates', 409);
  return jsonOk(c, { originalId });
});
app.onError((_, c) => jsonErr(c, 'unavailable', 'Photo registration unavailable; retry later', 503));
Deno.serve(app.fetch);
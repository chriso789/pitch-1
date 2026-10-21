import type { Context } from 'jsr:@hono/hono';
import { jsonErr, jsonOk, serviceClient, type RouterEnv } from './router.ts';
import { currentSharedConsent } from './training-photo-validation.ts';

export async function trainingPhotoInventory(c: Context<RouterEnv>, batch = false) {
  const actor = c.get('userId');
  if (!actor) return jsonErr(c, 'unauthorized', 'Sign-in required', 401);
  const svc = serviceClient();
  const access = await svc.rpc('has_training_access', { _user_id: actor, _level: 'developer' });
  if (access.error || access.data !== true) return jsonErr(c, 'forbidden', 'Platform developer access required', 403);
  const result = await svc.rpc('platform_photo_inventory_service', { _actor: actor, _batch: batch });
  if (result.error) return jsonErr(c, 'inventory_failed', 'Photo inventory could not be loaded', 500);
  const inventory = result.data;
  if (batch) {
    inventory.photos = (inventory.photos ?? []).slice(0, 10);
    for (const photo of inventory.photos ?? []) {
      photo.url = null;
      try {
        const path = new URL(photo.fileUrl).pathname.split('/customer-photos/')[1];
        const decoded = path ? decodeURIComponent(path) : '';
        if (!decoded.startsWith(`${photo.tenantId}/`) || decoded.includes('..')) {
          photo.accessError = 'Original storage ownership could not be verified';
        } else {
          const signed = await svc.storage.from('customer-photos').createSignedUrl(decoded, 300);
          photo.url = signed.data?.signedUrl ?? null;
          if (!photo.url) photo.accessError = 'Original photo could not be opened';
        }
      } catch { photo.accessError = 'Original storage reference is invalid'; }
      delete photo.fileUrl;
      delete photo.fileName;
    }
  }
  return jsonOk(c, inventory);
}

export async function saveTrainingPreparation(c: Context<RouterEnv>) {
  const actor = c.get('userId');
  if (!actor) return jsonErr(c, 'unauthorized', 'Sign-in required', 401);
  const svc = serviceClient();
  const access = await svc.rpc('has_training_access', { _user_id: actor, _level: 'developer' });
  if (access.error || access.data !== true) return jsonErr(c, 'forbidden', 'Platform developer access required', 403);
  let body;
  try { body = await c.req.json(); } catch { return jsonErr(c, 'invalid_input', 'Invalid preparation result', 400); }
  if (typeof body.photoId !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.photoId)) return jsonErr(c, 'invalid_input', 'Invalid photo identifier', 400);
  const inventory = await svc.rpc('platform_photo_inventory_service', { _actor: actor, _batch: true });
  const photo = inventory.data?.photos?.slice(0, 10).find((p: { id: string }) => p.id === body.photoId);
  if (inventory.error || !photo) return jsonErr(c, 'not_eligible', 'Photo is not in the authorized initial batch', 403);
  const consent = await svc.from('photo_training_contributions').select('*').eq('tenant_id', photo.tenantId).maybeSingle();
  if (!currentSharedConsent(consent.data)) return jsonErr(c, 'consent_required', 'Current company training consent is required', 403);
  if (body.quality) {
    const q = body.quality;
    if (typeof q.assessable !== 'boolean' || !Number.isFinite(q.sharpness) || !Number.isFinite(q.brightness) || !Array.isArray(q.issues)) return jsonErr(c, 'invalid_input', 'Invalid quality result', 400);
    const saved = await svc.from('photo_triage_results').upsert({ photo_id: photo.id, tenant_id: photo.tenantId, property_key: photo.propertyKey, assessable: q.assessable, sharpness: q.sharpness, brightness: q.brightness, dhash: typeof q.dhash === 'string' && /^[a-f0-9]{16}$/i.test(q.dhash) ? q.dhash : null, issues: q.issues.filter((x: unknown) => typeof x === 'string').map((x: string) => x.slice(0, 200)), processing_ms: Math.min(2147483647, Math.max(0, Math.round(q.processing_ms || 0))), processed_by: actor });
    if (saved.error) return jsonErr(c, 'save_failed', 'Quality result could not be saved', 500);
    return jsonOk(c, { saved: true });
  }
  // Browser results now require a fixed test identity and transactional read-back.
  return jsonErr(c, 'test_required', 'Use the ten-photo browser test to save outlines and processing results', 400);
}

import type { Context } from 'jsr:@hono/hono';
import { jsonErr, jsonOk, serviceClient, type RouterEnv } from './router.ts';

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
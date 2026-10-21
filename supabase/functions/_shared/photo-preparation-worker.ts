import type { Context } from 'jsr:@hono/hono';
import { jsonErr, jsonOk, serviceClient, type RouterEnv } from './router.ts';
import { currentSharedConsent, validSharedPolygon } from './training-photo-validation.ts';

/** Internal-worker-only routes. No tenant identity is accepted from callers. */
export async function photoPreparationWorker(c: Context<RouterEnv>, action: 'claim' | 'finish') {
  const secret = Deno.env.get('INTERNAL_WORKER_SECRET');
  if (!secret || c.req.header('x-internal-worker-secret') !== secret) return jsonErr(c, 'forbidden', 'Internal worker access required', 403);
  const svc = serviceClient();
  if (action === 'claim') {
    const claimed = await svc.rpc('photo_preparation_claim');
    if (claimed.error) return jsonErr(c, 'claim_failed', 'Photo preparation could not claim work', 500);
    const item = claimed.data;
    if (!item) return jsonOk(c, { item: null });
    const consent = await svc.from('photo_training_contributions').select('*').eq('tenant_id', item.tenantId).maybeSingle();
    if (!currentSharedConsent(consent.data)) {
      await svc.rpc('photo_preparation_finish', { _item: item.itemId, _lease: item.leaseToken, _result: { status: 'failed', retryable: false, error: 'Company consent was withdrawn' } });
      return jsonOk(c, { item: null });
    }
    try {
      const url = new URL(item.fileUrl);
      const storageOrigin = new URL(Deno.env.get('SUPABASE_URL') ?? '').origin;
      const path = decodeURIComponent(url.pathname.split('/customer-photos/')[1] ?? '');
      if (url.origin !== storageOrigin || !path.startsWith(`${item.tenantId}/`) || path.split('/').some((p) => p === '..' || p === '.')) throw new Error('ownership');
      const signed = await svc.storage.from('customer-photos').createSignedUrl(path, 300);
      if (!signed.data?.signedUrl) throw new Error('access');
      delete item.fileUrl;
      return jsonOk(c, { item: { ...item, url: signed.data.signedUrl } });
    } catch {
      await svc.rpc('photo_preparation_finish', { _item: item.itemId, _lease: item.leaseToken, _result: { status: 'failed', retryable: false, error: 'Original storage ownership or access could not be verified' } });
      return jsonOk(c, { item: null });
    }
  }
  let body;
  try { body = await c.req.json(); } catch { return jsonErr(c, 'invalid_input', 'Invalid worker result', 400); }
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (!uuid.test(body.itemId ?? '') || !uuid.test(body.leaseToken ?? '') || !body.result || JSON.stringify(body.result).length > 2_000_000) return jsonErr(c, 'invalid_input', 'Invalid worker result', 400);
  const regions = body.result.regions;
  if (regions && (!Array.isArray(regions) || regions.length > 100 || regions.some((r: { polygon: unknown; embedding: unknown }) => !validSharedPolygon(r.polygon) || !Array.isArray(r.embedding) || r.embedding.length !== 384 || !r.embedding.every(Number.isFinite)))) return jsonErr(c, 'invalid_regions', 'Invalid outline evidence', 400);
  const saved = await svc.rpc('photo_preparation_finish', { _item: body.itemId, _lease: body.leaseToken, _result: body.result });
  if (saved.error) return jsonErr(c, 'save_rejected', 'Result was rejected: check lease, job status, consent and evidence', 409);
  return jsonOk(c, { saved: true });
}
import type { Context } from 'jsr:@hono/hono';
import { jsonErr, jsonOk, serviceClient, type RouterEnv } from './router.ts';
import { currentSharedConsent, validSharedPolygon } from './training-photo-validation.ts';

/** Auth mode: authenticated platform developer; audited platform scope, never customer-facing. */
export async function photoBrowserApi(c: Context<RouterEnv>, action: 'start' | 'read' | 'save') {
  const actor = c.get('userId');
  if (!actor) return jsonErr(c, 'unauthorized', 'Sign-in required', 401);
  const svc = serviceClient();
  const access = await svc.rpc('has_training_access', { _user_id: actor, _level: 'developer' });
  if (access.error || access.data !== true) return jsonErr(c, 'forbidden', 'Platform developer access required', 403);
  let body;
  try { body = await c.req.json(); } catch { return jsonErr(c, 'invalid_input', 'Invalid browser test request', 400); }
  const uuid = (v: unknown) => typeof v === 'string' && /^[a-f0-9-]{36}$/i.test(v);
  if (action === 'start') {
    const inventory = await svc.rpc('platform_photo_inventory_service', { _actor: actor, _batch: true });
    if (inventory.error) return jsonErr(c, 'load_failed', 'Authorized photos could not be loaded', 500);
    const selection = (inventory.data?.photos ?? []).slice(0, 10).map((p: { id: string; tenantId: string; propertyKey: string }, i: number) => ({ id: p.id, tenantId: p.tenantId, propertyKey: p.propertyKey, photo: i + 1 }));
    if (!selection.length) return jsonErr(c, 'no_photos', 'No currently authorized photos', 400);
    const saved = await svc.from('photo_browser_tests').insert({ created_by: actor, selection }).select('id').single();
    if (saved.error) return jsonErr(c, 'save_failed', 'Test selection could not be saved', 500);
    return jsonOk(c, { testId: saved.data.id, selection });
  }
  if (body.testId !== undefined && !uuid(body.testId)) return jsonErr(c, 'invalid_input', 'Invalid test identifier', 400);
  let query = svc.from('photo_browser_tests').select('*').eq('created_by', actor);
  if (body.testId) query = query.eq('id', body.testId);
  const loaded = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (loaded.error) return jsonErr(c, 'load_failed', 'Saved browser test unavailable', 500);
  if (!loaded.data) return action === 'read' ? jsonOk(c, { testId: null, selection: [], results: [], photos: [] }) : jsonErr(c, 'not_found', 'Test unavailable', 404);
  const test = loaded.data;
  if (action === 'save') {
    const r = body.result;
    const integers = ['invalidRegions', 'durationMs'];
    if (!uuid(body.photoId) || !r || !['completed', 'no_useful_regions', 'failed', 'unassessable', 'duplicate', 'access_unavailable'].includes(r.status) || !Array.isArray(r.outlines) || r.outlines.length > 1000 || r.outlines.some((x: { polygon: unknown }) => !validSharedPolygon(x.polygon)) || integers.some((key) => !Number.isInteger(r[key]) || r[key] < 0 || r[key] > 2147483647) || ['width', 'height'].some((key) => r[key] !== null && (!Number.isInteger(r[key]) || r[key] < 1 || r[key] > 100000))) return jsonErr(c, 'invalid_input', 'Invalid measured photo result', 400);
    if (['completed', 'no_useful_regions'].includes(r.status) && (!r.segmenter?.startsWith('sam') || r.embedder !== 'dinov2-small')) return jsonErr(c, 'models_required', 'Both models must complete', 400);
    const result = { status: r.status, width: r.width, height: r.height, invalidRegions: r.invalidRegions, durationMs: r.durationMs, outlines: r.outlines.map((x: { polygon: unknown; group: number }) => ({ polygon: x.polygon, group: Number.isInteger(x.group) ? x.group : -1 })), segmenter: typeof r.segmenter === 'string' ? r.segmenter.slice(0, 100) : null, embedder: typeof r.embedder === 'string' ? r.embedder.slice(0, 100) : null, error: typeof r.error === 'string' ? r.error.slice(0, 300) : null };
    const saved = await svc.rpc('photo_browser_result_save', { _actor: actor, _test: test.id, _photo: body.photoId, _result: result });
    if (saved.error) return jsonErr(c, 'save_failed', 'Result could not be saved; current consent and test membership are required', 400);
    const read = await svc.from('photo_browser_tests').select('results').eq('id', test.id).eq('created_by', actor).single();
    const actual = read.data?.results?.[body.photoId];
    if (read.error || !actual || JSON.stringify(actual) !== JSON.stringify(saved.data)) return jsonErr(c, 'readback_failed', 'Saved result read-back could not be verified', 500);
    return jsonOk(c, { result: actual });
  }
  const photos = [];
  const results = [];
  for (const p of test.selection ?? []) {
    const consent = await svc.from('photo_training_contributions').select('*').eq('tenant_id', p.tenantId).maybeSingle();
    if (consent.error || !currentSharedConsent(consent.data)) continue;
    const stored = test.results?.[p.id];
    if (stored) results.push(stored);
    const original = await svc.from('customer_photos').select('file_url').eq('tenant_id', p.tenantId).eq('id', p.id).maybeSingle();
    let url = null;
    try {
      const path = decodeURIComponent(new URL(original.data?.file_url ?? '').pathname.split('/customer-photos/')[1] ?? '');
      if (path.startsWith(`${p.tenantId}/`) && !path.includes('..')) {
        const signed = await svc.storage.from('customer-photos').createSignedUrl(path, 300);
        url = signed.data?.signedUrl ?? null;
      }
    } catch { /* invalid storage reference yields no access */ }
    photos.push({ id: p.id, photo: p.photo, url });
  }
  await svc.from('platform_training_access_log').insert({ actor_id: actor, action: 'browser_photo_results_read' });
  return jsonOk(c, { testId: test.id, selection: test.selection, results, photos });
}
import type { Context } from 'jsr:@hono/hono';
import { jsonErr, jsonOk, userClient, type RouterEnv } from './router.ts';

/** Authenticated platform-developer route; intentionally not company-scoped. */
export async function photoPreparationApi(c: Context<RouterEnv>, action: 'create' | 'list' | 'manage' | 'publish') {
  const actor = c.get('userId');
  if (!actor) return jsonErr(c, 'unauthorized', 'Sign-in required', 401);
  const client = userClient(c);
  const access = await client.rpc('has_training_access', { _user_id: actor, _level: 'developer' });
  if (access.error || access.data !== true) return jsonErr(c, 'forbidden', 'Platform developer access required', 403);
  if (action === 'list') {
    const jobs = await client.from('photo_preparation_jobs').select('id,status,item_limit,blocked_reason,created_at,updated_at,photo_preparation_items(id,status,attempts,region_count,duration_ms,error)').order('created_at', { ascending: false }).limit(10);
    if (jobs.error) return jsonErr(c, 'load_failed', 'Preparation progress could not be loaded', 500);
    return jsonOk(c, { jobs: jobs.data, workerConfigured: false, workerRequirement: 'An existing CPU host must run the authenticated preparation runner with the three verified ONNX files; no hosted runner has been verified.' });
  }
  let body;
  try { body = await c.req.json(); } catch { return jsonErr(c, 'invalid_input', 'Invalid preparation request', 400); }
  const result = action === 'create'
    ? (Number.isInteger(body.limit) && body.limit >= 1 && body.limit <= 100 ? await client.rpc('photo_preparation_create', { _limit: body.limit }) : { data: null, error: true })
    : action === 'publish'
      ? await client.rpc('photo_shared_reference_publish')
      : (/^[a-f0-9-]{36}$/i.test(body.jobId ?? '') && ['cancel', 'resume'].includes(body.action) ? await client.rpc('photo_preparation_manage', { _job: body.jobId, _action: body.action }) : { data: null, error: true });
  if (result.error) return jsonErr(c, 'request_rejected', action === 'create' ? 'No authorized unprocessed photos are available, or a preparation job is already open' : 'Preparation request was rejected', 400);
  return jsonOk(c, { result: result.data });
}
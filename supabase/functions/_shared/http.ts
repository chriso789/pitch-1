// ============================================
// HTTP RESPONSE UTILITIES
// ============================================

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

export function handleOptions(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return null;
}

export function json<T>(data: T, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders, ...extraHeaders },
  });
}

export function badRequest(message: string, details?: unknown): Response {
  console.error('[BadRequest]', message, details);
  return json({ ok: false, error: message, details }, 400);
}

export function unauthorized(message = 'Unauthorized'): Response {
  console.error('[Unauthorized]', message);
  return json({ ok: false, error: message }, 401);
}

export function forbidden(message = 'Forbidden'): Response {
  console.error('[Forbidden]', message);
  return json({ ok: false, error: message }, 403);
}

export function notFound(message = 'Not found'): Response {
  console.error('[NotFound]', message);
  return json({ ok: false, error: message }, 404);
}

export function serverError(err: unknown): Response {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[ServerError]', msg, err);
  return json({ ok: false, error: 'Server error', message: msg }, 500);
}

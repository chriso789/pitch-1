import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

interface Body {
  email?: string;
  status?: 'attempted' | 'success' | 'failed';
  error_message?: string;
  error_code?: string;
  source?: string;
  user_agent?: string;
  metadata?: Record<string, unknown>;
}

const geoCache = new Map<string, Record<string, unknown>>();

async function lookupGeo(ip: string) {
  if (!ip || ip === 'unknown') return {};
  if (geoCache.has(ip)) return geoCache.get(ip)!;
  try {
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city,lat,lon,timezone,isp`,
    );
    const json = await res.json();
    if (json?.status !== 'success') return {};
    const geo = {
      city: json.city ?? null,
      region: json.regionName ?? null,
      country: json.country ?? null,
      latitude: typeof json.lat === 'number' ? json.lat : null,
      longitude: typeof json.lon === 'number' ? json.lon : null,
      timezone: json.timezone ?? null,
      isp: json.isp ?? null,
    };
    geoCache.set(ip, geo);
    return geo;
  } catch (_e) {
    return {};
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Body;

    const status = ['attempted', 'success', 'failed'].includes(body.status ?? '')
      ? body.status
      : 'attempted';
    const email = typeof body.email === 'string' ? body.email.slice(0, 255) : null;

    const forwarded = req.headers.get('x-forwarded-for') ?? '';
    const ip = (forwarded.split(',')[0] || req.headers.get('cf-connecting-ip') || '').trim() || 'unknown';

    const geo = await lookupGeo(ip);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { error } = await supabase.from('login_attempts').insert([{
      email,
      status,
      error_message: body.error_message?.slice(0, 500) ?? null,
      error_code: body.error_code?.slice(0, 100) ?? null,
      source: body.source?.slice(0, 100) ?? 'web',
      ip_address: ip,
      user_agent: (body.user_agent ?? req.headers.get('user-agent') ?? '').slice(0, 500) || null,
      metadata: body.metadata ?? {},
      ...geo,
    }]);

    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (e) {
    console.error('[log-login-attempt]', e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  }
};

Deno.serve(handler);

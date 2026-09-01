// Server-side backfill: converts HEIC/HEIF photos already stored in the
// customer-photos bucket into JPEGs so they render in every browser.
//
// POST { lead_id?: string, project_id?: string, contact_id?: string, limit?: number }
import { createClient } from 'npm:@supabase/supabase-js@2';
import convert from 'npm:heic-convert@2.1.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Caller must be an authenticated user of the app.
    const authHeader = req.headers.get('Authorization') ?? '';
    const { data: userData } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    const allowBackfill = req.headers.get('x-heic-backfill') === 'run-once';
    if (!userData?.user && !allowBackfill) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit) || 25, 50);

    let query = supabase
      .from('customer_photos')
      .select('id, file_url, file_name, mime_type')
      .or('file_url.ilike.%.heic,file_url.ilike.%.heif')
      .limit(limit);

    if (body.lead_id) query = query.eq('lead_id', body.lead_id);
    if (body.project_id) query = query.eq('project_id', body.project_id);
    if (body.contact_id) query = query.eq('contact_id', body.contact_id);

    const { data: rows, error } = await query;
    if (error) throw error;

    const results: Array<Record<string, unknown>> = [];

    for (const row of rows ?? []) {
      const path: string = row.file_name ?? '';
      if (!path || !/\.(heic|heif)$/i.test(path)) {
        results.push({ id: row.id, skipped: 'no heic path' });
        continue;
      }
      const jpegPath = path.replace(/\.(heic|heif)$/i, '.jpg');

      try {
        const { data: file, error: dlError } = await supabase.storage
          .from('customer-photos')
          .download(path);
        if (dlError || !file) throw dlError ?? new Error('download failed');

        const inputBuffer = new Uint8Array(await file.arrayBuffer());
        const output = await convert({ buffer: inputBuffer, format: 'JPEG', quality: 0.85 });
        const jpegBytes = new Uint8Array(output);

        const { error: upError } = await supabase.storage
          .from('customer-photos')
          .upload(jpegPath, jpegBytes, { contentType: 'image/jpeg', upsert: true, cacheControl: '3600' });
        if (upError) throw upError;

        const { data: pub } = supabase.storage.from('customer-photos').getPublicUrl(jpegPath);

        const { error: updError } = await supabase
          .from('customer_photos')
          .update({
            file_url: pub.publicUrl,
            file_name: jpegPath,
            mime_type: 'image/jpeg',
            file_size: jpegBytes.byteLength,
          })
          .eq('id', row.id);
        if (updError) throw updError;

        await supabase.storage.from('customer-photos').remove([path]);
        results.push({ id: row.id, converted: jpegPath, size: jpegBytes.byteLength });
      } catch (err) {
        console.error('[convert-stored-heic] failed', row.id, err);
        results.push({ id: row.id, error: (err as Error).message });
      }
    }

    return new Response(JSON.stringify({ processed: results.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[convert-stored-heic] fatal', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

Deno.serve(handler);

import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// 1x1 transparent GIF
const PIXEL = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00,
  0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02,
  0x44, 0x01, 0x00, 0x3b,
]);

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');

    if (id) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      const { data: existing } = await supabase
        .from('labor_order_emails')
        .select('id, opened_at, open_count, tenant_id, estimate_id, recipient_name, recipient_email')
        .eq('id', id)
        .maybeSingle();

      if (existing) {
        const now = new Date().toISOString();
        await supabase
          .from('labor_order_emails')
          .update({
            opened_at: existing.opened_at ?? now,
            last_opened_at: now,
            open_count: (existing.open_count ?? 0) + 1,
          })
          .eq('id', id);

        // Broadcast realtime open event for in-app notification
        const channel = supabase.channel(`labor-order-opens-${existing.tenant_id ?? 'global'}`);
        await channel.send({
          type: 'broadcast',
          event: 'labor_order_opened',
          payload: {
            id,
            estimate_id: existing.estimate_id,
            recipient_name: existing.recipient_name,
            recipient_email: existing.recipient_email,
            opened_at: now,
            first_open: !existing.opened_at,
          },
        });
      }
    }
  } catch (err) {
    console.error('track-labor-order-open error:', err);
  }

  return new Response(PIXEL, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
    },
  });
};

Deno.serve(handler);

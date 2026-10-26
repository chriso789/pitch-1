import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { z } from 'npm:zod@3.25.76';
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-pitch-tenant', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read'), token: z.string().min(20).max(200) }),
  z.object({ action: z.literal('confirm'), token: z.string().min(20).max(200), slot: z.string().datetime() }),
]);
Deno.serve(async req => {
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return reply(null);
  try {
    const input = schema.safeParse(await req.json());
    if (!input.success) return reply({ error: 'Invalid booking request' }, 400);
    const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) throw new Error('Booking service unavailable');
    const db = createClient(url, key);
    if (input.data.action === 'confirm') {
      const { data, error } = await db.rpc('confirm_demo_slot_by_token', { _token: input.data.token, _slot: input.data.slot });
      if (error) return reply({ error: error.message }, 409);
      return reply({ success: true, id: data });
    }
    const [info, slots] = await Promise.all([
      db.rpc('get_demo_request_by_token', { _token: input.data.token }),
      db.rpc('get_demo_available_slots', { _token: input.data.token }),
    ]);
    if (info.error || slots.error) throw info.error || slots.error;
    if (!info.data?.length) return reply({ error: 'This booking link is unavailable.' }, 404);
    return reply({ info: info.data[0], slots: slots.data.map((s: { slot: string }) => s.slot) });
  } catch (e) { return reply({ error: e instanceof Error ? e.message : 'Booking service unavailable' }, 400); }
});
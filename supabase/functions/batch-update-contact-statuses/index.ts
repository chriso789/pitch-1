import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ContactUpdate {
  first_name: string;
  last_name: string;
  address_street: string;
  qualification_status: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { updates, tenant_id } = await req.json() as {
      updates: ContactUpdate[];
      tenant_id: string;
    };

    if (!updates?.length || !tenant_id) {
      return json({ error: 'updates and tenant_id are required' }, 400);
    }

    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const u of updates) {
      try {
        if (!u.first_name || !u.last_name || !u.address_street) {
          skipped++;
          continue;
        }

        // Find contact by name + address in this tenant
        const { data: existing } = await supabase
          .from('contacts')
          .select('id, qualification_status')
          .eq('tenant_id', tenant_id)
          .ilike('first_name', u.first_name)
          .ilike('last_name', u.last_name)
          .ilike('address_street', `${u.address_street}%`)
          .limit(1);

        if (existing && existing.length > 0) {
          const record = existing[0];
          if (record.qualification_status !== u.qualification_status) {
            const { error: updateErr } = await supabase
              .from('contacts')
              .update({ qualification_status: u.qualification_status })
              .eq('id', record.id);
            if (updateErr) {
              errors.push(`${u.first_name} ${u.last_name}: ${updateErr.message}`);
            } else {
              updated++;
            }
          } else {
            skipped++;
          }
        } else {
          skipped++;
        }
      } catch (e) {
        errors.push(`${u.first_name} ${u.last_name}: ${String(e)}`);
      }
    }

    return json({ success: true, total: updates.length, updated, skipped, errors: errors.slice(0, 20) });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

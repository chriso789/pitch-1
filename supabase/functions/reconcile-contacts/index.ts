import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ContactPayload {
  first_name: string;
  last_name: string;
  address_street: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  phone?: string;
  notes?: string;
  assigned_to: string; // profile UUID
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { contacts, tenant_id, location_id } = await req.json() as {
      contacts: ContactPayload[];
      tenant_id: string;
      location_id: string;
    };

    if (!contacts?.length || !tenant_id || !location_id) {
      return json({ error: 'contacts, tenant_id, and location_id are required' }, 400);
    }

    let updated = 0;
    let inserted = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const c of contacts) {
      try {
        // Skip entries with no real name
        if (!c.first_name || !c.last_name || c.first_name.length < 2) {
          skipped++;
          continue;
        }

        // Try to find existing contact by name + address in this tenant
        const { data: existing } = await supabase
          .from('contacts')
          .select('id, assigned_to, location_id')
          .eq('tenant_id', tenant_id)
          .ilike('first_name', c.first_name)
          .ilike('last_name', c.last_name)
          .ilike('address_street', `${c.address_street}%`)
          .limit(1);

        if (existing && existing.length > 0) {
          // Update assigned_to and location_id if needed
          const record = existing[0];
          const needsUpdate = record.assigned_to !== c.assigned_to || record.location_id !== location_id;
          if (needsUpdate) {
            const { error: updateErr } = await supabase
              .from('contacts')
              .update({
                assigned_to: c.assigned_to,
                location_id: location_id,
              })
              .eq('id', record.id);
            if (updateErr) {
              errors.push(`Update ${c.first_name} ${c.last_name}: ${updateErr.message}`);
            } else {
              updated++;
            }
          } else {
            skipped++;
          }
        } else {
          // Also check by phone as secondary match
          let foundByPhone = false;
          if (c.phone && c.phone.length >= 10) {
            const cleanPhone = c.phone.replace(/\D/g, '').slice(-10);
            const { data: phoneMatch } = await supabase
              .from('contacts')
              .select('id, assigned_to, location_id')
              .eq('tenant_id', tenant_id)
              .or(`phone.ilike.%${cleanPhone},secondary_phone.ilike.%${cleanPhone}`)
              .limit(1);

            if (phoneMatch && phoneMatch.length > 0) {
              const record = phoneMatch[0];
              const needsUpdate = record.assigned_to !== c.assigned_to || record.location_id !== location_id;
              if (needsUpdate) {
                const { error: updateErr } = await supabase
                  .from('contacts')
                  .update({
                    assigned_to: c.assigned_to,
                    location_id: location_id,
                  })
                  .eq('id', record.id);
                if (updateErr) {
                  errors.push(`Update by phone ${c.first_name} ${c.last_name}: ${updateErr.message}`);
                } else {
                  updated++;
                }
              } else {
                skipped++;
              }
              foundByPhone = true;
            }
          }

          if (!foundByPhone) {
            // Insert new contact
            const { error: insertErr } = await supabase
              .from('contacts')
              .insert({
                tenant_id,
                location_id,
                first_name: c.first_name,
                last_name: c.last_name,
                address_street: c.address_street,
                address_city: c.address_city,
                address_state: c.address_state,
                address_zip: c.address_zip,
                phone: c.phone || null,
                notes: c.notes || null,
                assigned_to: c.assigned_to,
                lead_source: 'csv_import',
              });
            if (insertErr) {
              // If unique constraint violation, skip
              if (insertErr.message?.includes('duplicate') || insertErr.message?.includes('unique')) {
                skipped++;
              } else {
                errors.push(`Insert ${c.first_name} ${c.last_name} at ${c.address_street}: ${insertErr.message}`);
              }
            } else {
              inserted++;
            }
          }
        }
      } catch (e) {
        errors.push(`${c.first_name} ${c.last_name}: ${String(e)}`);
      }
    }

    return json({
      success: true,
      total: contacts.length,
      updated,
      inserted,
      skipped,
      errors: errors.slice(0, 20),
    });
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

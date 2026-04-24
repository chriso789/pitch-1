import { corsHeaders } from '../_shared/cors.ts';
import { telnyxFetch } from '../_shared/telnyx.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { ENV } from '../_shared/env.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user's tenant_id
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    if (!profile?.tenant_id) {
      return new Response(JSON.stringify({ error: 'No tenant found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const tenantId = profile.tenant_id;
    const body = await req.json();
    const { action } = body;

    let result;

    switch (action) {
      case 'register-brand': {
        const { company_name, ein, website, vertical, city, state, zip, street, entity_type, stock_exchange, stock_symbol, alt_business_id, alt_business_id_type } = body;

        const brandPayload: Record<string, unknown> = {
          entity_type: entity_type || 'PRIVATE_PROFIT',
          display_name: company_name,
          company_name: company_name,
          ein: ein,
          website: website,
          vertical: vertical || 'CONSTRUCTION',
          city: city,
          state: state,
          postal_code: zip,
          street: street,
          country: 'US',
          stock_exchange: stock_exchange || undefined,
          stock_symbol: stock_symbol || undefined,
          alt_business_id: alt_business_id || undefined,
          alt_business_id_type: alt_business_id_type || undefined,
        };

        // Remove undefined values
        Object.keys(brandPayload).forEach(key => {
          if (brandPayload[key] === undefined) delete brandPayload[key];
        });

        console.log('[10DLC] Registering brand:', JSON.stringify(brandPayload));
        const brandResponse = await telnyxFetch('/v2/10dlc/brands', {
          method: 'POST',
          body: JSON.stringify(brandPayload),
        });

        const brandData = brandResponse.data as Record<string, unknown>;

        // Upsert registration record
        const adminClient = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY);
        await adminClient.from('ten_dlc_registrations').upsert({
          tenant_id: tenantId,
          brand_id: brandData.brandId || brandData.id,
          brand_status: 'pending',
          brand_payload: brandPayload,
          telnyx_brand_response: brandData,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'tenant_id' });

        result = { success: true, brand: brandData };
        break;
      }

      case 'create-campaign': {
        const { brand_id, use_case, description, sample_messages, message_flow } = body;

        const campaignPayload: Record<string, unknown> = {
          brandId: brand_id,
          usecase: use_case || 'MIXED',
          description: description || 'CRM-initiated customer communications including appointment reminders, status updates, and marketing.',
          sample1: sample_messages?.[0] || 'Hi {{first_name}}, your roofing appointment is confirmed for tomorrow at 10am. Reply STOP to opt out.',
          sample2: sample_messages?.[1] || 'Great news {{first_name}}! Your project estimate is ready. View it here: {{link}}. Reply STOP to opt out.',
          messageFlow: message_flow || 'Customers opt in by providing their phone number during consultation or via our website contact form. They receive appointment reminders, project updates, and occasional promotional offers.',
          numberPool: false,
          ageGated: false,
          directLending: false,
          subscriberOptin: true,
          subscriberOptout: true,
          subscriberHelp: true,
          embeddedLink: true,
          embeddedPhone: false,
          affiliateMarketing: false,
          autoRenewal: false,
        };

        console.log('[10DLC] Creating campaign:', JSON.stringify(campaignPayload));
        const campaignResponse = await telnyxFetch('/v2/10dlc/campaigns', {
          method: 'POST',
          body: JSON.stringify(campaignPayload),
        });

        const campaignData = campaignResponse.data as Record<string, unknown>;

        const adminClient = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY);
        await adminClient.from('ten_dlc_registrations').update({
          campaign_id: campaignData.campaignId || campaignData.id,
          campaign_status: 'pending',
          campaign_payload: campaignPayload,
          telnyx_campaign_response: campaignData,
          updated_at: new Date().toISOString(),
        }).eq('tenant_id', tenantId);

        result = { success: true, campaign: campaignData };
        break;
      }

      case 'assign-number': {
        const { campaign_id, phone_number } = body;

        console.log(`[10DLC] Assigning number ${phone_number} to campaign ${campaign_id}`);
        const assignResponse = await telnyxFetch('/v2/10dlc/campaignNumberAssignments', {
          method: 'POST',
          body: JSON.stringify({
            campaignId: campaign_id,
            phoneNumber: phone_number,
          }),
        });

        // Update assigned_numbers array
        const adminClient = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY);
        const { data: reg } = await adminClient
          .from('ten_dlc_registrations')
          .select('assigned_numbers')
          .eq('tenant_id', tenantId)
          .single();

        const currentNumbers = reg?.assigned_numbers || [];
        if (!currentNumbers.includes(phone_number)) {
          currentNumbers.push(phone_number);
        }

        await adminClient.from('ten_dlc_registrations').update({
          assigned_numbers: currentNumbers,
          updated_at: new Date().toISOString(),
        }).eq('tenant_id', tenantId);

        result = { success: true, assignment: assignResponse.data };
        break;
      }

      case 'check-status': {
        const { brand_id, campaign_id } = body;
        const statusResult: Record<string, unknown> = {};

        if (brand_id) {
          const brandRes = await telnyxFetch(`/v2/10dlc/brands/${brand_id}`);
          statusResult.brand = brandRes.data;

          const brandData = brandRes.data as Record<string, unknown>;
          const adminClient = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY);
          await adminClient.from('ten_dlc_registrations').update({
            brand_status: (brandData.status as string)?.toLowerCase() || 'pending',
            telnyx_brand_response: brandData,
            updated_at: new Date().toISOString(),
          }).eq('tenant_id', tenantId);
        }

        if (campaign_id) {
          const campaignRes = await telnyxFetch(`/v2/10dlc/campaigns/${campaign_id}`);
          statusResult.campaign = campaignRes.data;

          const campaignData = campaignRes.data as Record<string, unknown>;
          const adminClient = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY);
          await adminClient.from('ten_dlc_registrations').update({
            campaign_status: (campaignData.status as string)?.toLowerCase() || 'pending',
            telnyx_campaign_response: campaignData,
            updated_at: new Date().toISOString(),
          }).eq('tenant_id', tenantId);
        }

        result = { success: true, status: statusResult };
        break;
      }

      case 'get-registration': {
        const { data: registration } = await supabase
          .from('ten_dlc_registrations')
          .select('*')
          .eq('tenant_id', tenantId)
          .maybeSingle();

        result = { success: true, registration };
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[10DLC] Error:', error);
    return new Response(JSON.stringify({ error: (error instanceof Error ? error.message : String(error)) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

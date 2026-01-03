import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ClaimRequest {
  action: 'create' | 'update' | 'get' | 'list' | 'add_note' | 'schedule_followup' | 'get_analytics';
  tenant_id: string;
  claim_id?: string;
  project_id?: string;
  data?: {
    claim_number?: string;
    carrier?: string;
    adjuster_name?: string;
    adjuster_phone?: string;
    adjuster_email?: string;
    status?: string;
    damage_date?: string;
    inspection_date?: string;
    notes?: string;
  };
  followup_date?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: ClaimRequest = await req.json();
    const { action, tenant_id, claim_id, project_id, data, followup_date } = body;

    if (!action || !tenant_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing action or tenant_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // Get user from auth
    const authHeader = req.headers.get('authorization');
    let userId: string | null = null;
    if (authHeader) {
      const { data: { user } } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
      userId = user?.id ?? null;
    }

    switch (action) {
      case 'create': {
        if (!project_id || !data?.claim_number) {
          return new Response(
            JSON.stringify({ success: false, error: 'project_id and claim_number required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: claim, error } = await supabaseAdmin
          .from('insurance_claims')
          .insert({
            tenant_id,
            project_id,
            claim_number: data.claim_number,
            carrier: data.carrier,
            adjuster_name: data.adjuster_name,
            adjuster_phone: data.adjuster_phone,
            adjuster_email: data.adjuster_email,
            status: 'filed',
            damage_date: data.damage_date,
            created_by: userId
          })
          .select()
          .single();

        if (error) {
          console.error('[insurance-claim-tracker] Create error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to create claim' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[insurance-claim-tracker] Created claim ${claim.id}`);
        return new Response(
          JSON.stringify({ success: true, data: claim }),
          { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'update': {
        if (!claim_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'claim_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: claim, error } = await supabaseAdmin
          .from('insurance_claims')
          .update({
            ...data,
            updated_at: new Date().toISOString()
          })
          .eq('id', claim_id)
          .eq('tenant_id', tenant_id)
          .select()
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to update claim' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, data: claim }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get': {
        if (!claim_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'claim_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: claim, error } = await supabaseAdmin
          .from('insurance_claims')
          .select(`
            *,
            project:project_id(id, name, address),
            insurance_supplements(*),
            insurance_claim_notes(*)
          `)
          .eq('id', claim_id)
          .eq('tenant_id', tenant_id)
          .single();

        if (error || !claim) {
          return new Response(
            JSON.stringify({ success: false, error: 'Claim not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, data: claim }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'list': {
        let query = supabaseAdmin
          .from('insurance_claims')
          .select(`
            id, claim_number, carrier, status, created_at, next_followup_date,
            project:project_id(id, name, address)
          `)
          .eq('tenant_id', tenant_id)
          .order('created_at', { ascending: false });

        if (data?.status) {
          query = query.eq('status', data.status);
        }

        const { data: claims, error } = await query;

        if (error) {
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to list claims' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, data: claims }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'add_note': {
        if (!claim_id || !data?.notes) {
          return new Response(
            JSON.stringify({ success: false, error: 'claim_id and notes required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: note, error } = await supabaseAdmin
          .from('insurance_claim_notes')
          .insert({
            tenant_id,
            claim_id,
            content: data.notes,
            created_by: userId
          })
          .select()
          .single();

        if (error) {
          console.error('[insurance-claim-tracker] Add note error:', error);
          // Try adding to claim metadata instead
          const { data: claim } = await supabaseAdmin
            .from('insurance_claims')
            .select('notes')
            .eq('id', claim_id)
            .single();

          const existingNotes = claim?.notes || [];
          await supabaseAdmin
            .from('insurance_claims')
            .update({
              notes: [...existingNotes, { content: data.notes, created_at: new Date().toISOString(), created_by: userId }]
            })
            .eq('id', claim_id);
        }

        return new Response(
          JSON.stringify({ success: true, data: note }),
          { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'schedule_followup': {
        if (!claim_id || !followup_date) {
          return new Response(
            JSON.stringify({ success: false, error: 'claim_id and followup_date required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: claim, error } = await supabaseAdmin
          .from('insurance_claims')
          .update({
            next_followup_date: followup_date,
            updated_at: new Date().toISOString()
          })
          .eq('id', claim_id)
          .eq('tenant_id', tenant_id)
          .select()
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to schedule followup' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Create task for followup
        await supabaseAdmin
          .from('tasks')
          .insert({
            tenant_id,
            title: `Follow up on claim ${claim.claim_number}`,
            description: `Insurance claim followup with ${claim.carrier}`,
            due_date: followup_date,
            assigned_to: userId,
            related_type: 'insurance_claim',
            related_id: claim_id
          });

        return new Response(
          JSON.stringify({ success: true, data: claim }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_analytics': {
        // Get claim analytics for the tenant
        const { data: claims } = await supabaseAdmin
          .from('insurance_claims')
          .select('status, carrier, created_at, approved_amount, supplement_amount')
          .eq('tenant_id', tenant_id);

        const statusCounts: Record<string, number> = {};
        const carrierCounts: Record<string, number> = {};
        let totalApproved = 0;
        let totalSupplement = 0;

        claims?.forEach(claim => {
          statusCounts[claim.status] = (statusCounts[claim.status] || 0) + 1;
          if (claim.carrier) {
            carrierCounts[claim.carrier] = (carrierCounts[claim.carrier] || 0) + 1;
          }
          totalApproved += claim.approved_amount || 0;
          totalSupplement += claim.supplement_amount || 0;
        });

        const analytics = {
          total_claims: claims?.length || 0,
          by_status: statusCounts,
          by_carrier: carrierCounts,
          total_approved: totalApproved,
          total_supplement: totalSupplement,
          avg_approved: claims?.length ? totalApproved / claims.length : 0,
          supplement_success_rate: claims?.length 
            ? claims.filter(c => c.supplement_amount && c.supplement_amount > 0).length / claims.length 
            : 0
        };

        return new Response(
          JSON.stringify({ success: true, data: analytics }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

  } catch (error) {
    console.error('[insurance-claim-tracker] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

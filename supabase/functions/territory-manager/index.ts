import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TerritoryRequest {
  action: 'create' | 'update' | 'delete' | 'list' | 'assign' | 'get';
  territory_id?: string;
  tenant_id: string;
  data?: {
    name?: string;
    description?: string;
    boundary_geojson?: Record<string, unknown>;
    assigned_to?: string;
    color?: string;
    active?: boolean;
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: TerritoryRequest = await req.json();
    const { action, territory_id, tenant_id, data } = body;

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

    // Get user from auth header
    const authHeader = req.headers.get('authorization');
    let userId: string | null = null;
    if (authHeader) {
      const { data: { user } } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
      userId = user?.id ?? null;
    }

    switch (action) {
      case 'create': {
        if (!data?.name || !data?.boundary_geojson) {
          return new Response(
            JSON.stringify({ success: false, error: 'Name and boundary_geojson required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: territory, error } = await supabaseAdmin
          .from('territories')
          .insert({
            tenant_id,
            name: data.name,
            description: data.description,
            boundary_geojson: data.boundary_geojson,
            assigned_to: data.assigned_to,
            color: data.color || '#3b82f6',
            active: data.active ?? true,
            created_by: userId
          })
          .select()
          .single();

        if (error) {
          console.error('[territory-manager] Create error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to create territory' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[territory-manager] Created territory: ${territory.id}`);
        return new Response(
          JSON.stringify({ success: true, data: territory }),
          { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'update': {
        if (!territory_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'territory_id required for update' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (data?.name) updateData.name = data.name;
        if (data?.description !== undefined) updateData.description = data.description;
        if (data?.boundary_geojson) updateData.boundary_geojson = data.boundary_geojson;
        if (data?.assigned_to !== undefined) updateData.assigned_to = data.assigned_to;
        if (data?.color) updateData.color = data.color;
        if (data?.active !== undefined) updateData.active = data.active;

        const { data: territory, error } = await supabaseAdmin
          .from('territories')
          .update(updateData)
          .eq('id', territory_id)
          .eq('tenant_id', tenant_id)
          .select()
          .single();

        if (error) {
          console.error('[territory-manager] Update error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to update territory' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[territory-manager] Updated territory: ${territory_id}`);
        return new Response(
          JSON.stringify({ success: true, data: territory }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'delete': {
        if (!territory_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'territory_id required for delete' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { error } = await supabaseAdmin
          .from('territories')
          .delete()
          .eq('id', territory_id)
          .eq('tenant_id', tenant_id);

        if (error) {
          console.error('[territory-manager] Delete error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to delete territory' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[territory-manager] Deleted territory: ${territory_id}`);
        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'list': {
        const { data: territories, error } = await supabaseAdmin
          .from('territories')
          .select('*, profiles:assigned_to(id, full_name, email)')
          .eq('tenant_id', tenant_id)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('[territory-manager] List error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to list territories' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, data: territories }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get': {
        if (!territory_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'territory_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: territory, error } = await supabaseAdmin
          .from('territories')
          .select('*, profiles:assigned_to(id, full_name, email)')
          .eq('id', territory_id)
          .eq('tenant_id', tenant_id)
          .single();

        if (error) {
          console.error('[territory-manager] Get error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Territory not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, data: territory }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'assign': {
        if (!territory_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'territory_id required for assign' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: territory, error } = await supabaseAdmin
          .from('territories')
          .update({ 
            assigned_to: data?.assigned_to || null,
            updated_at: new Date().toISOString()
          })
          .eq('id', territory_id)
          .eq('tenant_id', tenant_id)
          .select()
          .single();

        if (error) {
          console.error('[territory-manager] Assign error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to assign territory' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[territory-manager] Assigned territory ${territory_id} to ${data?.assigned_to}`);
        return new Response(
          JSON.stringify({ success: true, data: territory }),
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
    console.error('[territory-manager] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

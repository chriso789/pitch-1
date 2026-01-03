import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { action, ...data } = await req.json();
    console.log(`[fleet-manager] Action: ${action}`, data);

    switch (action) {
      case 'create_vehicle': {
        const { tenant_id, vin, make, model, year, license_plate, vehicle_type, assigned_to } = data;
        
        const { data: vehicle, error } = await supabase
          .from('fleet_vehicles')
          .insert({
            tenant_id,
            vin,
            make,
            model,
            year,
            license_plate,
            vehicle_type: vehicle_type || 'truck',
            assigned_to,
            status: 'active'
          })
          .select()
          .single();

        if (error) throw error;
        console.log(`[fleet-manager] Created vehicle: ${vin}`);
        return new Response(JSON.stringify({ success: true, vehicle }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'update_vehicle': {
        const { vehicle_id, ...updates } = data;
        
        const { data: vehicle, error } = await supabase
          .from('fleet_vehicles')
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq('id', vehicle_id)
          .select()
          .single();

        if (error) throw error;
        return new Response(JSON.stringify({ success: true, vehicle }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'log_fuel': {
        const { tenant_id, vehicle_id, gallons, cost, odometer, location } = data;
        
        const { data: fuelLog, error } = await supabase
          .from('fleet_fuel_logs')
          .insert({
            tenant_id,
            vehicle_id,
            gallons,
            cost,
            odometer,
            location,
            filled_at: new Date().toISOString()
          })
          .select()
          .single();

        if (error) throw error;

        // Update vehicle odometer
        await supabase
          .from('fleet_vehicles')
          .update({ current_odometer: odometer })
          .eq('id', vehicle_id);

        console.log(`[fleet-manager] Logged fuel for vehicle: ${vehicle_id}`);
        return new Response(JSON.stringify({ success: true, fuelLog }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'get_fleet_summary': {
        const { tenant_id } = data;
        
        const { data: vehicles } = await supabase
          .from('fleet_vehicles')
          .select('*')
          .eq('tenant_id', tenant_id)
          .eq('status', 'active');

        const { data: maintenanceDue } = await supabase
          .from('fleet_maintenance_logs')
          .select('vehicle_id')
          .eq('tenant_id', tenant_id)
          .eq('status', 'scheduled')
          .lte('scheduled_date', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());

        const summary = {
          totalVehicles: vehicles?.length || 0,
          maintenanceDue: maintenanceDue?.length || 0,
          activeVehicles: vehicles?.filter(v => v.status === 'active').length || 0
        };

        return new Response(JSON.stringify({ success: true, summary, vehicles }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'assign_to_crew': {
        const { vehicle_id, user_id } = data;
        
        const { data: vehicle, error } = await supabase
          .from('fleet_vehicles')
          .update({ assigned_to: user_id, updated_at: new Date().toISOString() })
          .eq('id', vehicle_id)
          .select()
          .single();

        if (error) throw error;
        console.log(`[fleet-manager] Assigned vehicle ${vehicle_id} to user ${user_id}`);
        return new Response(JSON.stringify({ success: true, vehicle }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error: any) {
    console.error('[fleet-manager] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

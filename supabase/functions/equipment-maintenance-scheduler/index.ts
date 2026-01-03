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
    console.log(`[equipment-maintenance-scheduler] Action: ${action}`, data);

    switch (action) {
      case 'schedule_maintenance': {
        const { tenant_id, vehicle_id, service_type, scheduled_date, estimated_cost, notes } = data;
        
        const { data: maintenance, error } = await supabase
          .from('fleet_maintenance_logs')
          .insert({
            tenant_id,
            vehicle_id,
            service_type,
            scheduled_date,
            estimated_cost,
            notes,
            status: 'scheduled'
          })
          .select()
          .single();

        if (error) throw error;
        console.log(`[equipment-maintenance-scheduler] Scheduled maintenance: ${maintenance.id}`);
        return new Response(JSON.stringify({ success: true, maintenance }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'complete_maintenance': {
        const { maintenance_id, actual_cost, technician_notes, parts_used } = data;
        
        const { data: maintenance, error } = await supabase
          .from('fleet_maintenance_logs')
          .update({
            status: 'completed',
            actual_cost,
            technician_notes,
            parts_used,
            completed_at: new Date().toISOString()
          })
          .eq('id', maintenance_id)
          .select()
          .single();

        if (error) throw error;
        console.log(`[equipment-maintenance-scheduler] Completed maintenance: ${maintenance_id}`);
        return new Response(JSON.stringify({ success: true, maintenance }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'auto_schedule': {
        const { tenant_id } = data;
        
        // Get vehicles that need scheduled maintenance
        const { data: vehicles } = await supabase
          .from('fleet_vehicles')
          .select('*')
          .eq('tenant_id', tenant_id)
          .eq('status', 'active');

        const scheduled = [];
        for (const vehicle of vehicles || []) {
          // Check last oil change
          const { data: lastOilChange } = await supabase
            .from('fleet_maintenance_logs')
            .select('*')
            .eq('vehicle_id', vehicle.id)
            .eq('service_type', 'oil_change')
            .eq('status', 'completed')
            .order('completed_at', { ascending: false })
            .limit(1)
            .single();

          const daysSinceLastOilChange = lastOilChange 
            ? Math.floor((Date.now() - new Date(lastOilChange.completed_at).getTime()) / (1000 * 60 * 60 * 24))
            : 999;

          // Schedule oil change every 90 days
          if (daysSinceLastOilChange > 90) {
            const nextDate = new Date();
            nextDate.setDate(nextDate.getDate() + 7);
            
            const { data: newMaintenance } = await supabase
              .from('fleet_maintenance_logs')
              .insert({
                tenant_id,
                vehicle_id: vehicle.id,
                service_type: 'oil_change',
                scheduled_date: nextDate.toISOString(),
                status: 'scheduled',
                notes: 'Auto-scheduled preventive maintenance'
              })
              .select()
              .single();

            if (newMaintenance) scheduled.push(newMaintenance);
          }
        }

        console.log(`[equipment-maintenance-scheduler] Auto-scheduled ${scheduled.length} maintenance tasks`);
        return new Response(JSON.stringify({ success: true, scheduled: scheduled.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'get_upcoming': {
        const { tenant_id, days = 30 } = data;
        
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + days);

        const { data: upcoming, error } = await supabase
          .from('fleet_maintenance_logs')
          .select('*, fleet_vehicles(*)')
          .eq('tenant_id', tenant_id)
          .eq('status', 'scheduled')
          .lte('scheduled_date', futureDate.toISOString())
          .order('scheduled_date', { ascending: true });

        if (error) throw error;
        return new Response(JSON.stringify({ success: true, upcoming }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error: any) {
    console.error('[equipment-maintenance-scheduler] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

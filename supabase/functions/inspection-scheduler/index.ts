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
    console.log(`[inspection-scheduler] Action: ${action}`, data);

    switch (action) {
      case 'schedule_inspection': {
        const { tenant_id, permit_id, inspection_type, preferred_date, notes } = data;
        
        const { data: inspection, error } = await supabase
          .from('permit_inspections')
          .insert({
            tenant_id,
            permit_id,
            inspection_type,
            scheduled_date: preferred_date,
            status: 'scheduled',
            notes
          })
          .select()
          .single();

        if (error) throw error;

        console.log(`[inspection-scheduler] Scheduled ${inspection_type} inspection for ${preferred_date}`);
        return new Response(JSON.stringify({ success: true, inspection }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'auto_schedule_on_stage': {
        const { tenant_id, job_id, stage } = data;
        
        // Define which inspections to schedule based on job stage
        const stageInspections: Record<string, string[]> = {
          'materials_delivered': ['initial'],
          'tear_off_complete': ['progress'],
          'installation_complete': ['final']
        };

        const inspectionsToSchedule = stageInspections[stage] || [];
        const scheduled = [];

        // Get the permit for this job
        const { data: permit } = await supabase
          .from('permit_applications')
          .select('*')
          .eq('job_id', job_id)
          .eq('status', 'approved')
          .single();

        if (permit) {
          for (const inspType of inspectionsToSchedule) {
            const scheduledDate = new Date();
            scheduledDate.setDate(scheduledDate.getDate() + 2); // 2 days from now

            const { data: inspection } = await supabase
              .from('permit_inspections')
              .insert({
                tenant_id,
                permit_id: permit.id,
                inspection_type: inspType,
                scheduled_date: scheduledDate.toISOString(),
                status: 'scheduled'
              })
              .select()
              .single();

            if (inspection) scheduled.push(inspection);
          }
        }

        console.log(`[inspection-scheduler] Auto-scheduled ${scheduled.length} inspections for stage: ${stage}`);
        return new Response(JSON.stringify({ success: true, scheduled }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'record_result': {
        const { inspection_id, result, inspector_name, notes, photos } = data;
        
        const { data: inspection, error } = await supabase
          .from('permit_inspections')
          .update({
            result, // 'passed', 'failed', 'partial'
            inspector_name,
            notes,
            photos,
            completed_at: new Date().toISOString(),
            status: 'completed'
          })
          .eq('id', inspection_id)
          .select()
          .single();

        if (error) throw error;

        // If failed, auto-schedule re-inspection
        if (result === 'failed') {
          const reInspectDate = new Date();
          reInspectDate.setDate(reInspectDate.getDate() + 3);

          await supabase
            .from('permit_inspections')
            .insert({
              tenant_id: inspection.tenant_id,
              permit_id: inspection.permit_id,
              inspection_type: `re-${inspection.inspection_type}`,
              scheduled_date: reInspectDate.toISOString(),
              status: 'scheduled',
              notes: `Re-inspection required. Previous issues: ${notes}`
            });

          console.log(`[inspection-scheduler] Scheduled re-inspection due to failure`);
        }

        return new Response(JSON.stringify({ success: true, inspection }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'get_upcoming': {
        const { tenant_id, days = 7 } = data;
        
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + days);

        const { data: inspections, error } = await supabase
          .from('permit_inspections')
          .select('*, permit_applications(*, jobs(*, contacts(*)))')
          .eq('tenant_id', tenant_id)
          .eq('status', 'scheduled')
          .lte('scheduled_date', futureDate.toISOString())
          .order('scheduled_date', { ascending: true });

        if (error) throw error;
        return new Response(JSON.stringify({ success: true, inspections }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'reschedule': {
        const { inspection_id, new_date, reason } = data;
        
        const { data: inspection, error } = await supabase
          .from('permit_inspections')
          .update({
            scheduled_date: new_date,
            notes: `Rescheduled: ${reason}`,
            updated_at: new Date().toISOString()
          })
          .eq('id', inspection_id)
          .select()
          .single();

        if (error) throw error;

        console.log(`[inspection-scheduler] Rescheduled inspection ${inspection_id} to ${new_date}`);
        return new Response(JSON.stringify({ success: true, inspection }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error: any) {
    console.error('[inspection-scheduler] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

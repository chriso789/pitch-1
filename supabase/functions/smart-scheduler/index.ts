import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SchedulerRequest {
  action: 'get_slots' | 'book' | 'reschedule' | 'cancel' | 'get_availability';
  tenant_id: string;
  user_id?: string;
  contact_id?: string;
  appointment_type?: string;
  date?: string;
  slot?: { start: string; end: string };
  appointment_id?: string;
  preferences?: {
    preferred_times?: string[];
    avoid_times?: string[];
    duration_minutes?: number;
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: SchedulerRequest = await req.json();
    const { action, tenant_id, user_id, contact_id, appointment_type, date, slot, appointment_id, preferences } = body;

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

    switch (action) {
      case 'get_slots': {
        const targetDate = date || new Date().toISOString().split('T')[0];
        const duration = preferences?.duration_minutes || 60;

        // Get user's existing appointments for the day
        const dayStart = `${targetDate}T00:00:00Z`;
        const dayEnd = `${targetDate}T23:59:59Z`;

        let query = supabaseAdmin
          .from('appointments')
          .select('scheduled_start, scheduled_end, assigned_to')
          .eq('tenant_id', tenant_id)
          .gte('scheduled_start', dayStart)
          .lte('scheduled_start', dayEnd)
          .neq('status', 'cancelled');

        if (user_id) {
          query = query.eq('assigned_to', user_id);
        }

        const { data: existingAppts } = await query;

        // Generate available slots (9 AM to 5 PM)
        const slots: Array<{ start: string; end: string; available: boolean; score?: number }> = [];
        const startHour = 9;
        const endHour = 17;
        const slotDuration = duration / 60; // Convert to hours

        for (let hour = startHour; hour < endHour; hour += slotDuration) {
          const slotStart = new Date(`${targetDate}T${String(Math.floor(hour)).padStart(2, '0')}:${String((hour % 1) * 60).padStart(2, '0')}:00Z`);
          const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);

          // Check if slot conflicts with existing appointments
          const isAvailable = !existingAppts?.some(appt => {
            const apptStart = new Date(appt.scheduled_start);
            const apptEnd = new Date(appt.scheduled_end);
            return (slotStart < apptEnd && slotEnd > apptStart);
          });

          // Calculate slot score based on preferences
          let score = isAvailable ? 1 : 0;
          if (preferences?.preferred_times?.includes(`${Math.floor(hour)}:00`)) {
            score += 0.5;
          }
          if (preferences?.avoid_times?.includes(`${Math.floor(hour)}:00`)) {
            score -= 0.5;
          }

          slots.push({
            start: slotStart.toISOString(),
            end: slotEnd.toISOString(),
            available: isAvailable,
            score
          });
        }

        // Sort by score (best slots first)
        slots.sort((a, b) => (b.score || 0) - (a.score || 0));

        return new Response(
          JSON.stringify({ success: true, data: { date: targetDate, slots } }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'book': {
        if (!slot || !contact_id || !appointment_type) {
          return new Response(
            JSON.stringify({ success: false, error: 'slot, contact_id, and appointment_type required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get contact info
        const { data: contact } = await supabaseAdmin
          .from('contacts')
          .select('first_name, last_name, address')
          .eq('id', contact_id)
          .single();

        // Create appointment
        const { data: appointment, error } = await supabaseAdmin
          .from('appointments')
          .insert({
            tenant_id,
            contact_id,
            assigned_to: user_id,
            appointment_type,
            title: `${appointment_type} - ${contact?.first_name || ''} ${contact?.last_name || ''}`,
            scheduled_start: slot.start,
            scheduled_end: slot.end,
            address: contact?.address,
            status: 'scheduled',
            ai_suggested: true
          })
          .select()
          .single();

        if (error) {
          console.error('[smart-scheduler] Book error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to book appointment' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[smart-scheduler] Booked appointment: ${appointment.id}`);
        return new Response(
          JSON.stringify({ success: true, data: appointment }),
          { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'reschedule': {
        if (!appointment_id || !slot) {
          return new Response(
            JSON.stringify({ success: false, error: 'appointment_id and slot required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: appointment, error } = await supabaseAdmin
          .from('appointments')
          .update({
            scheduled_start: slot.start,
            scheduled_end: slot.end,
            status: 'rescheduled',
            updated_at: new Date().toISOString()
          })
          .eq('id', appointment_id)
          .eq('tenant_id', tenant_id)
          .select()
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to reschedule' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[smart-scheduler] Rescheduled appointment: ${appointment_id}`);
        return new Response(
          JSON.stringify({ success: true, data: appointment }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'cancel': {
        if (!appointment_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'appointment_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { error } = await supabaseAdmin
          .from('appointments')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('id', appointment_id)
          .eq('tenant_id', tenant_id);

        if (error) {
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to cancel' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_availability': {
        // Get availability for next 7 days
        const availability: Record<string, { available_slots: number; total_slots: number }> = {};
        
        for (let i = 0; i < 7; i++) {
          const checkDate = new Date();
          checkDate.setDate(checkDate.getDate() + i);
          const dateStr = checkDate.toISOString().split('T')[0];
          
          const dayStart = `${dateStr}T00:00:00Z`;
          const dayEnd = `${dateStr}T23:59:59Z`;

          const { count } = await supabaseAdmin
            .from('appointments')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', tenant_id)
            .gte('scheduled_start', dayStart)
            .lte('scheduled_start', dayEnd)
            .neq('status', 'cancelled');

          const totalSlots = 8; // 9 AM to 5 PM, 1-hour slots
          availability[dateStr] = {
            available_slots: Math.max(0, totalSlots - (count || 0)),
            total_slots: totalSlots
          };
        }

        return new Response(
          JSON.stringify({ success: true, data: availability }),
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
    console.error('[smart-scheduler] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

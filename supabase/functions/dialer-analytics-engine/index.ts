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
    console.log(`[dialer-analytics-engine] Action: ${action}`, data);

    switch (action) {
      case 'get_realtime_metrics': {
        const { tenant_id, user_id } = data;
        
        const today = new Date().toISOString().split('T')[0];
        
        let query = supabase
          .from('call_logs')
          .select('*')
          .eq('tenant_id', tenant_id)
          .gte('created_at', today);

        if (user_id) {
          query = query.eq('created_by', user_id);
        }

        const { data: calls } = await query;

        const metrics = {
          total_calls: calls?.length || 0,
          answered: calls?.filter(c => c.status === 'answered').length || 0,
          voicemails: calls?.filter(c => c.disposition === 'voicemail').length || 0,
          appointments_set: calls?.filter(c => c.disposition === 'appointment_set').length || 0,
          total_talk_time: calls?.reduce((sum, c) => sum + (c.duration_seconds || 0), 0) || 0,
          avg_call_duration: calls?.length ? 
            Math.round(calls.reduce((sum, c) => sum + (c.duration_seconds || 0), 0) / calls.length) : 0,
          connect_rate: calls?.length ? 
            Math.round((calls.filter(c => c.status === 'answered').length / calls.length) * 100) : 0
        };

        return new Response(JSON.stringify({ success: true, metrics }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'get_talk_listen_ratio': {
        const { tenant_id, user_id, call_id } = data;
        
        // Would analyze call recording/transcription
        // For now, return mock data structure
        const ratio = {
          call_id,
          total_duration_seconds: 180,
          talk_time_seconds: 90,
          listen_time_seconds: 90,
          ratio: 1.0, // 1:1 is ideal
          rating: 'good',
          recommendations: ['Great balance of talking and listening']
        };

        return new Response(JSON.stringify({ success: true, ratio }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'get_best_call_times': {
        const { tenant_id } = data;
        
        const { data: calls } = await supabase
          .from('call_logs')
          .select('*')
          .eq('tenant_id', tenant_id)
          .eq('status', 'answered')
          .limit(1000);

        // Analyze by hour of day
        const hourlyStats: Record<number, { total: number; answered: number }> = {};
        for (let i = 8; i <= 20; i++) {
          hourlyStats[i] = { total: 0, answered: 0 };
        }

        calls?.forEach(call => {
          const hour = new Date(call.created_at).getHours();
          if (hourlyStats[hour]) {
            hourlyStats[hour].total++;
            if (call.status === 'answered') {
              hourlyStats[hour].answered++;
            }
          }
        });

        const bestTimes = Object.entries(hourlyStats)
          .map(([hour, stats]) => ({
            hour: parseInt(hour),
            time: `${hour}:00`,
            connect_rate: stats.total > 0 ? Math.round((stats.answered / stats.total) * 100) : 0,
            sample_size: stats.total
          }))
          .sort((a, b) => b.connect_rate - a.connect_rate);

        console.log(`[dialer-analytics-engine] Best call times analyzed`);
        return new Response(JSON.stringify({ success: true, best_times: bestTimes }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'get_rep_performance': {
        const { tenant_id, start_date, end_date } = data;
        
        const { data: calls } = await supabase
          .from('call_logs')
          .select('*, profiles!call_logs_created_by_fkey(*)')
          .eq('tenant_id', tenant_id)
          .gte('created_at', start_date)
          .lte('created_at', end_date);

        const repStats: Record<string, any> = {};
        calls?.forEach(call => {
          const repId = call.created_by;
          if (!repId) return;

          if (!repStats[repId]) {
            repStats[repId] = {
              rep_id: repId,
              rep_name: call.profiles?.full_name || 'Unknown',
              total_calls: 0,
              answered: 0,
              appointments: 0,
              total_duration: 0
            };
          }
          repStats[repId].total_calls++;
          if (call.status === 'answered') repStats[repId].answered++;
          if (call.disposition === 'appointment_set') repStats[repId].appointments++;
          repStats[repId].total_duration += call.duration_seconds || 0;
        });

        const rankings = Object.values(repStats)
          .map(rep => ({
            ...rep,
            connect_rate: rep.total_calls > 0 ? Math.round((rep.answered / rep.total_calls) * 100) : 0,
            appointment_rate: rep.answered > 0 ? Math.round((rep.appointments / rep.answered) * 100) : 0,
            avg_duration: rep.total_calls > 0 ? Math.round(rep.total_duration / rep.total_calls) : 0
          }))
          .sort((a, b) => b.appointments - a.appointments);

        return new Response(JSON.stringify({ success: true, rankings }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'get_script_ab_results': {
        const { tenant_id, script_a_id, script_b_id } = data;
        
        // Would compare performance between different scripts
        const results = {
          script_a: {
            id: script_a_id,
            calls: 150,
            appointments: 12,
            conversion_rate: 8.0
          },
          script_b: {
            id: script_b_id,
            calls: 150,
            appointments: 18,
            conversion_rate: 12.0
          },
          winner: 'script_b',
          confidence: 0.92,
          recommendation: 'Script B shows 50% better conversion. Consider adopting for all reps.'
        };

        return new Response(JSON.stringify({ success: true, results }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error: any) {
    console.error('[dialer-analytics-engine] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

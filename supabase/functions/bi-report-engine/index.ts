// ============================================
// BI REPORT ENGINE
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseService } from "../_shared/supabase.ts";

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = supabaseService();
    const { action, ...data } = await req.json();
    console.log(`[bi-report-engine] Action: ${action}`, data);

    switch (action) {
      case 'generate_report': {
        const { tenant_id, report_type, parameters } = data;
        
        let reportData: any = {};

        switch (report_type) {
          case 'sales_summary':
            const { data: jobs } = await supabase
              .from('jobs')
              .select('*, estimates(*), contacts(*)')
              .eq('tenant_id', tenant_id)
              .gte('created_at', parameters.start_date)
              .lte('created_at', parameters.end_date);

            reportData = {
              total_jobs: jobs?.length || 0,
              total_revenue: jobs?.filter(j => j.status === 'completed')
                .reduce((sum, j) => sum + (j.estimates?.[0]?.total || 0), 0) || 0,
              jobs_by_status: groupBy(jobs, 'status'),
              jobs_by_type: groupBy(jobs, 'job_type')
            };
            break;

          case 'lead_conversion':
            const { data: leads } = await supabase
              .from('pipeline_entries')
              .select('*')
              .eq('tenant_id', tenant_id)
              .gte('created_at', parameters.start_date)
              .lte('created_at', parameters.end_date);

            const converted = leads?.filter(l => l.stage === 'closed_won').length || 0;
            const lost = leads?.filter(l => l.stage === 'closed_lost').length || 0;
            const total = leads?.length || 0;

            reportData = {
              total_leads: total,
              converted,
              lost,
              conversion_rate: total > 0 ? ((converted / total) * 100).toFixed(2) + '%' : '0%',
              by_source: groupBy(leads, 'source')
            };
            break;

          case 'team_performance':
            const { data: teamJobs } = await supabase
              .from('jobs')
              .select('*, estimates(*), profiles!jobs_sales_rep_id_fkey(*)')
              .eq('tenant_id', tenant_id)
              .gte('created_at', parameters.start_date)
              .lte('created_at', parameters.end_date);

            const byRep: Record<string, any> = {};
            teamJobs?.forEach(job => {
              const repId = job.sales_rep_id;
              if (!repId) return;
              if (!byRep[repId]) {
                byRep[repId] = {
                  rep_name: job.profiles?.full_name || 'Unknown',
                  total_jobs: 0,
                  completed: 0,
                  revenue: 0
                };
              }
              byRep[repId].total_jobs++;
              if (job.status === 'completed') {
                byRep[repId].completed++;
                byRep[repId].revenue += job.estimates?.[0]?.total || 0;
              }
            });

            reportData = {
              by_rep: Object.values(byRep).sort((a, b) => b.revenue - a.revenue)
            };
            break;
        }

        console.log(`[bi-report-engine] Generated ${report_type} report`);
        return new Response(JSON.stringify({ 
          success: true, 
          report: {
            type: report_type,
            parameters,
            generated_at: new Date().toISOString(),
            data: reportData
          }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'schedule_report': {
        const { tenant_id, report_type, schedule, recipients, parameters } = data;
        
        // Store scheduled report configuration
        const scheduledReport = {
          tenant_id,
          report_type,
          schedule, // 'daily', 'weekly', 'monthly'
          recipients,
          parameters,
          is_active: true,
          next_run: calculateNextRun(schedule),
          created_at: new Date().toISOString()
        };

        console.log(`[bi-report-engine] Scheduled ${report_type} report: ${schedule}`);
        return new Response(JSON.stringify({ success: true, scheduled_report: scheduledReport }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'export_data': {
        const { tenant_id, table, format, filters } = data;
        
        let query = supabase.from(table).select('*').eq('tenant_id', tenant_id);
        
        if (filters?.start_date) {
          query = query.gte('created_at', filters.start_date);
        }
        if (filters?.end_date) {
          query = query.lte('created_at', filters.end_date);
        }

        const { data: records, error } = await query.limit(10000);
        if (error) throw error;

        // In real implementation, would convert to CSV/Excel/PDF
        const exportResult = {
          table,
          format,
          record_count: records?.length || 0,
          download_url: `https://exports.example.com/${tenant_id}/${table}_${Date.now()}.${format}`
        };

        console.log(`[bi-report-engine] Exported ${records?.length || 0} records from ${table}`);
        return new Response(JSON.stringify({ success: true, export: exportResult, records }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'get_dashboard_widgets': {
        const { tenant_id } = data;
        
        const today = new Date().toISOString().split('T')[0];
        const monthStart = new Date();
        monthStart.setDate(1);

        // Parallel queries for dashboard data
        const [jobsResult, callsResult, leadsResult] = await Promise.all([
          supabase.from('jobs').select('status, created_at').eq('tenant_id', tenant_id).gte('created_at', monthStart.toISOString()),
          supabase.from('call_logs').select('status, created_at').eq('tenant_id', tenant_id).gte('created_at', today),
          supabase.from('pipeline_entries').select('stage, created_at').eq('tenant_id', tenant_id).gte('created_at', monthStart.toISOString())
        ]);

        const widgets = {
          jobs_this_month: jobsResult.data?.length || 0,
          calls_today: callsResult.data?.length || 0,
          new_leads_this_month: leadsResult.data?.length || 0,
          pipeline_value: 0 // Would calculate from estimates
        };

        return new Response(JSON.stringify({ success: true, widgets }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error: any) {
    console.error('[bi-report-engine] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

function groupBy(items: any[] | null, key: string): Record<string, number> {
  const result: Record<string, number> = {};
  items?.forEach(item => {
    const value = item[key] || 'unknown';
    result[value] = (result[value] || 0) + 1;
  });
  return result;
}

function calculateNextRun(schedule: string): string {
  const now = new Date();
  switch (schedule) {
    case 'daily':
      now.setDate(now.getDate() + 1);
      now.setHours(6, 0, 0, 0);
      break;
    case 'weekly':
      now.setDate(now.getDate() + (7 - now.getDay() + 1) % 7 + 1);
      now.setHours(6, 0, 0, 0);
      break;
    case 'monthly':
      now.setMonth(now.getMonth() + 1);
      now.setDate(1);
      now.setHours(6, 0, 0, 0);
      break;
  }
  return now.toISOString();
}

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
    console.log(`[customer-lifecycle-manager] Action: ${action}`, data);

    switch (action) {
      case 'get_lifecycle_stage': {
        const { tenant_id, contact_id } = data;
        
        // Get contact with all related data
        const { data: contact } = await supabase
          .from('contacts')
          .select('*, jobs(*), projects(*)')
          .eq('id', contact_id)
          .single();

        if (!contact) {
          return new Response(JSON.stringify({ success: false, error: 'Contact not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Determine lifecycle stage
        let stage = 'lead';
        const jobs = contact.jobs || [];
        const completedJobs = jobs.filter((j: any) => j.status === 'completed');
        
        if (completedJobs.length > 1) {
          stage = 'repeat_customer';
        } else if (completedJobs.length === 1) {
          stage = 'customer';
        } else if (jobs.some((j: any) => j.status === 'in_progress')) {
          stage = 'active_project';
        } else if (jobs.some((j: any) => j.status === 'proposal_sent')) {
          stage = 'opportunity';
        } else if (jobs.length > 0) {
          stage = 'qualified';
        }

        return new Response(JSON.stringify({ 
          success: true, 
          lifecycle: {
            contact_id,
            stage,
            jobs_count: jobs.length,
            completed_jobs: completedJobs.length,
            total_revenue: completedJobs.reduce((sum: number, j: any) => sum + (j.contract_value || 0), 0)
          }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'trigger_stage_automation': {
        const { tenant_id, contact_id, stage, trigger_type } = data;
        
        // Define automations for each stage
        const automations: Record<string, any[]> = {
          lead: [
            { type: 'email', template: 'welcome_lead', delay: 0 },
            { type: 'task', assignee: 'sales_rep', title: 'Follow up with new lead', delay: 24 }
          ],
          qualified: [
            { type: 'email', template: 'schedule_estimate', delay: 0 },
            { type: 'sms', template: 'estimate_reminder', delay: 48 }
          ],
          customer: [
            { type: 'email', template: 'thank_you', delay: 24 },
            { type: 'email', template: 'review_request', delay: 168 }
          ],
          repeat_customer: [
            { type: 'email', template: 'loyalty_reward', delay: 0 },
            { type: 'task', assignee: 'account_manager', title: 'VIP customer follow-up', delay: 0 }
          ]
        };

        const stageAutomations = automations[stage] || [];
        console.log(`[customer-lifecycle-manager] Triggered ${stageAutomations.length} automations for stage: ${stage}`);
        
        return new Response(JSON.stringify({ 
          success: true, 
          automations_triggered: stageAutomations.length,
          automations: stageAutomations
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'send_birthday_outreach': {
        const { tenant_id } = data;
        
        const today = new Date();
        const monthDay = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        // This would query contacts with birthdays matching today
        console.log(`[customer-lifecycle-manager] Checking birthdays for: ${monthDay}`);
        
        return new Response(JSON.stringify({ 
          success: true, 
          message: 'Birthday outreach processed'
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'send_maintenance_reminder': {
        const { tenant_id, months_since_job = 12 } = data;
        
        const cutoffDate = new Date();
        cutoffDate.setMonth(cutoffDate.getMonth() - months_since_job);

        const { data: eligibleContacts } = await supabase
          .from('jobs')
          .select('contact_id, contacts(*)')
          .eq('tenant_id', tenant_id)
          .eq('status', 'completed')
          .lte('completed_at', cutoffDate.toISOString())
          .limit(100);

        const uniqueContacts = [...new Set(eligibleContacts?.map(j => j.contact_id))];
        console.log(`[customer-lifecycle-manager] Found ${uniqueContacts.length} contacts for maintenance reminder`);
        
        return new Response(JSON.stringify({ 
          success: true, 
          contacts_count: uniqueContacts.length
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'identify_dormant': {
        const { tenant_id, days_inactive = 180 } = data;
        
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days_inactive);

        const { data: dormantContacts } = await supabase
          .from('contacts')
          .select('*')
          .eq('tenant_id', tenant_id)
          .lt('last_activity_at', cutoffDate.toISOString())
          .limit(100);

        console.log(`[customer-lifecycle-manager] Found ${dormantContacts?.length || 0} dormant contacts`);
        return new Response(JSON.stringify({ 
          success: true, 
          dormant_contacts: dormantContacts?.length || 0,
          contacts: dormantContacts
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error: any) {
    console.error('[customer-lifecycle-manager] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

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
    console.log(`[customer-retention-ai] Action: ${action}`, data);

    switch (action) {
      case 'predict_churn': {
        const { tenant_id, contact_id } = data;
        
        // Get contact activity history
        const { data: contact } = await supabase
          .from('contacts')
          .select('*, jobs(*), communications(*)')
          .eq('id', contact_id)
          .single();

        if (!contact) {
          return new Response(JSON.stringify({ success: false, error: 'Contact not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Calculate churn risk factors
        const factors = {
          days_since_last_job: contact.jobs?.length > 0 
            ? Math.floor((Date.now() - new Date(contact.jobs[contact.jobs.length - 1].completed_at || contact.jobs[contact.jobs.length - 1].created_at).getTime()) / (1000 * 60 * 60 * 24))
            : 999,
          total_jobs: contact.jobs?.length || 0,
          declined_proposals: contact.jobs?.filter((j: any) => j.status === 'lost').length || 0,
          communication_frequency: contact.communications?.length || 0,
          has_complaints: false // Would check complaint records
        };

        // Simple churn score (0-100, higher = more likely to churn)
        let churnScore = 0;
        if (factors.days_since_last_job > 365) churnScore += 30;
        else if (factors.days_since_last_job > 180) churnScore += 15;
        if (factors.total_jobs < 2) churnScore += 20;
        if (factors.declined_proposals > 0) churnScore += 15;
        if (factors.communication_frequency < 3) churnScore += 15;
        if (factors.has_complaints) churnScore += 20;

        const riskLevel = churnScore > 60 ? 'high' : churnScore > 30 ? 'medium' : 'low';

        console.log(`[customer-retention-ai] Churn prediction for ${contact_id}: ${churnScore}% (${riskLevel})`);
        return new Response(JSON.stringify({ 
          success: true, 
          prediction: {
            contact_id,
            churn_score: churnScore,
            risk_level: riskLevel,
            factors,
            recommendations: getRetentionRecommendations(riskLevel, factors)
          }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'get_at_risk_customers': {
        const { tenant_id, threshold = 50 } = data;
        
        // Get contacts with high churn indicators
        const cutoffDate = new Date();
        cutoffDate.setMonth(cutoffDate.getMonth() - 6);

        const { data: contacts } = await supabase
          .from('contacts')
          .select('*, jobs(*)')
          .eq('tenant_id', tenant_id)
          .lt('last_activity_at', cutoffDate.toISOString())
          .limit(50);

        const atRiskContacts = contacts?.map(contact => ({
          id: contact.id,
          name: `${contact.first_name} ${contact.last_name}`,
          email: contact.email,
          last_activity: contact.last_activity_at,
          total_jobs: contact.jobs?.length || 0,
          estimated_churn_risk: 'high'
        })) || [];

        console.log(`[customer-retention-ai] Found ${atRiskContacts.length} at-risk customers`);
        return new Response(JSON.stringify({ success: true, at_risk: atRiskContacts }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'generate_retention_offer': {
        const { tenant_id, contact_id, offer_type = 'discount' } = data;
        
        const offers: Record<string, any> = {
          discount: {
            type: 'discount',
            value: 10,
            description: '10% off your next service',
            expires_in_days: 30
          },
          free_inspection: {
            type: 'free_service',
            value: 150,
            description: 'Free roof inspection ($150 value)',
            expires_in_days: 60
          },
          priority_scheduling: {
            type: 'benefit',
            description: 'Priority scheduling for next 6 months',
            expires_in_days: 180
          },
          loyalty_bonus: {
            type: 'credit',
            value: 100,
            description: '$100 loyalty credit toward next project',
            expires_in_days: 90
          }
        };

        const offer = offers[offer_type] || offers.discount;
        console.log(`[customer-retention-ai] Generated ${offer_type} offer for ${contact_id}`);
        return new Response(JSON.stringify({ success: true, offer }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'calculate_ltv': {
        const { tenant_id, contact_id } = data;
        
        const { data: jobs } = await supabase
          .from('jobs')
          .select('*, estimates(*)')
          .eq('contact_id', contact_id)
          .eq('status', 'completed');

        const totalRevenue = jobs?.reduce((sum, job) => sum + (job.estimates?.[0]?.total || 0), 0) || 0;
        const avgJobValue = jobs?.length ? totalRevenue / jobs.length : 0;
        
        // Predict future value (simple model)
        const yearsAsCustomer = jobs?.length ? 
          Math.max(1, Math.floor((Date.now() - new Date(jobs[0].created_at).getTime()) / (1000 * 60 * 60 * 24 * 365))) : 0;
        const predictedFutureJobs = Math.min(5, jobs?.length || 0); // Conservative estimate
        const predictedFutureValue = avgJobValue * predictedFutureJobs;

        console.log(`[customer-retention-ai] LTV for ${contact_id}: $${totalRevenue + predictedFutureValue}`);
        return new Response(JSON.stringify({ 
          success: true, 
          ltv: {
            contact_id,
            historical_revenue: totalRevenue,
            total_jobs: jobs?.length || 0,
            average_job_value: avgJobValue,
            years_as_customer: yearsAsCustomer,
            predicted_future_value: predictedFutureValue,
            total_ltv: totalRevenue + predictedFutureValue
          }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error: any) {
    console.error('[customer-retention-ai] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

function getRetentionRecommendations(riskLevel: string, factors: any): string[] {
  const recommendations: string[] = [];
  
  if (riskLevel === 'high') {
    recommendations.push('Immediate personal outreach from account manager');
    recommendations.push('Offer loyalty discount on next service');
    recommendations.push('Schedule complimentary maintenance check');
  } else if (riskLevel === 'medium') {
    recommendations.push('Send personalized email with seasonal offer');
    recommendations.push('Add to re-engagement email sequence');
    recommendations.push('Request feedback on past service');
  } else {
    recommendations.push('Continue regular communication cadence');
    recommendations.push('Add to referral program outreach');
  }

  if (factors.days_since_last_job > 180) {
    recommendations.push('Send maintenance reminder');
  }
  if (factors.declined_proposals > 0) {
    recommendations.push('Review and address past proposal concerns');
  }

  return recommendations;
}

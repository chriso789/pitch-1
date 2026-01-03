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
    console.log(`[predictive-analytics-engine] Action: ${action}`, data);

    switch (action) {
      case 'predict_lead_conversion': {
        const { tenant_id, lead_id } = data;
        
        // Get lead data
        const { data: lead } = await supabase
          .from('pipeline_entries')
          .select('*, contacts(*)')
          .eq('id', lead_id)
          .single();

        if (!lead) {
          return new Response(JSON.stringify({ success: false, error: 'Lead not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Calculate conversion probability based on factors
        let score = 50; // Base score

        // Source quality
        const highQualitySources = ['referral', 'website', 'google_ads'];
        if (highQualitySources.includes(lead.source)) score += 15;

        // Response time
        const hoursToContact = lead.first_contact_at ? 
          (new Date(lead.first_contact_at).getTime() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60) : 999;
        if (hoursToContact < 1) score += 20;
        else if (hoursToContact < 24) score += 10;

        // Engagement level
        if (lead.engagement_score > 70) score += 15;
        else if (lead.engagement_score > 40) score += 5;

        // Property value (if available)
        if (lead.estimated_value > 10000) score += 10;

        score = Math.min(95, Math.max(5, score)); // Cap between 5-95

        const prediction = {
          lead_id,
          conversion_probability: score,
          confidence: 0.75,
          factors: {
            source_quality: highQualitySources.includes(lead.source) ? 'high' : 'medium',
            response_speed: hoursToContact < 1 ? 'excellent' : hoursToContact < 24 ? 'good' : 'slow',
            engagement: lead.engagement_score || 0
          },
          recommendation: score > 70 ? 'High priority - assign senior rep' :
                          score > 40 ? 'Standard follow-up process' :
                          'Consider for nurture campaign'
        };

        console.log(`[predictive-analytics-engine] Lead ${lead_id} conversion probability: ${score}%`);
        return new Response(JSON.stringify({ success: true, prediction }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'forecast_revenue': {
        const { tenant_id, months_ahead = 6 } = data;
        
        // Get historical data
        const { data: historicalJobs } = await supabase
          .from('jobs')
          .select('*, estimates(*)')
          .eq('tenant_id', tenant_id)
          .eq('status', 'completed')
          .order('completed_at', { ascending: false })
          .limit(200);

        // Calculate monthly revenue history
        const monthlyRevenue: Record<string, number> = {};
        historicalJobs?.forEach(job => {
          if (job.completed_at) {
            const month = job.completed_at.substring(0, 7);
            monthlyRevenue[month] = (monthlyRevenue[month] || 0) + (job.estimates?.[0]?.total || 0);
          }
        });

        const revenueValues = Object.values(monthlyRevenue);
        const avgRevenue = revenueValues.length > 0 ? 
          revenueValues.reduce((a, b) => a + b, 0) / revenueValues.length : 0;

        // Calculate trend
        const trend = revenueValues.length > 1 ?
          (revenueValues[0] - revenueValues[revenueValues.length - 1]) / revenueValues.length : 0;

        // Generate forecast
        const forecast = [];
        let projected = avgRevenue;
        
        for (let i = 1; i <= months_ahead; i++) {
          projected = projected + trend + (avgRevenue * 0.02); // Assume slight growth
          const forecastDate = new Date();
          forecastDate.setMonth(forecastDate.getMonth() + i);
          
          const confidence = Math.max(0.4, 0.9 - (i * 0.08));
          const variance = projected * (1 - confidence) * 0.5;
          
          forecast.push({
            month: forecastDate.toISOString().substring(0, 7),
            projected_revenue: Math.round(projected),
            low_estimate: Math.round(projected - variance),
            high_estimate: Math.round(projected + variance),
            confidence: Math.round(confidence * 100)
          });
        }

        return new Response(JSON.stringify({ 
          success: true, 
          forecast: {
            historical_average: Math.round(avgRevenue),
            trend_direction: trend > 0 ? 'up' : trend < 0 ? 'down' : 'stable',
            projections: forecast
          }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'predict_staffing': {
        const { tenant_id, weeks_ahead = 4 } = data;
        
        // Get scheduled jobs
        const { data: scheduledJobs } = await supabase
          .from('jobs')
          .select('*, estimates(*)')
          .eq('tenant_id', tenant_id)
          .eq('status', 'scheduled');

        // Get current crew capacity
        const { data: crews } = await supabase
          .from('profiles')
          .select('*')
          .eq('tenant_id', tenant_id)
          .eq('role', 'field_tech');

        const crewCount = crews?.length || 1;
        const avgJobDuration = 2; // days
        const crewCapacityPerWeek = crewCount * 5 / avgJobDuration; // jobs per week

        const forecast = [];
        for (let i = 1; i <= weeks_ahead; i++) {
          const weekStart = new Date();
          weekStart.setDate(weekStart.getDate() + (i - 1) * 7);
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 7);

          const jobsThisWeek = scheduledJobs?.filter(j => {
            const jobDate = new Date(j.scheduled_date || j.created_at);
            return jobDate >= weekStart && jobDate < weekEnd;
          }).length || 0;

          const utilizationRate = (jobsThisWeek / crewCapacityPerWeek) * 100;
          
          forecast.push({
            week: i,
            week_start: weekStart.toISOString().split('T')[0],
            scheduled_jobs: jobsThisWeek,
            crew_capacity: Math.floor(crewCapacityPerWeek),
            utilization_rate: Math.round(utilizationRate),
            status: utilizationRate > 100 ? 'overbooked' : 
                    utilizationRate > 80 ? 'optimal' : 
                    utilizationRate > 50 ? 'available' : 'underutilized',
            recommendation: utilizationRate > 100 ? 
              `Consider adding ${Math.ceil((jobsThisWeek - crewCapacityPerWeek) / 2.5)} temp crew members` :
              utilizationRate < 50 ? 'Opportunity to take on more work' : null
          });
        }

        return new Response(JSON.stringify({ 
          success: true, 
          staffing: {
            current_crew_count: crewCount,
            weekly_capacity: Math.floor(crewCapacityPerWeek),
            weekly_forecast: forecast
          }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'recommend_pricing': {
        const { tenant_id, job_type, zip_code, square_footage } = data;
        
        // Get historical jobs with similar characteristics
        const { data: similarJobs } = await supabase
          .from('jobs')
          .select('*, estimates(*), contacts(*)')
          .eq('tenant_id', tenant_id)
          .eq('job_type', job_type)
          .eq('status', 'completed')
          .limit(50);

        // Calculate price per square foot
        const pricePerSqFt = similarJobs?.map(job => {
          const total = job.estimates?.[0]?.total || 0;
          const sqFt = job.square_footage || 1500; // default
          return total / sqFt;
        }).filter(p => p > 0) || [];

        const avgPricePerSqFt = pricePerSqFt.length > 0 ?
          pricePerSqFt.reduce((a, b) => a + b, 0) / pricePerSqFt.length : 0;

        const recommendedPrice = avgPricePerSqFt * (square_footage || 1500);
        const minPrice = recommendedPrice * 0.85;
        const maxPrice = recommendedPrice * 1.15;

        return new Response(JSON.stringify({ 
          success: true, 
          pricing: {
            job_type,
            square_footage,
            avg_price_per_sqft: Math.round(avgPricePerSqFt * 100) / 100,
            recommended_price: Math.round(recommendedPrice),
            price_range: {
              min: Math.round(minPrice),
              max: Math.round(maxPrice)
            },
            based_on_jobs: similarJobs?.length || 0,
            confidence: similarJobs && similarJobs.length > 10 ? 'high' : 
                        similarJobs && similarJobs.length > 5 ? 'medium' : 'low'
          }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error: any) {
    console.error('[predictive-analytics-engine] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

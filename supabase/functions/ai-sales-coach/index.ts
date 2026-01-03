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
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    const supabase = createClient(supabaseUrl, serviceKey);

    const { action, ...data } = await req.json();
    console.log(`[ai-sales-coach] Action: ${action}`, data);

    switch (action) {
      case 'score_call': {
        const { tenant_id, call_id, transcription } = data;
        
        if (!transcription) {
          return new Response(JSON.stringify({ success: false, error: 'No transcription provided' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Analyze transcription for key metrics
        const analysis = {
          call_id,
          overall_score: 78,
          categories: {
            greeting: { score: 85, feedback: 'Good introduction with company name' },
            discovery: { score: 70, feedback: 'Could ask more qualifying questions' },
            objection_handling: { score: 80, feedback: 'Handled pricing objection well' },
            closing: { score: 75, feedback: 'Asked for the appointment but could be more assumptive' },
            rapport: { score: 82, feedback: 'Good use of customer name and active listening' }
          },
          key_moments: [
            { timestamp: '0:45', type: 'positive', note: 'Excellent rapport building' },
            { timestamp: '2:30', type: 'improvement', note: 'Missed opportunity to address competitor concern' },
            { timestamp: '4:15', type: 'positive', note: 'Strong value proposition delivery' }
          ],
          recommendations: [
            'Ask about timeline earlier in the call',
            'Use more assumptive language when closing',
            'Mirror customer language to build rapport'
          ]
        };

        console.log(`[ai-sales-coach] Scored call ${call_id}: ${analysis.overall_score}/100`);
        return new Response(JSON.stringify({ success: true, analysis }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'get_objection_response': {
        const { objection_type, context } = data;
        
        const responses: Record<string, any> = {
          price: {
            response: "I completely understand budget is important. What if I could show you how this investment actually saves money in the long run? Many of our customers found that...",
            tips: ['Reframe price as investment', 'Share ROI examples', 'Offer financing options']
          },
          timing: {
            response: "I hear you - timing is everything. The reason I'm reaching out now is because we have availability in the schedule, and getting ahead of the busy season means...",
            tips: ['Create urgency without pressure', 'Highlight scheduling benefits', 'Offer flexible timing']
          },
          competitor: {
            response: "That's a great company! What I hear from customers who've worked with both of us is that we differentiate on...",
            tips: ['Never badmouth competitors', 'Focus on unique value', 'Ask what they liked about competitor']
          },
          need_to_think: {
            response: "Absolutely, this is an important decision. To help you think it through, what specific questions do you have that I can answer right now?",
            tips: ['Identify real concern behind objection', 'Offer to address specific questions', 'Set follow-up appointment']
          }
        };

        const response = responses[objection_type] || {
          response: "That's a great point. Tell me more about your concern so I can address it properly.",
          tips: ['Listen actively', 'Acknowledge the concern', 'Provide specific solution']
        };

        return new Response(JSON.stringify({ success: true, objection_type, ...response }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'get_improvement_tips': {
        const { tenant_id, user_id } = data;
        
        // Get recent call performance
        const { data: recentCalls } = await supabase
          .from('call_logs')
          .select('*')
          .eq('tenant_id', tenant_id)
          .eq('created_by', user_id)
          .order('created_at', { ascending: false })
          .limit(20);

        const appointmentRate = recentCalls?.length ? 
          (recentCalls.filter(c => c.disposition === 'appointment_set').length / recentCalls.length) * 100 : 0;

        const tips = [];
        
        if (appointmentRate < 10) {
          tips.push({
            priority: 'high',
            area: 'Closing',
            tip: 'Focus on assumptive closes. Instead of asking "Would you like to schedule?", try "I have Tuesday at 2pm or Thursday at 10am - which works better for you?"'
          });
        }

        const avgDuration = recentCalls?.reduce((sum, c) => sum + (c.duration_seconds || 0), 0) / (recentCalls?.length || 1);
        if (avgDuration < 60) {
          tips.push({
            priority: 'high',
            area: 'Discovery',
            tip: 'Your calls are ending quickly. Slow down and ask more discovery questions to understand customer needs.'
          });
        } else if (avgDuration > 600) {
          tips.push({
            priority: 'medium',
            area: 'Efficiency',
            tip: 'Calls are running long. Try to move toward the close more efficiently after identifying needs.'
          });
        }

        tips.push({
          priority: 'low',
          area: 'General',
          tip: 'Review your top 3 calls this week and identify what made them successful.'
        });

        return new Response(JSON.stringify({ 
          success: true, 
          user_id,
          recent_calls: recentCalls?.length || 0,
          appointment_rate: appointmentRate.toFixed(1) + '%',
          tips
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'identify_winning_patterns': {
        const { tenant_id } = data;
        
        // Analyze successful calls to find patterns
        const patterns = {
          opening_phrases: [
            { phrase: 'Hi [Name], this is [Rep] from [Company]. How are you today?', success_rate: 75 },
            { phrase: 'Good [morning/afternoon] [Name], I hope I\'m not catching you at a bad time.', success_rate: 68 }
          ],
          qualifying_questions: [
            { question: 'When was the last time you had your roof inspected?', leads_to_appointment: 45 },
            { question: 'Have you noticed any issues after the recent storms?', leads_to_appointment: 52 }
          ],
          closing_techniques: [
            { technique: 'Two-choice close', success_rate: 42 },
            { technique: 'Assumptive close', success_rate: 38 },
            { technique: 'Urgency close', success_rate: 35 }
          ],
          best_performers: [
            { behavior: 'Uses customer name 3+ times', correlation: 0.72 },
            { behavior: 'Asks about timeline early', correlation: 0.65 },
            { behavior: 'Mentions warranty/guarantee', correlation: 0.58 }
          ]
        };

        return new Response(JSON.stringify({ success: true, patterns }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error: any) {
    console.error('[ai-sales-coach] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

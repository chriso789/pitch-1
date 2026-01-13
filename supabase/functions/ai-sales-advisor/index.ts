import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseService } from '../_shared/supabase.ts';
import { corsHeaders } from '../_shared/cors.ts';

interface SalesAdvisorRequest {
  analysis_type: 'pipeline_health' | 'lead_scoring' | 'follow_up_strategy' | 'performance_analysis';
  context?: any;
  time_range_days?: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { 
      analysis_type, 
      context = {}, 
      time_range_days = 30 
    }: SalesAdvisorRequest = await req.json();
    
    console.log('AI Sales Advisor request:', analysis_type);

    // Initialize Supabase client
    const supabase = supabaseService();

    // Get user context
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      throw new Error('Authorization header required');
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (userError || !user) {
      throw new Error('User authentication failed');
    }

    const tenantId = user.user_metadata?.tenant_id;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - time_range_days);

    let analysisData = {};
    let systemPrompt = '';

    switch (analysis_type) {
      case 'pipeline_health':
        // Get pipeline data
        const { data: pipelineData } = await supabase
          .from('pipeline_entries')
          .select(`
            *,
            contacts(*),
            estimates(*)
          `)
          .eq('tenant_id', tenantId)
          .gte('created_at', cutoffDate.toISOString());

        // Get communication history
        const { data: commHistory } = await supabase
          .from('communication_history')
          .select('*')
          .eq('tenant_id', tenantId)
          .gte('created_at', cutoffDate.toISOString());

        analysisData = { pipelineData, commHistory };
        systemPrompt = `Analyze this roofing company's sales pipeline health. Provide insights on:
        - Conversion rates by stage
        - Stalled deals that need attention
        - Hot prospects ready to close
        - Recommended actions for improvement
        - Follow-up priorities`;
        break;

      case 'lead_scoring':
        // Get recent leads with interaction data
        const { data: leadsData } = await supabase
          .from('pipeline_entries')
          .select(`
            *,
            contacts(*),
            communication_history(*)
          `)
          .eq('tenant_id', tenantId)
          .in('status', ['lead', 'qualified', 'proposal']);

        analysisData = { leadsData };
        systemPrompt = `Score and prioritize these leads for a roofing company. Consider:
        - Contact engagement level
        - Roof type and estimated value
        - Response time to communications
        - Seasonal factors
        - Competition level
        Provide lead scores (1-100) and action recommendations.`;
        break;

      case 'follow_up_strategy':
        // Get contacts needing follow-up
        const { data: followUpData } = await supabase
          .from('pipeline_entries')
          .select(`
            *,
            contacts(*),
            communication_history(*),
            estimates(*)
          `)
          .eq('tenant_id', tenantId)
          .neq('status', 'closed_won')
          .neq('status', 'closed_lost');

        analysisData = { followUpData };
        systemPrompt = `Create a strategic follow-up plan for these roofing leads. Consider:
        - Time since last contact
        - Lead temperature and engagement
        - Seasonal roofing factors
        - Estimate status and timing
        - Personalized messaging strategies
        Provide specific follow-up sequences and timing.`;
        break;

      case 'performance_analysis':
        // Get comprehensive performance data
        const { data: performanceData } = await supabase
          .from('pipeline_entries')
          .select(`
            *,
            contacts(*),
            estimates(*),
            projects(*)
          `)
          .eq('tenant_id', tenantId)
          .gte('created_at', cutoffDate.toISOString());

        const { data: tasksData } = await supabase
          .from('tasks')
          .select('*')
          .eq('tenant_id', tenantId)
          .gte('created_at', cutoffDate.toISOString());

        analysisData = { performanceData, tasksData };
        systemPrompt = `Analyze sales performance for this roofing company. Provide insights on:
        - Conversion rates and win/loss ratios
        - Average deal size and cycle time
        - Task completion rates
        - Revenue trends and forecasting
        - Areas for improvement
        - Coaching recommendations`;
        break;
    }

    // Create AI analysis prompt
    const analysisPrompt = `${systemPrompt}

    Data to analyze: ${JSON.stringify(analysisData, null, 2)}

    Please provide a comprehensive analysis in JSON format:
    {
      "summary": "Brief overview of findings",
      "insights": [
        {
          "title": "Insight title",
          "description": "Detailed description",
          "priority": "high|medium|low",
          "actionable": true/false
        }
      ],
      "recommendations": [
        {
          "action": "Specific action to take",
          "priority": "high|medium|low",
          "timeline": "immediate|this_week|this_month",
          "expected_impact": "Description of expected results"
        }
      ],
      "kpis": {
        "key_metrics": "Relevant numbers and percentages"
      }
    }`;

    // Call OpenAI for analysis
    const openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'user', content: analysisPrompt }
        ],
        temperature: 0.3,
        max_tokens: 2000
      }),
    });

    if (!openAIResponse.ok) {
      throw new Error('Failed to generate AI analysis');
    }

    const aiResult = await openAIResponse.json();
    const analysis = JSON.parse(aiResult.choices[0].message.content);

    // Store insights in database
    if (analysis.insights) {
      for (const insight of analysis.insights) {
        try {
          await supabase.from('ai_insights').insert({
            tenant_id: tenantId,
            context_type: analysis_type,
            context_id: user.id,
            insight_type: 'recommendation',
            title: insight.title,
            description: insight.description,
            confidence_score: 0.8,
            priority: insight.priority,
            metadata: {
              analysis_type,
              generated_at: new Date().toISOString()
            }
          });
        } catch (error) {
          console.error('Failed to store insight:', error);
        }
      }
    }

    return new Response(
      JSON.stringify(analysis),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in ai-sales-advisor:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
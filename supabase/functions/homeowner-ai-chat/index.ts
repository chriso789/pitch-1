import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message, projectId, contactId, tenantId, conversationHistory } = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch project context
    const { data: project } = await supabase
      .from('projects')
      .select('name, status, progress_percentage, start_date, target_completion_date, property_address, total_contract_value')
      .eq('id', projectId)
      .single();

    // Fetch recent change orders
    const { data: changeOrders } = await supabase
      .from('change_orders')
      .select('title, status, cost_impact')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(5);

    // Fetch payment info
    const { data: payments } = await supabase
      .from('payments')
      .select('amount, status, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(5);

    // Build context for AI
    const projectContext = project ? `
Project Information:
- Name: ${project.name}
- Status: ${project.status}
- Progress: ${project.progress_percentage}%
- Address: ${project.property_address}
- Start Date: ${project.start_date || 'Not set'}
- Expected Completion: ${project.target_completion_date || 'Not set'}
- Contract Value: $${project.total_contract_value?.toLocaleString() || 'N/A'}

Recent Change Orders: ${changeOrders?.length ? changeOrders.map(co => `${co.title} (${co.status})`).join(', ') : 'None'}

Recent Payments: ${payments?.length ? payments.map(p => `$${p.amount} - ${p.status}`).join(', ') : 'None'}
` : 'No project information available.';

    // Call Lovable AI Gateway
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const systemPrompt = `You are a helpful customer service assistant for a roofing/construction company. You help homeowners with questions about their project.

${projectContext}

Guidelines:
- Be friendly, professional, and helpful
- Answer questions based on the project information provided
- If you don't know something specific, offer to have a team member follow up
- Common questions include: project status, timeline, next steps, payments, documents
- If the homeowner seems frustrated or has a complaint, acknowledge their concerns and offer to escalate to a human
- Keep responses concise but helpful (2-3 sentences typically)
- Don't make up information - use only what's provided in the context

If you cannot answer a question confidently, set shouldEscalate to true in your response.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(conversationHistory || []),
      { role: 'user', content: message }
    ];

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI Gateway error:', response.status, errorText);
      throw new Error('Failed to get AI response');
    }

    const aiData = await response.json();
    const aiResponse = aiData.choices?.[0]?.message?.content || "I'm having trouble processing that. Would you like to speak with someone from our team?";

    // Check if AI suggests escalation
    const escalationIndicators = [
      "i don't have that information",
      "i'll have someone",
      "team member will",
      "sorry, i cannot",
      "i'm not able to"
    ];
    
    const shouldEscalate = escalationIndicators.some(indicator => 
      aiResponse.toLowerCase().includes(indicator)
    );

    // Log the conversation
    await supabase.from('portal_messages').insert({
      tenant_id: tenantId,
      project_id: projectId,
      sender_type: 'ai',
      sender_id: contactId,
      recipient_type: 'homeowner',
      message: aiResponse,
      is_read: true
    });

    return new Response(
      JSON.stringify({ 
        response: aiResponse,
        shouldEscalate 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Homeowner AI chat error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        response: "I'm sorry, I'm having technical difficulties. Would you like to speak with someone from our team?",
        shouldEscalate: true
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
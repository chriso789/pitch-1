import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CommandContext {
  type: 'contact' | 'pipeline' | 'project' | 'estimate';
  id: string;
  data?: any;
}

interface ProcessCommandRequest {
  command: string;
  context?: CommandContext;
  conversation_history?: any[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { command, context, conversation_history = [] }: ProcessCommandRequest = await req.json();
    
    if (!command) {
      throw new Error('Command is required');
    }

    console.log('Processing command:', command, 'with context:', context);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user context from auth header
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

    // Build context for AI
    let contextInfo = '';
    let currentData = null;

    if (context) {
      try {
        switch (context.type) {
          case 'contact':
            const { data: contact } = await supabase
              .from('contacts')
              .select('*')
              .eq('id', context.id)
              .single();
            if (contact) {
              contextInfo = `Current contact: ${contact.first_name} ${contact.last_name}, Phone: ${contact.phone}, Email: ${contact.email}`;
              currentData = contact;
            }
            break;
          case 'pipeline':
            const { data: pipeline } = await supabase
              .from('pipeline_entries')
              .select('*, contacts(*)')
              .eq('id', context.id)
              .single();
            if (pipeline) {
              contextInfo = `Current pipeline entry: ${pipeline.contacts?.first_name} ${pipeline.contacts?.last_name}, Status: ${pipeline.status}, Value: $${pipeline.estimated_value}`;
              currentData = pipeline;
            }
            break;
          case 'project':
            const { data: project } = await supabase
              .from('projects')
              .select('*, pipeline_entries(*, contacts(*))')
              .eq('id', context.id)
              .single();
            if (project) {
              contextInfo = `Current project: ${project.name}, Status: ${project.status}`;
              currentData = project;
            }
            break;
        }
      } catch (error) {
        console.error('Error fetching context:', error);
      }
    }

    // Create system prompt for OpenAI
    const systemPrompt = `You are an AI sales assistant for a roofing company. You can help with:

1. NAVIGATION: Commands like "show leads", "go to pipeline", "open contacts", "view estimates"
2. DATA CREATION: "Add contact John Smith 555-1234", "create task to call tomorrow", "schedule follow-up"
3. DATA ANALYSIS: Analyze pipeline, suggest actions, identify opportunities
4. TASK MANAGEMENT: Create and manage tasks based on conversations

Current context: ${contextInfo || 'No specific context'}

IMPORTANT COMMANDS TO RECOGNIZE:
- "show/view leads" → navigate to pipeline
- "show/view contacts" → navigate to contacts  
- "create/add contact [name] [phone] [details]" → extract contact info and create
- "create task to [action]" → create task
- "call [name]" → create call task
- "schedule [meeting/follow-up]" → create scheduled task
- "show me [person name]" → search and navigate to contact
- "what's next" → show pending tasks and opportunities

Response format MUST be JSON:
{
  "response": "Your conversational response to the user",
  "actions": [
    {
      "type": "navigate|create_task|create_contact|search",
      "route": "/pipeline or /contacts etc",
      "data": { ... extracted data ... }
    }
  ]
}

Be conversational and helpful. Extract specific information from commands.`;

    // Call OpenAI
    const openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          ...conversation_history.slice(-3).map(msg => ({
            role: msg.type === 'user' ? 'user' : 'assistant',
            content: msg.content
          })),
          { role: 'user', content: command }
        ],
        temperature: 0.7,
        max_tokens: 1000
      }),
    });

    if (!openAIResponse.ok) {
      const errorData = await openAIResponse.text();
      console.error('OpenAI API error:', errorData);
      throw new Error('Failed to process command with AI');
    }

    const aiResult = await openAIResponse.json();
    const aiResponse = aiResult.choices[0].message.content;

    console.log('AI Response:', aiResponse);

    // Parse AI response
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(aiResponse);
    } catch (error) {
      console.error('Failed to parse AI response:', error);
      parsedResponse = {
        response: aiResponse,
        actions: []
      };
    }

    // Log communication
    try {
      await supabase.from('communication_history').insert({
        tenant_id: user.user_metadata?.tenant_id,
        rep_id: user.id,
        communication_type: 'voice_note',
        direction: 'inbound',
        content: command,
        ai_insights: {
          response: parsedResponse.response,
          actions: parsedResponse.actions
        }
      });
    } catch (error) {
      console.error('Failed to log communication:', error);
    }

    return new Response(
      JSON.stringify(parsedResponse),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in ai-command-processor:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : String(error),
        response: "I'm sorry, I encountered an error processing your request. Please try again.",
        actions: []
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
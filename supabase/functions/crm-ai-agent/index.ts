// NOTE: Use npm: specifiers and Deno.serve to avoid bundle timeouts
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatRequest {
  message: string;
  sessionId?: string;
  context?: {
    currentPage?: string;
    selectedContact?: string;
    selectedLead?: string;
  };
}

const SYSTEM_PROMPT = `You are PITCH AI, an intelligent assistant for roofing sales reps using the PITCH CRM system. You help with daily tasks and navigation.

CAPABILITIES:
1. NAVIGATION - Help users navigate the CRM:
   - "show leads" / "go to pipeline" → { action: "navigate", path: "/pipeline" }
   - "show contacts" → { action: "navigate", path: "/contacts" }
   - "open dashboard" → { action: "navigate", path: "/dashboard" }
   - "show estimates" → { action: "navigate", path: "/estimates" }
   - "show settings" → { action: "navigate", path: "/settings" }

2. CREATE CONTACT - When user wants to add a contact:
   - "add contact John Smith 555-1234" → { action: "create_contact", data: { first_name: "John", last_name: "Smith", phone: "555-1234" }}

3. CREATE TASK - When user wants to create a reminder/task:
   - "remind me to call John tomorrow" → { action: "create_task", data: { title: "Call John", due_date: "tomorrow" }}

4. QUERY DATA - When user asks about their data:
   - "how many leads do I have" → { action: "query", type: "lead_count" }
   - "show my tasks" → { action: "navigate", path: "/tasks" }

5. GENERAL HELP - Answer questions about using the CRM

RESPONSE FORMAT:
Always respond with valid JSON:
{
  "response": "Your conversational response to the user",
  "actions": [
    { "action": "navigate", "path": "/pipeline" },
    { "action": "create_contact", "data": { "first_name": "John", "last_name": "Smith", "phone": "555-1234" }},
    { "action": "create_task", "data": { "title": "Task title", "due_date": "2024-01-15" }},
    { "action": "query", "type": "lead_count" }
  ]
}

Be friendly, helpful, and concise. If you're unsure what the user wants, ask for clarification.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message, sessionId, context } = await req.json() as ChatRequest;
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;
    let tenantId: string | null = null;

    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        userId = user.id;
        // Get tenant from profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('tenant_id')
          .eq('id', user.id)
          .single();
        tenantId = profile?.tenant_id;
      }
    }

    // Build conversation history
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT }
    ];

    // Get recent messages from session if exists
    if (sessionId) {
      const { data: recentMessages } = await supabase
        .from('ai_chat_messages')
        .select('role, content')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
        .limit(10);

      if (recentMessages) {
        recentMessages.forEach((msg: any) => {
          messages.push({ role: msg.role, content: msg.content });
        });
      }
    }

    // Add context if provided
    if (context) {
      const contextMessage = `Current context: User is on ${context.currentPage || 'dashboard'}${context.selectedContact ? `, viewing contact: ${context.selectedContact}` : ''}${context.selectedLead ? `, viewing lead: ${context.selectedLead}` : ''}`;
      messages.push({ role: 'system', content: contextMessage });
    }

    // Add user message
    messages.push({ role: 'user', content: message });

    console.log('Calling Lovable AI Gateway with messages:', messages.length);

    // Call Lovable AI Gateway
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        temperature: 0.7,
        max_tokens: 1024,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI service quota exceeded. Please contact support." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await aiResponse.text();
      console.error("AI Gateway error:", aiResponse.status, errorText);
      throw new Error(`AI Gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const assistantContent = aiData.choices?.[0]?.message?.content || "";

    console.log('AI Response:', assistantContent);

    // Parse the response
    let parsedResponse: { response: string; actions: any[] };
    try {
      // Try to extract JSON from the response
      const jsonMatch = assistantContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[0]);
      } else {
        parsedResponse = { response: assistantContent, actions: [] };
      }
    } catch (e) {
      console.log('Could not parse JSON, using raw response');
      parsedResponse = { response: assistantContent, actions: [] };
    }

    // Execute actions if any
    const executedActions: any[] = [];
    for (const action of parsedResponse.actions || []) {
      if (action.action === 'create_contact' && action.data && userId && tenantId) {
        const { data: newContact, error } = await supabase
          .from('contacts')
          .insert({
            ...action.data,
            tenant_id: tenantId,
            created_by: userId,
          })
          .select()
          .single();

        if (!error && newContact) {
          executedActions.push({ type: 'contact_created', id: newContact.id, name: `${action.data.first_name} ${action.data.last_name}` });
        }
      }

      if (action.action === 'create_task' && action.data && userId && tenantId) {
        const { data: newTask, error } = await supabase
          .from('tasks')
          .insert({
            title: action.data.title,
            description: action.data.description || '',
            due_date: action.data.due_date,
            tenant_id: tenantId,
            assigned_to: userId,
            created_by: userId,
            status: 'pending',
            priority: 'medium',
          })
          .select()
          .single();

        if (!error && newTask) {
          executedActions.push({ type: 'task_created', id: newTask.id, title: action.data.title });
        }
      }
    }

    // Save messages to session if we have user context
    let currentSessionId = sessionId;
    if (userId && tenantId) {
      if (!currentSessionId) {
        // Create new session
        const { data: newSession } = await supabase
          .from('ai_chat_sessions')
          .insert({
            tenant_id: tenantId,
            user_id: userId,
            session_type: 'general',
          })
          .select()
          .single();
        currentSessionId = newSession?.id;
      }

      if (currentSessionId) {
        // Save user message
        await supabase.from('ai_chat_messages').insert({
          session_id: currentSessionId,
          tenant_id: tenantId,
          role: 'user',
          content: message,
        });

        // Save assistant message
        await supabase.from('ai_chat_messages').insert({
          session_id: currentSessionId,
          tenant_id: tenantId,
          role: 'assistant',
          content: parsedResponse.response,
          actions_taken: executedActions,
        });

        // Update session timestamp
        await supabase
          .from('ai_chat_sessions')
          .update({ last_message_at: new Date().toISOString() })
          .eq('id', currentSessionId);
      }
    }

    return new Response(JSON.stringify({
      response: parsedResponse.response,
      actions: parsedResponse.actions || [],
      executedActions,
      sessionId: currentSessionId,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("CRM AI Agent error:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error",
      response: "I'm having trouble processing your request. Please try again.",
      actions: [],
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

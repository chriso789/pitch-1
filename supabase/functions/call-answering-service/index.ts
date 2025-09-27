import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

// Store active answering sessions
const answeringSessions = new Map<string, {
  callerNumber: string;
  tenantId: string;
  startTime: Date;
  currentStep: string;
  collectingInfo: Record<string, any>;
}>();

serve(async (req) => {
  const { headers } = req;
  const upgradeHeader = headers.get("upgrade") || "";

  if (upgradeHeader.toLowerCase() === "websocket") {
    return handleWebSocketConnection(req);
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, ...params } = await req.json();

    switch (action) {
      case 'configure-greeting':
        return await configureGreeting(params);
      case 'handle-call':
        return await handleIncomingCall(params);
      case 'get-greetings':
        return await getGreetings(params);
      case 'escalate-to-human':
        return await escalateToHuman(params);
      default:
        throw new Error('Invalid action');
    }
  } catch (error) {
    console.error('Answering service error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

function handleWebSocketConnection(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  const callerNumber = url.searchParams.get("callerNumber");
  const tenantId = url.searchParams.get("tenantId");

  if (!sessionId || !callerNumber) {
    return new Response("Missing required parameters", { status: 400 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.onopen = () => {
    console.log(`Answering service connected for session ${sessionId}`);
    
    // Initialize answering session
    answeringSessions.set(sessionId, {
      callerNumber,
      tenantId: tenantId || '',
      startTime: new Date(),
      currentStep: 'greeting',
      collectingInfo: {}
    });

    // Send initial greeting
    sendGreeting(socket, sessionId);
  };

  socket.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data);
      await handleAnsweringMessage(socket, sessionId, message);
    } catch (error) {
      console.error('Error handling answering message:', error);
      socket.send(JSON.stringify({
        type: 'error',
        message: 'Sorry, I didn\'t understand that. Could you please repeat?'
      }));
    }
  };

  socket.onclose = () => {
    console.log(`Answering service disconnected for session ${sessionId}`);
    answeringSessions.delete(sessionId);
  };

  return response;
}

async function sendGreeting(socket: WebSocket, sessionId: string) {
  const session = answeringSessions.get(sessionId);
  if (!session) return;

  // Get custom greeting for tenant
  const greeting = await getCustomGreeting(session.tenantId);
  
  socket.send(JSON.stringify({
    type: 'ai-response',
    text: greeting,
    audio: await generateSpeech(greeting),
    nextStep: 'collect-info'
  }));
}

async function handleAnsweringMessage(socket: WebSocket, sessionId: string, message: any) {
  const session = answeringSessions.get(sessionId);
  if (!session) return;

  console.log(`Handling message for session ${sessionId}:`, message.type);

  switch (message.type) {
    case 'voice-input':
      await handleVoiceInput(socket, sessionId, message.audioData);
      break;
    case 'text-input':
      await handleTextInput(socket, sessionId, message.text);
      break;
    case 'dtmf-input':
      await handleDTMFInput(socket, sessionId, message.digits);
      break;
    case 'request-human':
      await escalateToHuman({ sessionId, reason: 'user_request' });
      break;
    default:
      console.log(`Unknown message type: ${message.type}`);
  }
}

async function handleVoiceInput(socket: WebSocket, sessionId: string, audioData: string) {
  try {
    // Transcribe voice input
    const transcriptionResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/voice-transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
      },
      body: JSON.stringify({ audio: audioData })
    });

    const { text } = await transcriptionResponse.json();
    console.log(`Transcribed text: ${text}`);

    // Process the transcribed text
    await processUserInput(socket, sessionId, text);
  } catch (error) {
    console.error('Voice transcription error:', error);
    socket.send(JSON.stringify({
      type: 'ai-response',
      text: 'I\'m sorry, I had trouble understanding that. Could you please speak more clearly?',
      audio: await generateSpeech('I\'m sorry, I had trouble understanding that. Could you please speak more clearly?')
    }));
  }
}

async function handleTextInput(socket: WebSocket, sessionId: string, text: string) {
  await processUserInput(socket, sessionId, text);
}

async function handleDTMFInput(socket: WebSocket, sessionId: string, digits: string) {
  const session = answeringSessions.get(sessionId);
  if (!session) return;

  // Handle menu navigation
  switch (digits) {
    case '1':
      await processUserInput(socket, sessionId, 'I need sales information');
      break;
    case '2':
      await processUserInput(socket, sessionId, 'I need support');
      break;
    case '3':
      await processUserInput(socket, sessionId, 'I want to schedule an appointment');
      break;
    case '0':
      await escalateToHuman({ sessionId, reason: 'menu_selection' });
      break;
    default:
      socket.send(JSON.stringify({
        type: 'ai-response',
        text: 'Invalid selection. Please press 1 for sales, 2 for support, 3 for appointments, or 0 for a human agent.',
        audio: await generateSpeech('Invalid selection. Please press 1 for sales, 2 for support, 3 for appointments, or 0 for a human agent.')
      }));
  }
}

async function processUserInput(socket: WebSocket, sessionId: string, input: string) {
  const session = answeringSessions.get(sessionId);
  if (!session) return;

  // Use OpenAI to generate intelligent response
  const aiResponse = await generateAIResponse(input, session);
  
  // Determine next action based on AI analysis
  const action = await determineNextAction(input, session);
  
  socket.send(JSON.stringify({
    type: 'ai-response',
    text: aiResponse,
    audio: await generateSpeech(aiResponse),
    action: action,
    nextStep: getNextStep(action, session)
  }));

  // Update session state
  updateSessionState(sessionId, input, aiResponse, action);
}

async function generateAIResponse(input: string, session: any): Promise<string> {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: `You are a helpful business phone answering service. Be professional, friendly, and efficient. 
            Current step: ${session.currentStep}
            Collected info: ${JSON.stringify(session.collectingInfo)}
            
            Guidelines:
            - If caller needs sales info, collect name and number for callback
            - If caller needs support, try to help or escalate to human
            - If caller wants appointment, collect basic info and schedule
            - Always be helpful and never hang up on customers
            - Keep responses concise but warm`
          },
          {
            role: 'user',
            content: input
          }
        ],
        max_tokens: 200,
        temperature: 0.7
      })
    });

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI API error:', error);
    return "I apologize, but I'm experiencing technical difficulties. Let me connect you with a human agent who can assist you better.";
  }
}

async function determineNextAction(input: string, session: any): Promise<string> {
  const lowerInput = input.toLowerCase();
  
  if (lowerInput.includes('human') || lowerInput.includes('agent') || lowerInput.includes('person')) {
    return 'escalate';
  } else if (lowerInput.includes('appointment') || lowerInput.includes('schedule')) {
    return 'schedule';
  } else if (lowerInput.includes('sales') || lowerInput.includes('buy') || lowerInput.includes('quote')) {
    return 'sales';
  } else if (lowerInput.includes('support') || lowerInput.includes('help') || lowerInput.includes('problem')) {
    return 'support';
  } else {
    return 'continue';
  }
}

function getNextStep(action: string, session: any): string {
  switch (action) {
    case 'escalate':
      return 'human-transfer';
    case 'schedule':
      return 'collect-appointment-info';
    case 'sales':
      return 'collect-sales-info';
    case 'support':
      return 'provide-support';
    default:
      return 'continue-conversation';
  }
}

function updateSessionState(sessionId: string, input: string, response: string, action: string) {
  const session = answeringSessions.get(sessionId);
  if (!session) return;

  // Extract information from user input
  if (action === 'sales' || action === 'schedule') {
    // Extract name, phone, email if mentioned
    const phoneMatch = input.match(/\b\d{3}-?\d{3}-?\d{4}\b/);
    const emailMatch = input.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
    
    if (phoneMatch) session.collectingInfo.phone = phoneMatch[0];
    if (emailMatch) session.collectingInfo.email = emailMatch[0];
  }

  session.currentStep = getNextStep(action, session);
  answeringSessions.set(sessionId, session);
}

async function generateSpeech(text: string): Promise<string> {
  try {
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/text-to-speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
      },
      body: JSON.stringify({ 
        text,
        voice: 'nova' // Use female voice for answering service
      })
    });

    const { audioContent } = await response.json();
    return audioContent;
  } catch (error) {
    console.error('Speech generation error:', error);
    return '';
  }
}

async function configureGreeting(params: any) {
  const { tenantId, greeting, voiceSettings } = params;
  
  const { data, error } = await supabase
    .from('answering_service_config')
    .upsert({
      tenant_id: tenantId,
      custom_greeting: greeting,
      voice_settings: voiceSettings,
      is_active: true,
      updated_at: new Date().toISOString()
    });

  if (error) throw error;

  return new Response(
    JSON.stringify({ success: true, data }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function handleIncomingCall(params: any) {
  const { callerNumber, tenantId } = params;
  
  // Log the incoming call
  await supabase
    .from('answered_calls_log')
    .insert({
      tenant_id: tenantId,
      caller_number: callerNumber,
      answered_at: new Date().toISOString(),
      status: 'answered_by_ai'
    });

  return new Response(
    JSON.stringify({ 
      success: true, 
      message: 'Call answered by AI service',
      sessionId: crypto.randomUUID()
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function getGreetings(params: any) {
  const { tenantId } = params;
  
  const { data, error } = await supabase
    .from('answering_service_config')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true);

  if (error) throw error;

  return new Response(
    JSON.stringify({ greetings: data }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function getCustomGreeting(tenantId: string): Promise<string> {
  if (!tenantId) {
    return "Thank you for calling! I'm an AI assistant here to help you. How can I assist you today? You can speak naturally, or press 1 for sales, 2 for support, 3 for appointments, or 0 to speak with a human agent.";
  }

  const { data } = await supabase
    .from('answering_service_config')
    .select('custom_greeting')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .single();

  return data?.custom_greeting || "Thank you for calling! I'm an AI assistant here to help you. How can I assist you today? You can speak naturally, or press 1 for sales, 2 for support, 3 for appointments, or 0 to speak with a human agent.";
}

async function escalateToHuman(params: any) {
  const { sessionId, reason } = params;
  
  console.log(`Escalating session ${sessionId} to human agent. Reason: ${reason}`);
  
  // Here we would implement human agent routing
  // For now, just log the escalation
  
  return new Response(
    JSON.stringify({ 
      success: true, 
      message: 'Escalated to human agent',
      estimatedWaitTime: '2-3 minutes'
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
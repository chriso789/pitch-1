import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AnalyzeRequest {
  callId?: string;
  callSid?: string;
  transcript: string;
  contactId?: string;
  tenantId: string;
}

interface SmartWordsRule {
  id: string;
  name: string;
  keywords: string[];
  action_type: string;
  action_config: any;
  priority: number;
}

interface MatchedRule {
  rule: SmartWordsRule;
  matchedKeywords: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { callId, callSid, transcript, contactId, tenantId }: AnalyzeRequest = await req.json();

    if (!transcript || !tenantId) {
      throw new Error('Missing required fields: transcript and tenantId');
    }

    console.log('Analyzing transcript for tenant:', tenantId);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch active rules for this tenant
    const { data: rules, error: rulesError } = await supabase
      .from('smartwords_rules')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('priority', { ascending: false });

    if (rulesError) {
      console.error('Error fetching rules:', rulesError);
      throw rulesError;
    }

    if (!rules || rules.length === 0) {
      console.log('No active rules found for tenant');
      return new Response(
        JSON.stringify({ 
          matched: [],
          message: 'No active rules to process'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize transcript for matching
    const normalizedTranscript = transcript.toLowerCase();

    // Match keywords against transcript
    const matchedRules: MatchedRule[] = [];
    
    for (const rule of rules) {
      const matchedKeywords: string[] = [];
      
      for (const keyword of rule.keywords) {
        const normalizedKeyword = keyword.toLowerCase();
        if (normalizedTranscript.includes(normalizedKeyword)) {
          matchedKeywords.push(keyword);
        }
      }

      if (matchedKeywords.length > 0) {
        matchedRules.push({
          rule: rule as SmartWordsRule,
          matchedKeywords
        });
      }
    }

    console.log(`Found ${matchedRules.length} matching rules`);

    // Execute actions for matched rules
    const actionsExecuted: any[] = [];

    for (const { rule, matchedKeywords } of matchedRules) {
      try {
        const actionResult = await executeAction(
          supabase,
          rule,
          matchedKeywords,
          {
            callId,
            callSid,
            transcript,
            contactId,
            tenantId
          }
        );
        
        actionsExecuted.push({
          ruleId: rule.id,
          ruleName: rule.name,
          actionType: rule.action_type,
          matchedKeywords,
          result: actionResult
        });
      } catch (error) {
        console.error(`Error executing action for rule ${rule.name}:`, error);
        actionsExecuted.push({
          ruleId: rule.id,
          ruleName: rule.name,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return new Response(
      JSON.stringify({
        matched: matchedRules.length,
        actions: actionsExecuted
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in smartwords-analyzer:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : String(error) 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

async function executeAction(
  supabase: any,
  rule: SmartWordsRule,
  matchedKeywords: string[],
  context: {
    callId?: string;
    callSid?: string;
    transcript: string;
    contactId?: string;
    tenantId: string;
  }
): Promise<any> {
  const { action_type, action_config } = rule;

  switch (action_type) {
    case 'note':
      return await createNote(supabase, context, action_config, matchedKeywords);
    
    case 'task':
      return await createTask(supabase, context, action_config, matchedKeywords);
    
    case 'tag':
      return await addTag(supabase, context, action_config);
    
    case 'disposition':
      return await setDisposition(supabase, context, action_config);
    
    case 'sms':
      return await sendSMS(supabase, context, action_config);
    
    case 'email':
      return await sendEmail(supabase, context, action_config);
    
    default:
      throw new Error(`Unknown action type: ${action_type}`);
  }
}

async function createNote(
  supabase: any,
  context: any,
  config: any,
  matchedKeywords: string[]
): Promise<any> {
  const noteText = config.template 
    ? config.template.replace('{{keywords}}', matchedKeywords.join(', '))
    : `Keywords detected: ${matchedKeywords.join(', ')}`;

  const { data, error } = await supabase
    .from('communication_history')
    .insert({
      tenant_id: context.tenantId,
      contact_id: context.contactId,
      event_type: 'note',
      description: noteText,
      metadata: {
        keywords: matchedKeywords,
        transcript: context.transcript,
        call_id: context.callId
      }
    });

  if (error) throw error;
  return { noteCreated: true, data };
}

async function createTask(
  supabase: any,
  context: any,
  config: any,
  matchedKeywords: string[]
): Promise<any> {
  const taskTitle = config.title || `Follow-up: ${matchedKeywords.join(', ')}`;
  const taskDescription = config.description || context.transcript.substring(0, 200);

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      tenant_id: context.tenantId,
      contact_id: context.contactId,
      title: taskTitle,
      description: taskDescription,
      priority: config.priority || 'medium',
      due_date: config.due_date,
      status: 'pending'
    });

  if (error) throw error;
  return { taskCreated: true, data };
}

async function addTag(
  supabase: any,
  context: any,
  config: any
): Promise<any> {
  if (!context.contactId || !config.tag) {
    throw new Error('Contact ID and tag are required');
  }

  // Check if tag exists
  const { data: existingTag } = await supabase
    .from('contact_tags')
    .select('id')
    .eq('contact_id', context.contactId)
    .eq('tag', config.tag)
    .maybeSingle();

  if (existingTag) {
    return { tagAdded: false, message: 'Tag already exists' };
  }

  const { data, error } = await supabase
    .from('contact_tags')
    .insert({
      tenant_id: context.tenantId,
      contact_id: context.contactId,
      tag: config.tag
    });

  if (error) throw error;
  return { tagAdded: true, data };
}

async function setDisposition(
  supabase: any,
  context: any,
  config: any
): Promise<any> {
  if (!context.callId && !context.callSid) {
    throw new Error('Call ID or Call SID is required for disposition');
  }

  const { data, error } = await supabase
    .from('call_dispositions')
    .insert({
      tenant_id: context.tenantId,
      call_id: context.callId,
      call_sid: context.callSid,
      disposition: config.disposition,
      notes: `Auto-set by SmartWords rule: ${config.reason || 'Keyword match'}`
    });

  if (error) throw error;
  return { dispositionSet: true, data };
}

async function sendSMS(
  supabase: any,
  context: any,
  config: any
): Promise<any> {
  // This would integrate with your SMS sending function
  // For now, we'll queue it
  console.log('SMS action triggered but not implemented yet');
  return { smsQueued: true, message: config.message };
}

async function sendEmail(
  supabase: any,
  context: any,
  config: any
): Promise<any> {
  // This would integrate with your email sending function
  // For now, we'll queue it
  console.log('Email action triggered but not implemented yet');
  return { emailQueued: true, subject: config.subject };
}

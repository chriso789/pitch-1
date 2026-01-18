import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseService } from '../_shared/supabase.ts';
import { corsHeaders } from '../_shared/cors.ts';

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
    const supabase = supabaseService();

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
  if (!context.contactId) {
    throw new Error('Contact ID is required to send SMS');
  }

  // Get contact phone number
  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .select('phone, first_name, last_name')
    .eq('id', context.contactId)
    .single();

  if (contactError || !contact?.phone) {
    throw new Error('Contact phone number not found');
  }

  // Build message from template
  const messageBody = config.template 
    ? config.template
        .replace('{{first_name}}', contact.first_name || '')
        .replace('{{last_name}}', contact.last_name || '')
    : config.message || 'Follow-up message from PITCH CRM™';

  // Call the SMS send edge function
  const smsResponse = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/sms-send-reply`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({
        to: contact.phone,
        message: messageBody,
        tenantId: context.tenantId,
        contactId: context.contactId
      })
    }
  );

  if (!smsResponse.ok) {
    const errorText = await smsResponse.text();
    console.error('SMS send failed:', errorText);
    throw new Error(`SMS send failed: ${smsResponse.status}`);
  }

  const smsResult = await smsResponse.json();
  console.log('SMS sent successfully:', smsResult);

  return { smsSent: true, messageId: smsResult.message_id, to: contact.phone };
}

async function sendEmail(
  supabase: any,
  context: any,
  config: any
): Promise<any> {
  if (!context.contactId) {
    throw new Error('Contact ID is required to send email');
  }

  // Get contact email
  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .select('email, first_name, last_name')
    .eq('id', context.contactId)
    .single();

  if (contactError || !contact?.email) {
    throw new Error('Contact email not found');
  }

  // Build email content from template
  const subject = config.subject || 'Follow-up from PITCH CRM™';
  const body = config.template 
    ? config.template
        .replace('{{first_name}}', contact.first_name || '')
        .replace('{{last_name}}', contact.last_name || '')
    : config.body || 'Thank you for your interest. We wanted to follow up with you.';

  // Call the email send edge function
  const emailResponse = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/email-send`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({
        to: contact.email,
        subject: subject,
        html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <p>Hi ${contact.first_name || 'there'},</p>
          <p>${body}</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0;" />
          <p style="color: #64748b; font-size: 12px;">
            © ${new Date().getFullYear()} PITCH CRM™. All rights reserved.<br/>
            PITCH™ and PITCH CRM™ are trademarks of PITCH CRM, Inc.
          </p>
        </div>`,
        tenant_id: context.tenantId,
        contact_id: context.contactId
      })
    }
  );

  if (!emailResponse.ok) {
    const errorText = await emailResponse.text();
    console.error('Email send failed:', errorText);
    throw new Error(`Email send failed: ${emailResponse.status}`);
  }

  const emailResult = await emailResponse.json();
  console.log('Email sent successfully:', emailResult);

  return { emailSent: true, messageId: emailResult.id, to: contact.email };
}

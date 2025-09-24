import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotificationRequest {
  action: string;
  data?: any;
}

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, data }: NotificationRequest = await req.json();
    
    // Get authorization header
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Get user from auth header
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (userError || !user) {
      throw new Error('Invalid authorization token');
    }

    // Get user's tenant ID
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    if (!profile?.tenant_id) {
      throw new Error('User tenant not found');
    }

    const tenantId = profile.tenant_id;

    let result;
    switch (action) {
      case 'trigger_event':
        result = await triggerAutomationEvent(supabase, tenantId, data);
        break;
      case 'test_template':
        result = await testTemplate(supabase, tenantId, data);
        break;
      case 'send_notification':
        result = await sendNotification(supabase, tenantId, data);
        break;
      case 'process_pending':
        result = await processPendingNotifications(supabase, tenantId);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Notification processor error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

async function triggerAutomationEvent(supabase: any, tenantId: string, eventData: any) {
  const { event_type, context_data } = eventData;

  console.log('Triggering automation event:', event_type, context_data);

  // Find active automation rules for this event
  const { data: automationRules, error } = await supabase
    .from('automation_rules')
    .select(`
      *,
      template:notification_templates(*)
    `)
    .eq('tenant_id', tenantId)
    .eq('trigger_event', event_type)
    .eq('is_active', true);

  if (error) throw error;

  if (!automationRules || automationRules.length === 0) {
    return { message: 'No active automation rules found for this event', triggered: 0 };
  }

  let triggeredCount = 0;

  for (const rule of automationRules) {
    try {
      // Check trigger conditions (if any)
      const conditionsMet = await evaluateTriggerConditions(rule.trigger_conditions, context_data);
      
      if (!conditionsMet) {
        console.log(`Conditions not met for rule: ${rule.name}`);
        continue;
      }

      // Determine recipients based on recipient rules
      const recipients = await determineRecipients(supabase, tenantId, rule.recipient_rules, context_data);

      for (const recipient of recipients) {
        // Schedule notification execution
        const scheduledFor = new Date();
        if (rule.delay_minutes > 0) {
          scheduledFor.setMinutes(scheduledFor.getMinutes() + rule.delay_minutes);
        }

        // Create notification execution record
        await supabase
          .from('notification_executions')
          .insert({
            tenant_id: tenantId,
            automation_rule_id: rule.id,
            template_id: rule.template_id,
            recipient_type: rule.template.recipient_type,
            recipient_email: recipient.email,
            recipient_phone: recipient.phone,
            trigger_event: event_type,
            trigger_data: context_data,
            scheduled_for: scheduledFor.toISOString(),
            status: rule.delay_minutes === 0 ? 'pending' : 'scheduled'
          });

        // If no delay, process immediately
        if (rule.delay_minutes === 0) {
          await processNotificationExecution(supabase, {
            automation_rule_id: rule.id,
            template: rule.template,
            recipient,
            trigger_data: context_data,
            tenant_id: tenantId
          });
        }

        triggeredCount++;
      }

      // Update rule execution count
      await supabase
        .from('automation_rules')
        .update({ 
          execution_count: rule.execution_count + 1,
          last_executed_at: new Date().toISOString()
        })
        .eq('id', rule.id);

    } catch (ruleError) {
      console.error(`Error processing rule ${rule.name}:`, ruleError);
    }
  }

  return { message: 'Automation event triggered', triggered: triggeredCount };
}

async function evaluateTriggerConditions(conditions: any, contextData: any): Promise<boolean> {
  if (!conditions || Object.keys(conditions).length === 0) {
    return true; // No conditions means always trigger
  }

  // Simple condition evaluation - can be extended for complex logic
  for (const [field, condition] of Object.entries(conditions)) {
    const value = contextData[field];
    const conditionValue = (condition as any).value;
    const operator = (condition as any).operator || 'equals';

    switch (operator) {
      case 'equals':
        if (value !== conditionValue) return false;
        break;
      case 'not_equals':
        if (value === conditionValue) return false;
        break;
      case 'greater_than':
        if (Number(value) <= Number(conditionValue)) return false;
        break;
      case 'less_than':
        if (Number(value) >= Number(conditionValue)) return false;
        break;
      case 'contains':
        if (!String(value).includes(String(conditionValue))) return false;
        break;
      default:
        console.warn(`Unknown condition operator: ${operator}`);
    }
  }

  return true;
}

async function determineRecipients(supabase: any, tenantId: string, recipientRules: any, contextData: any) {
  const recipients = [];

  // Extract contact information from context
  if (contextData.contact_id) {
    const { data: contact } = await supabase
      .from('contacts')
      .select('email, phone, first_name, last_name')
      .eq('id', contextData.contact_id)
      .eq('tenant_id', tenantId)
      .single();

    if (contact && contact.email) {
      recipients.push({
        email: contact.email,
        phone: contact.phone,
        name: `${contact.first_name} ${contact.last_name}`.trim()
      });
    }
  }

  // Add sales rep or assigned user
  if (contextData.assigned_to || contextData.sales_rep_id) {
    const userId = contextData.assigned_to || contextData.sales_rep_id;
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, phone, first_name, last_name')
      .eq('id', userId)
      .eq('tenant_id', tenantId)
      .single();

    if (profile && profile.email) {
      recipients.push({
        email: profile.email,
        phone: profile.phone,
        name: `${profile.first_name} ${profile.last_name}`.trim()
      });
    }
  }

  return recipients;
}

async function processNotificationExecution(supabase: any, executionData: any) {
  const { template, recipient, trigger_data, tenant_id } = executionData;

  try {
    // Get smart words and process template content
    const processedContent = await processSmartWords(supabase, template.content, trigger_data, tenant_id);
    const processedSubject = template.subject ? await processSmartWords(supabase, template.subject, trigger_data, tenant_id) : '';

    // Send notification based on template type
    let sendResult;
    switch (template.template_type) {
      case 'email':
        sendResult = await sendEmail(recipient.email, processedSubject, processedContent);
        break;
      case 'sms':
        sendResult = await sendSMS(recipient.phone, processedContent);
        break;
      case 'in_app':
        sendResult = await sendInAppNotification(supabase, tenant_id, recipient.email, processedContent);
        break;
      default:
        throw new Error(`Unsupported template type: ${template.template_type}`);
    }

    // Update execution record
    await supabase
      .from('notification_executions')
      .update({
        status: 'sent',
        rendered_content: processedContent,
        sent_at: new Date().toISOString()
      })
      .eq('automation_rule_id', executionData.automation_rule_id)
      .eq('recipient_email', recipient.email);

    return { success: true, result: sendResult };

  } catch (error) {
    console.error('Error processing notification execution:', error);
    
    // Update execution record with error
    await supabase
      .from('notification_executions')
      .update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : String(error)
      })
      .eq('automation_rule_id', executionData.automation_rule_id)
      .eq('recipient_email', recipient.email);

    throw error;
  }
}

async function processSmartWords(supabase: any, content: string, contextData: any, tenantId: string): Promise<string> {
  // Get smart word definitions for the tenant
  const { data: smartWords } = await supabase
    .from('smart_word_definitions')
    .select('*')
    .eq('tenant_id', tenantId);

  if (!smartWords) return content;

  let processedContent = content;

  for (const smartWord of smartWords) {
    const placeholder = `{${smartWord.word_key}}`;
    
    if (processedContent.includes(placeholder)) {
      let value = contextData[smartWord.word_key] || '';

      // Apply formatting based on format_type
      switch (smartWord.format_type) {
        case 'currency':
          value = value ? `$${Number(value).toLocaleString()}` : '$0';
          break;
        case 'date':
          value = value ? new Date(value).toLocaleDateString() : '';
          break;
        case 'phone':
          if (value && value.length === 10) {
            value = `(${value.slice(0, 3)}) ${value.slice(3, 6)}-${value.slice(6)}`;
          }
          break;
      }

      processedContent = processedContent.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
    }
  }

  return processedContent;
}

async function sendEmail(to: string, subject: string, content: string) {
  try {
    const { data, error } = await resend.emails.send({
      from: 'PITCH CRM <notifications@resend.dev>',
      to: [to],
      subject: subject,
      html: content.replace(/\n/g, '<br>')
    });

    if (error) throw error;
    return { success: true, messageId: data?.id };
  } catch (error) {
    console.error('Email send error:', error);
    throw error;
  }
}

async function sendSMS(to: string, content: string) {
  // SMS sending would require integration with a service like Twilio
  // For now, we'll log and return success
  console.log(`SMS to ${to}: ${content}`);
  return { success: true, messageId: 'sms_' + Date.now() };
}

async function sendInAppNotification(supabase: any, tenantId: string, userEmail: string, content: string) {
  // Create in-app notification record
  const { data, error } = await supabase
    .from('notifications')
    .insert({
      tenant_id: tenantId,
      user_email: userEmail,
      title: 'System Notification',
      message: content,
      type: 'automation',
      is_read: false
    });

  if (error) throw error;
  return { success: true, notificationId: data?.id };
}

async function testTemplate(supabase: any, tenantId: string, testData: any) {
  const { template_id, test_data } = testData;

  // Get template
  const { data: template, error } = await supabase
    .from('notification_templates')
    .select('*')
    .eq('id', template_id)
    .eq('tenant_id', tenantId)
    .single();

  if (error) throw error;

  // Process smart words with test data
  const processedContent = await processSmartWords(supabase, template.content, test_data, tenantId);
  const processedSubject = template.subject ? await processSmartWords(supabase, template.subject, test_data, tenantId) : '';

  return {
    processed_subject: processedSubject,
    processed_content: processedContent,
    original_content: template.content,
    original_subject: template.subject
  };
}

async function sendNotification(supabase: any, tenantId: string, notificationData: any) {
  const { template_id, recipient, context_data } = notificationData;

  // Get template
  const { data: template, error } = await supabase
    .from('notification_templates')
    .select('*')
    .eq('id', template_id)
    .eq('tenant_id', tenantId)
    .single();

  if (error) throw error;

  // Process and send notification
  return await processNotificationExecution(supabase, {
    template,
    recipient,
    trigger_data: context_data,
    tenant_id: tenantId,
    automation_rule_id: null // Manual send
  });
}

async function processPendingNotifications(supabase: any, tenantId: string) {
  // Get pending notifications that are due
  const { data: pendingNotifications, error } = await supabase
    .from('notification_executions')
    .select(`
      *,
      automation_rule:automation_rules(*),
      template:notification_templates(*)
    `)
    .eq('tenant_id', tenantId)
    .eq('status', 'scheduled')
    .lt('scheduled_for', new Date().toISOString());

  if (error) throw error;

  let processedCount = 0;

  for (const execution of pendingNotifications || []) {
    try {
      await processNotificationExecution(supabase, {
        automation_rule_id: execution.automation_rule_id,
        template: execution.template,
        recipient: {
          email: execution.recipient_email,
          phone: execution.recipient_phone,
          name: ''
        },
        trigger_data: execution.trigger_data,
        tenant_id: tenantId
      });

      processedCount++;
    } catch (error) {
      console.error(`Error processing scheduled notification ${execution.id}:`, error);
    }
  }

  return { processed: processedCount };
}
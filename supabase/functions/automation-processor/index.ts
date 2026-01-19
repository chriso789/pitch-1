import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Initialize clients
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const resendApiKey = Deno.env.get('RESEND_API_KEY');
const telnyxApiKey = Deno.env.get('TELNYX_API_KEY');
const telnyxPhoneNumber = Deno.env.get('TELNYX_PHONE_NUMBER');

const resend = resendApiKey ? new Resend(resendApiKey) : null;

// ============================================
// TYPES
// ============================================

interface AutomationRequest {
  event_type: string;
  context: Record<string, any>;
}

interface Trigger {
  type: string;
  params?: Record<string, any>;
}

interface Condition {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'contains';
  value: any;
}

interface Action {
  type: 'send_email' | 'send_sms' | 'assign_task' | 'change_status' | 'webhook' | 'push_doc' | 'create_payment_link';
  params: Record<string, any>;
}

interface Automation {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  triggers: Trigger[];
  conditions: Condition[];
  actions: Action[];
  condition_logic: 'and' | 'or';
  is_active: boolean;
}

// ============================================
// MAIN HANDLER
// ============================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { event_type, context }: AutomationRequest = await req.json();
    
    if (!event_type) {
      throw new Error('event_type is required');
    }

    // Get authorization header
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Get user from auth header
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (userError || !user) {
      throw new Error('Invalid authorization token');
    }

    // Get user's tenant
    const { data: profile } = await supabase
      .from('profiles')
      .select('active_tenant_id, tenant_id')
      .eq('id', user.id)
      .single();

    const tenantId = profile?.active_tenant_id || profile?.tenant_id;
    if (!tenantId) {
      throw new Error('User tenant not found');
    }

    console.log(`Processing automation event: ${event_type} for tenant ${tenantId}`);

    // Fetch active automations matching trigger type
    const { data: automations, error: fetchError } = await supabase
      .from('automations')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true);

    if (fetchError) throw fetchError;

    // Filter automations that have matching trigger
    const matchingAutomations = (automations || []).filter((automation: any) => {
      const triggers = automation.triggers || [];
      return triggers.some((trigger: Trigger) => trigger.type === event_type);
    });

    console.log(`Found ${matchingAutomations.length} matching automations`);

    let executedCount = 0;
    const results: any[] = [];

    for (const automation of matchingAutomations) {
      try {
        // Evaluate conditions
        const conditionsPassed = evaluateConditions(
          automation.conditions || [],
          automation.condition_logic || 'and',
          context
        );

        if (!conditionsPassed) {
          console.log(`Conditions not met for automation: ${automation.name}`);
          await logExecution(supabase, automation, event_type, context, 'skipped', { reason: 'Conditions not met' });
          continue;
        }

        // Execute actions
        const actions = automation.actions || [];
        const actionResults: any[] = [];

        for (const action of actions) {
          try {
            const result = await executeAction(supabase, tenantId, action, context);
            actionResults.push({ action: action.type, success: true, result });
          } catch (actionError) {
            console.error(`Action ${action.type} failed:`, actionError);
            actionResults.push({ action: action.type, success: false, error: String(actionError) });
          }
        }

        await logExecution(supabase, automation, event_type, context, 'success', { actions: actionResults });
        executedCount++;
        results.push({ automation_id: automation.id, name: automation.name, actions: actionResults });

      } catch (automationError) {
        console.error(`Error processing automation ${automation.name}:`, automationError);
        await logExecution(supabase, automation, event_type, context, 'error', { error: String(automationError) });
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        event_type,
        automations_matched: matchingAutomations.length,
        automations_executed: executedCount,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Automation processor error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ============================================
// CONDITION EVALUATION
// ============================================

function evaluateConditions(
  conditions: Condition[],
  logic: 'and' | 'or',
  context: Record<string, any>
): boolean {
  if (!conditions || conditions.length === 0) {
    return true; // No conditions = always pass
  }

  const results = conditions.map(condition => evaluateCondition(condition, context));

  if (logic === 'or') {
    return results.some(r => r);
  }
  return results.every(r => r);
}

function evaluateCondition(condition: Condition, context: Record<string, any>): boolean {
  const { field, operator, value } = condition;
  
  // Support nested field access (e.g., "contact.status")
  const contextValue = getNestedValue(context, field);

  switch (operator) {
    case 'eq':
      return contextValue === value;
    case 'ne':
      return contextValue !== value;
    case 'gt':
      return Number(contextValue) > Number(value);
    case 'gte':
      return Number(contextValue) >= Number(value);
    case 'lt':
      return Number(contextValue) < Number(value);
    case 'lte':
      return Number(contextValue) <= Number(value);
    case 'in':
      return Array.isArray(value) ? value.includes(contextValue) : false;
    case 'nin':
      return Array.isArray(value) ? !value.includes(contextValue) : true;
    case 'contains':
      return String(contextValue).toLowerCase().includes(String(value).toLowerCase());
    default:
      console.warn(`Unknown operator: ${operator}`);
      return false;
  }
}

function getNestedValue(obj: Record<string, any>, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

// ============================================
// ACTION EXECUTION
// ============================================

async function executeAction(
  supabase: any,
  tenantId: string,
  action: Action,
  context: Record<string, any>
): Promise<any> {
  const { type, params } = action;

  switch (type) {
    case 'send_email':
      return await sendEmail(supabase, tenantId, params, context);
    case 'send_sms':
      return await sendSMS(supabase, tenantId, params, context);
    case 'assign_task':
      return await assignTask(supabase, tenantId, params, context);
    case 'change_status':
      return await changeStatus(supabase, tenantId, params, context);
    case 'webhook':
      return await sendWebhook(params, context);
    case 'push_doc':
      return await pushDocument(supabase, tenantId, params, context);
    case 'create_payment_link':
      return await createPaymentLink(supabase, tenantId, params, context);
    default:
      throw new Error(`Unknown action type: ${type}`);
  }
}

// ============================================
// ACTION IMPLEMENTATIONS
// ============================================

async function sendEmail(
  supabase: any,
  tenantId: string,
  params: Record<string, any>,
  context: Record<string, any>
) {
  if (!resend) {
    console.log('Resend not configured, skipping email');
    return { skipped: true, reason: 'Resend not configured' };
  }

  // Resolve recipient
  const recipientEmail = resolveRecipient(params.recipient_type, context, 'email');
  if (!recipientEmail) {
    throw new Error('No valid email recipient found');
  }

  // Resolve dynamic tags in subject and body
  const subject = await resolveDynamicTags(supabase, tenantId, params.subject || 'Notification', context);
  const body = await resolveDynamicTags(supabase, tenantId, params.body || '', context);

  const { data, error } = await resend.emails.send({
    from: params.from || 'PITCH CRM <notifications@resend.dev>',
    to: [recipientEmail],
    subject,
    html: body.replace(/\n/g, '<br>')
  });

  if (error) throw error;
  return { success: true, messageId: data?.id, to: recipientEmail };
}

async function sendSMS(
  supabase: any,
  tenantId: string,
  params: Record<string, any>,
  context: Record<string, any>
) {
  if (!telnyxApiKey || !telnyxPhoneNumber) {
    console.log('Telnyx not configured, skipping SMS');
    return { skipped: true, reason: 'Telnyx not configured' };
  }

  // Resolve recipient phone
  const recipientPhone = resolveRecipient(params.recipient_type, context, 'phone');
  if (!recipientPhone) {
    throw new Error('No valid phone recipient found');
  }

  // Resolve dynamic tags in message
  const message = await resolveDynamicTags(supabase, tenantId, params.message || '', context);

  // Send via Telnyx
  const response = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${telnyxApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: telnyxPhoneNumber,
      to: recipientPhone,
      text: message
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telnyx error: ${error}`);
  }

  const result = await response.json();
  return { success: true, messageId: result.data?.id, to: recipientPhone };
}

async function assignTask(
  supabase: any,
  tenantId: string,
  params: Record<string, any>,
  context: Record<string, any>
) {
  // Calculate due date based on offset
  const dueDateOffset = params.due_date_offset || 0; // hours
  const dueAt = new Date();
  dueAt.setHours(dueAt.getHours() + dueDateOffset);

  // Resolve assignee
  let assignedTo = params.assigned_to;
  if (params.assignee_type === 'sales_rep') {
    assignedTo = context.sales_rep_id || context.assigned_to;
  } else if (params.assignee_type === 'project_manager') {
    assignedTo = context.project_manager_id;
  }

  // Resolve dynamic tags in title and description
  const title = await resolveDynamicTags(supabase, tenantId, params.title || 'New Task', context);
  const description = await resolveDynamicTags(supabase, tenantId, params.description || '', context);

  const { data, error } = await supabase
    .from('workflow_tasks')
    .insert({
      tenant_id: tenantId,
      task_name: title,
      description,
      current_phase: 'planning',
      is_active: true,
      ai_context: {
        automation_created: true,
        priority: params.priority || 'medium',
        due_at: dueAt.toISOString(),
        assigned_to: assignedTo,
        related_context: {
          contact_id: context.contact_id,
          job_id: context.job_id,
          project_id: context.project_id
        }
      }
    })
    .select()
    .single();

  if (error) throw error;
  return { success: true, task_id: data.id };
}

async function changeStatus(
  supabase: any,
  tenantId: string,
  params: Record<string, any>,
  context: Record<string, any>
) {
  const { entity_type, new_status, status_field = 'status' } = params;
  
  let table: string;
  let idField: string;
  let recordId: string;

  switch (entity_type) {
    case 'contact':
    case 'lead':
      table = 'contacts';
      idField = 'contact_id';
      recordId = context.contact_id;
      break;
    case 'job':
      table = 'jobs';
      idField = 'job_id';
      recordId = context.job_id;
      break;
    case 'project':
      table = 'projects';
      idField = 'project_id';
      recordId = context.project_id;
      break;
    case 'pipeline_entry':
      table = 'pipeline_entries';
      idField = 'pipeline_entry_id';
      recordId = context.pipeline_entry_id;
      break;
    default:
      throw new Error(`Unknown entity type: ${entity_type}`);
  }

  if (!recordId) {
    throw new Error(`No ${idField} found in context`);
  }

  const { error } = await supabase
    .from(table)
    .update({ [status_field]: new_status, updated_at: new Date().toISOString() })
    .eq('id', recordId)
    .eq('tenant_id', tenantId);

  if (error) throw error;
  return { success: true, entity_type, record_id: recordId, new_status };
}

async function sendWebhook(
  params: Record<string, any>,
  context: Record<string, any>
) {
  const { url, method = 'POST', headers = {} } = params;

  if (!url) {
    throw new Error('Webhook URL is required');
  }

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify({
      event: context.event_type,
      data: context,
      timestamp: new Date().toISOString()
    })
  });

  return {
    success: response.ok,
    status: response.status,
    statusText: response.statusText
  };
}

async function pushDocument(
  supabase: any,
  tenantId: string,
  params: Record<string, any>,
  context: Record<string, any>
) {
  const { template_id, recipient_type } = params;

  if (!template_id) {
    throw new Error('Document template_id is required');
  }

  // Call render-liquid function to generate document
  const renderResponse = await fetch(`${supabaseUrl}/functions/v1/render-liquid`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      template_id,
      context_data: context
    })
  });

  if (!renderResponse.ok) {
    const error = await renderResponse.text();
    throw new Error(`Document render failed: ${error}`);
  }

  const renderResult = await renderResponse.json();

  // Send rendered document via email
  const recipientEmail = resolveRecipient(recipient_type, context, 'email');
  if (recipientEmail && resend) {
    await resend.emails.send({
      from: 'PITCH CRM <documents@resend.dev>',
      to: [recipientEmail],
      subject: params.email_subject || 'Document from PITCH CRM',
      html: renderResult.html || renderResult.content
    });
  }

  return { success: true, rendered: true, sent_to: recipientEmail };
}

async function createPaymentLink(
  supabase: any,
  tenantId: string,
  params: Record<string, any>,
  context: Record<string, any>
) {
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeSecretKey) {
    return { skipped: true, reason: 'Stripe not configured' };
  }

  const amount = params.amount || context.amount || context.contract_value;
  if (!amount) {
    throw new Error('Amount is required for payment link');
  }

  // Create Stripe payment link
  const response = await fetch('https://api.stripe.com/v1/payment_links', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][product_data][name]': params.product_name || 'Payment',
      'line_items[0][price_data][unit_amount]': String(Math.round(Number(amount) * 100)),
      'line_items[0][quantity]': '1'
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Stripe error: ${error}`);
  }

  const paymentLink = await response.json();

  // Send payment link via email or SMS
  const recipientEmail = resolveRecipient(params.recipient_type, context, 'email');
  if (recipientEmail && resend) {
    await resend.emails.send({
      from: 'PITCH CRM <payments@resend.dev>',
      to: [recipientEmail],
      subject: params.email_subject || 'Payment Link',
      html: `<p>Please complete your payment using this link:</p><p><a href="${paymentLink.url}">${paymentLink.url}</a></p>`
    });
  }

  return { success: true, payment_link: paymentLink.url, sent_to: recipientEmail };
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function resolveRecipient(
  recipientType: string,
  context: Record<string, any>,
  field: 'email' | 'phone'
): string | null {
  switch (recipientType) {
    case 'homeowner':
    case 'contact':
      return context[`contact_${field}`] || context[field];
    case 'sales_rep':
      return context[`sales_rep_${field}`] || context[`assigned_${field}`];
    case 'project_manager':
      return context[`pm_${field}`] || context[`manager_${field}`];
    case 'custom':
      return context[`custom_${field}`];
    default:
      return context[field] || context[`contact_${field}`];
  }
}

async function resolveDynamicTags(
  supabase: any,
  tenantId: string,
  content: string,
  context: Record<string, any>
): Promise<string> {
  if (!content) return content;

  // Fetch dynamic tags for tenant
  const { data: dynamicTags } = await supabase
    .from('dynamic_tags')
    .select('*')
    .eq('tenant_id', tenantId);

  let resolved = content;

  // Replace standard context values first
  const tagPattern = /\{\{([^}]+)\}\}/g;
  resolved = resolved.replace(tagPattern, (match, path) => {
    const value = getNestedValue(context, path.trim());
    return value !== undefined ? String(value) : match;
  });

  // Replace dynamic tags if defined
  if (dynamicTags) {
    for (const tag of dynamicTags) {
      const placeholder = `{{${tag.tag_key}}}`;
      if (resolved.includes(placeholder)) {
        const value = getNestedValue(context, tag.json_path || tag.tag_key);
        resolved = resolved.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value || tag.default_value || '');
      }
    }
  }

  return resolved;
}

async function logExecution(
  supabase: any,
  automation: Automation,
  eventType: string,
  context: Record<string, any>,
  outcome: 'success' | 'skipped' | 'error',
  result: any
) {
  try {
    await supabase
      .from('automation_logs')
      .insert({
        tenant_id: automation.tenant_id,
        automation_id: automation.id,
        event: eventType,
        cause: `Triggered by ${eventType}`,
        input: context,
        outcome,
        result,
        fired_at: new Date().toISOString()
      });
  } catch (error) {
    console.error('Failed to log automation execution:', error);
  }
}

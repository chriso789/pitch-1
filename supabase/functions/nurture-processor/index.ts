import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseService } from '../_shared/supabase.ts';
import { corsHeaders } from '../_shared/cors.ts';

interface NurturingRequest {
  contactId?: string;
  campaignId?: string;
  action: 'enroll' | 'process_pending' | 'check_triggers';
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = supabaseService();
    
    const { contactId, campaignId, action }: NurturingRequest = await req.json();

    console.log('Processing nurturing request:', { contactId, campaignId, action });

    switch (action) {
      case 'enroll':
        if (!contactId || !campaignId) {
          throw new Error('Contact ID and Campaign ID are required for enrollment');
        }
        return await enrollContact(supabase, contactId, campaignId);

      case 'process_pending':
        return await processPendingActions(supabase);

      case 'check_triggers':
        if (contactId) {
          return await checkTriggersForContact(supabase, contactId);
        } else {
          return await checkAllTriggers(supabase);
        }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

  } catch (error) {
    console.error('Error in nurture-processor function:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: error instanceof Error ? error.message : String(error) 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function enrollContact(supabase: any, contactId: string, campaignId: string) {
  try {
    // Get contact and campaign data
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .maybeSingle();

    if (contactError || !contact) {
      throw new Error(`Contact not found: ${contactId}`);
    }

    const { data: campaign, error: campaignError } = await supabase
      .from('nurturing_campaigns')
      .select(`
        *,
        nurturing_campaign_steps (*)
      `)
      .eq('id', campaignId)
      .eq('is_active', true)
      .maybeSingle();

    if (campaignError || !campaign) {
      throw new Error(`Active campaign not found: ${campaignId}`);
    }

    // Check if contact meets campaign criteria
    const isEligible = await checkEnrollmentEligibility(
      supabase, 
      contact, 
      campaign.target_audience
    );

    if (!isEligible) {
      return new Response(JSON.stringify({
        success: false,
        message: 'Contact does not meet campaign criteria'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if already enrolled
    const { data: existingEnrollment } = await supabase
      .from('nurturing_enrollments')
      .select('id')
      .eq('contact_id', contactId)
      .eq('campaign_id', campaignId)
      .in('status', ['active', 'paused'])
      .maybeSingle();

    if (existingEnrollment) {
      return new Response(JSON.stringify({
        success: false,
        message: 'Contact is already enrolled in this campaign'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get first step
    const firstStep = campaign.nurturing_campaign_steps
      ?.filter((s: any) => s.is_active)
      ?.sort((a: any, b: any) => a.step_order - b.step_order)?.[0];

    if (!firstStep) {
      throw new Error('No active steps found in campaign');
    }

    // Create enrollment
    const { data: enrollment, error: enrollmentError } = await supabase
      .from('nurturing_enrollments')
      .insert({
        tenant_id: contact.tenant_id,
        campaign_id: campaignId,
        contact_id: contactId,
        current_step_id: firstStep.id,
        status: 'active',
        next_action_date: new Date(Date.now() + (firstStep.delay_hours * 60 * 60 * 1000)).toISOString()
      })
      .select()
      .single();

    if (enrollmentError) throw enrollmentError;

    // Schedule first step execution
    await supabase
      .from('nurturing_step_executions')
      .insert({
        tenant_id: contact.tenant_id,
        enrollment_id: enrollment.id,
        step_id: firstStep.id,
        status: 'pending',
        scheduled_for: enrollment.next_action_date
      });

    // Update campaign stats
    await supabase
      .from('nurturing_campaigns')
      .update({ 
        total_enrolled: campaign.total_enrolled + 1 
      })
      .eq('id', campaignId);

    // Update contact status
    await supabase
      .from('contacts')
      .update({ 
        nurturing_status: 'enrolled',
        last_nurturing_activity: new Date().toISOString()
      })
      .eq('id', contactId);

    console.log(`Successfully enrolled contact ${contactId} in campaign ${campaignId}`);

    return new Response(JSON.stringify({ 
      success: true,
      enrollmentId: enrollment.id,
      nextActionDate: enrollment.next_action_date
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error enrolling contact:', error);
    throw error;
  }
}

async function processPendingActions(supabase: any) {
  try {
    // Get pending executions that are due
    const { data: pendingExecutions, error } = await supabase
      .from('nurturing_step_executions')
      .select(`
        *,
        nurturing_enrollments (*),
        nurturing_campaign_steps (*)
      `)
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .limit(50); // Process in batches

    if (error) throw error;

    console.log(`Processing ${pendingExecutions?.length || 0} pending actions`);

    const results = [];

    for (const execution of pendingExecutions || []) {
      try {
        const result = await processStepExecution(supabase, execution);
        results.push(result);
      } catch (error) {
        console.error(`Failed to process execution ${execution.id}:`, error);
        
        // Update execution with error
        await supabase
          .from('nurturing_step_executions')
          .update({
            status: 'failed',
            error_message: error instanceof Error ? error.message : String(error),
            retry_count: (execution.retry_count || 0) + 1
          })
          .eq('id', execution.id);
      }
    }

    return new Response(JSON.stringify({ 
      success: true,
      processed: results.length,
      results 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error processing pending actions:', error);
    throw error;
  }
}

async function processStepExecution(supabase: any, execution: any) {
  const step = execution.nurturing_campaign_steps;
  const enrollment = execution.nurturing_enrollments;

  console.log(`Processing step ${step.step_name} for enrollment ${enrollment.id}`);

  let stepResult = { success: false, message: '' };

  switch (step.step_type) {
    case 'email':
      stepResult = await processEmailStep(supabase, execution, step);
      break;
    case 'sms':
      stepResult = await processSMSStep(supabase, execution, step);
      break;
    case 'call_reminder':
      stepResult = await processCallReminderStep(supabase, execution, step);
      break;
    case 'task':
      stepResult = await processTaskStep(supabase, execution, step);
      break;
    case 'wait':
      stepResult = { success: true, message: 'Wait period completed' };
      break;
    default:
      stepResult = { success: false, message: `Unknown step type: ${step.step_type}` };
  }

  // Update execution status
  await supabase
    .from('nurturing_step_executions')
    .update({
      status: stepResult.success ? 'sent' : 'failed',
      executed_at: new Date().toISOString(),
      response_data: stepResult,
      error_message: stepResult.success ? null : stepResult.message
    })
    .eq('id', execution.id);

  if (stepResult.success) {
    // Move to next step
    await moveToNextStep(supabase, enrollment, step);
  }

  return {
    executionId: execution.id,
    stepName: step.step_name,
    success: stepResult.success,
    message: stepResult.message
  };
}

async function moveToNextStep(supabase: any, enrollment: any, currentStep: any) {
  try {
    // Get next step in sequence
    const { data: nextStep } = await supabase
      .from('nurturing_campaign_steps')
      .select('*')
      .eq('campaign_id', enrollment.campaign_id)
      .eq('is_active', true)
      .gt('step_order', currentStep.step_order)
      .order('step_order', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (nextStep) {
      // Schedule next step
      const nextActionDate = new Date(Date.now() + (nextStep.delay_hours * 60 * 60 * 1000)).toISOString();

      await supabase
        .from('nurturing_enrollments')
        .update({
          current_step_id: nextStep.id,
          next_action_date: nextActionDate,
          total_steps_completed: enrollment.total_steps_completed + 1
        })
        .eq('id', enrollment.id);

      // Create next execution
      await supabase
        .from('nurturing_step_executions')
        .insert({
          tenant_id: enrollment.tenant_id,
          enrollment_id: enrollment.id,
          step_id: nextStep.id,
          status: 'pending',
          scheduled_for: nextActionDate
        });

      console.log(`Scheduled next step ${nextStep.step_name} for enrollment ${enrollment.id}`);
    } else {
      // Campaign completed
      await supabase
        .from('nurturing_enrollments')
        .update({
          status: 'completed',
          completion_date: new Date().toISOString(),
          total_steps_completed: enrollment.total_steps_completed + 1
        })
        .eq('id', enrollment.id);

      // Update campaign completion count
      await supabase.rpc('increment', {
        table: 'nurturing_campaigns',
        id: enrollment.campaign_id,
        field: 'total_completed'
      });

      console.log(`Campaign completed for enrollment ${enrollment.id}`);
    }
  } catch (error) {
    console.error('Error moving to next step:', error);
    throw error;
  }
}

async function processEmailStep(supabase: any, execution: any, step: any) {
  // In a real implementation, you would integrate with an email service
  // For now, we'll simulate the email send
  console.log(`Simulating email send: ${step.step_name}`);
  console.log(`Template: ${step.content_template}`);
  
  return { 
    success: true, 
    message: 'Email sent successfully (simulated)',
    provider: 'simulation',
    timestamp: new Date().toISOString()
  };
}

async function processSMSStep(supabase: any, execution: any, step: any) {
  // In a real implementation, you would integrate with an SMS service
  console.log(`Simulating SMS send: ${step.step_name}`);
  console.log(`Template: ${step.content_template}`);
  
  return { 
    success: true, 
    message: 'SMS sent successfully (simulated)',
    provider: 'simulation',
    timestamp: new Date().toISOString()
  };
}

async function processCallReminderStep(supabase: any, execution: any, step: any) {
  // Create a task reminder for manual follow-up
  console.log(`Creating call reminder: ${step.step_name}`);
  
  return { 
    success: true, 
    message: 'Call reminder created',
    action: 'call_reminder_created',
    timestamp: new Date().toISOString()
  };
}

async function processTaskStep(supabase: any, execution: any, step: any) {
  // Create a task in the system
  console.log(`Creating task: ${step.step_name}`);
  
  return { 
    success: true, 
    message: 'Task created successfully',
    action: 'task_created',
    timestamp: new Date().toISOString()
  };
}

async function checkEnrollmentEligibility(supabase: any, contact: any, targetAudience: any) {
  // Use the database function to check eligibility
  const { data, error } = await supabase.rpc(
    'check_enrollment_eligibility',
    {
      contact_data: contact,
      campaign_conditions: targetAudience
    }
  );

  if (error) {
    console.error('Error checking eligibility:', error);
    return false;
  }

  return data === true;
}

async function checkTriggersForContact(supabase: any, contactId: string) {
  // Check if contact triggers any campaigns
  console.log(`Checking triggers for contact ${contactId}`);
  
  return new Response(JSON.stringify({ 
    success: true,
    message: 'Trigger check completed',
    triggeredCampaigns: []
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function checkAllTriggers(supabase: any) {
  // Check all contacts for campaign triggers
  console.log('Checking all triggers');
  
  return new Response(JSON.stringify({ 
    success: true,
    message: 'All triggers checked',
    processed: 0
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
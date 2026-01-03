import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SequenceEngineRequest {
  action: 'process' | 'send_step' | 'check_engagement' | 'pause_all' | 'resume_all';
  tenant_id: string;
  enrollment_id?: string;
  sequence_id?: string;
  batch_size?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: SequenceEngineRequest = await req.json();
    const { action, tenant_id, enrollment_id, sequence_id, batch_size = 50 } = body;

    if (!action || !tenant_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing action or tenant_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    switch (action) {
      case 'process': {
        // Process due email sequence steps
        const now = new Date().toISOString();
        
        const { data: dueEnrollments, error } = await supabaseAdmin
          .from('email_sequence_enrollments')
          .select(`
            id, sequence_id, contact_id, current_step, tenant_id,
            contact:contact_id(id, first_name, last_name, email),
            sequence:sequence_id(id, name, is_active)
          `)
          .eq('tenant_id', tenant_id)
          .eq('status', 'active')
          .lte('next_send_at', now)
          .limit(batch_size);

        if (error) {
          console.error('[email-sequence-engine] Process error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to fetch due enrollments' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const results = {
          processed: 0,
          sent: 0,
          completed: 0,
          errors: 0
        };

        for (const enrollment of dueEnrollments || []) {
          results.processed++;
          
          // Skip if sequence is not active
          if (!enrollment.sequence?.is_active) {
            await supabaseAdmin
              .from('email_sequence_enrollments')
              .update({ status: 'paused' })
              .eq('id', enrollment.id);
            continue;
          }

          // Get current step
          const { data: step } = await supabaseAdmin
            .from('email_sequence_steps')
            .select('*')
            .eq('sequence_id', enrollment.sequence_id)
            .eq('step_order', enrollment.current_step)
            .eq('is_active', true)
            .single();

          if (!step) {
            // No more steps, mark as completed
            await supabaseAdmin
              .from('email_sequence_enrollments')
              .update({ 
                status: 'completed',
                completed_at: now
              })
              .eq('id', enrollment.id);
            results.completed++;
            continue;
          }

          // Send email using messaging-send-email function
          const contact = enrollment.contact;
          if (!contact?.email) {
            results.errors++;
            continue;
          }

          // Personalize content
          const personalizedSubject = personalizeContent(step.subject, contact);
          const personalizedBody = personalizeContent(step.body_html, contact);

          // Queue email
          await supabaseAdmin
            .from('message_queue')
            .insert({
              tenant_id,
              channel: 'email',
              recipient: contact.email,
              subject: personalizedSubject,
              body: personalizedBody,
              metadata: {
                sequence_id: enrollment.sequence_id,
                enrollment_id: enrollment.id,
                step_id: step.id
              }
            });

          results.sent++;

          // Calculate next send time
          const nextStep = await supabaseAdmin
            .from('email_sequence_steps')
            .select('step_order, delay_days, delay_hours')
            .eq('sequence_id', enrollment.sequence_id)
            .eq('step_order', enrollment.current_step + 1)
            .single();

          if (nextStep.data) {
            const nextSendAt = new Date();
            nextSendAt.setDate(nextSendAt.getDate() + (nextStep.data.delay_days || 0));
            nextSendAt.setHours(nextSendAt.getHours() + (nextStep.data.delay_hours || 0));

            await supabaseAdmin
              .from('email_sequence_enrollments')
              .update({
                current_step: enrollment.current_step + 1,
                next_send_at: nextSendAt.toISOString()
              })
              .eq('id', enrollment.id);
          } else {
            // No next step, mark completed after this send
            await supabaseAdmin
              .from('email_sequence_enrollments')
              .update({
                status: 'completed',
                completed_at: now
              })
              .eq('id', enrollment.id);
            results.completed++;
          }
        }

        console.log(`[email-sequence-engine] Processed ${results.processed} enrollments, sent ${results.sent} emails`);
        return new Response(
          JSON.stringify({ success: true, data: results }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'send_step': {
        if (!enrollment_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'enrollment_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Force send next step immediately
        const { data: enrollment } = await supabaseAdmin
          .from('email_sequence_enrollments')
          .select(`
            *, 
            contact:contact_id(id, first_name, last_name, email)
          `)
          .eq('id', enrollment_id)
          .single();

        if (!enrollment) {
          return new Response(
            JSON.stringify({ success: false, error: 'Enrollment not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Update next_send_at to now
        await supabaseAdmin
          .from('email_sequence_enrollments')
          .update({ next_send_at: new Date().toISOString() })
          .eq('id', enrollment_id);

        return new Response(
          JSON.stringify({ success: true, message: 'Step queued for immediate sending' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'check_engagement': {
        // Check for email engagement to potentially skip or modify sequence
        const { data: engagements } = await supabaseAdmin
          .from('email_sequence_enrollments')
          .select('id, contact_id, sequence_id')
          .eq('tenant_id', tenant_id)
          .eq('status', 'active');

        // Would check email opens, clicks, replies here
        return new Response(
          JSON.stringify({ success: true, data: { checked: engagements?.length || 0 } }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'pause_all': {
        if (!sequence_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'sequence_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { count } = await supabaseAdmin
          .from('email_sequence_enrollments')
          .update({ status: 'paused' })
          .eq('sequence_id', sequence_id)
          .eq('status', 'active');

        console.log(`[email-sequence-engine] Paused ${count} enrollments for sequence ${sequence_id}`);
        return new Response(
          JSON.stringify({ success: true, data: { paused: count } }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'resume_all': {
        if (!sequence_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'sequence_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { count } = await supabaseAdmin
          .from('email_sequence_enrollments')
          .update({ 
            status: 'active',
            next_send_at: new Date().toISOString()
          })
          .eq('sequence_id', sequence_id)
          .eq('status', 'paused');

        console.log(`[email-sequence-engine] Resumed ${count} enrollments for sequence ${sequence_id}`);
        return new Response(
          JSON.stringify({ success: true, data: { resumed: count } }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

  } catch (error) {
    console.error('[email-sequence-engine] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function personalizeContent(content: string, contact: Record<string, unknown>): string {
  return content
    .replace(/\{\{first_name\}\}/g, String(contact.first_name || 'there'))
    .replace(/\{\{last_name\}\}/g, String(contact.last_name || ''))
    .replace(/\{\{email\}\}/g, String(contact.email || ''))
    .replace(/\{\{full_name\}\}/g, `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'there');
}

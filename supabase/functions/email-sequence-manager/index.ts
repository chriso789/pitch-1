import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SequenceManagerRequest {
  action: 'create' | 'update' | 'delete' | 'list' | 'get' | 'add_step' | 'update_step' | 'delete_step' | 'enroll' | 'unenroll' | 'clone';
  tenant_id: string;
  sequence_id?: string;
  step_id?: string;
  contact_id?: string;
  data?: Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: SequenceManagerRequest = await req.json();
    const { action, tenant_id, sequence_id, step_id, contact_id, data } = body;

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

    // Get user from auth
    const authHeader = req.headers.get('authorization');
    let userId: string | null = null;
    if (authHeader) {
      const { data: { user } } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
      userId = user?.id ?? null;
    }

    switch (action) {
      case 'create': {
        const { data: sequence, error } = await supabaseAdmin
          .from('email_sequences')
          .insert({
            tenant_id,
            name: data?.name || 'New Sequence',
            description: data?.description,
            trigger_type: data?.trigger_type || 'manual',
            is_active: false,
            created_by: userId
          })
          .select()
          .single();

        if (error) {
          console.error('[email-sequence-manager] Create error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to create sequence' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[email-sequence-manager] Created sequence: ${sequence.id}`);
        return new Response(
          JSON.stringify({ success: true, data: sequence }),
          { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'update': {
        if (!sequence_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'sequence_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: sequence, error } = await supabaseAdmin
          .from('email_sequences')
          .update({
            ...data,
            updated_at: new Date().toISOString()
          })
          .eq('id', sequence_id)
          .eq('tenant_id', tenant_id)
          .select()
          .single();

        if (error) {
          console.error('[email-sequence-manager] Update error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to update sequence' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, data: sequence }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'delete': {
        if (!sequence_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'sequence_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { error } = await supabaseAdmin
          .from('email_sequences')
          .delete()
          .eq('id', sequence_id)
          .eq('tenant_id', tenant_id);

        if (error) {
          console.error('[email-sequence-manager] Delete error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to delete sequence' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'list': {
        const { data: sequences, error } = await supabaseAdmin
          .from('email_sequences')
          .select(`
            *,
            email_sequence_steps(count),
            email_sequence_enrollments(count)
          `)
          .eq('tenant_id', tenant_id)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('[email-sequence-manager] List error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to list sequences' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, data: sequences }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get': {
        if (!sequence_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'sequence_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: sequence, error } = await supabaseAdmin
          .from('email_sequences')
          .select(`
            *,
            email_sequence_steps(*)
          `)
          .eq('id', sequence_id)
          .eq('tenant_id', tenant_id)
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ success: false, error: 'Sequence not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, data: sequence }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'add_step': {
        if (!sequence_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'sequence_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get max step order
        const { data: maxStep } = await supabaseAdmin
          .from('email_sequence_steps')
          .select('step_order')
          .eq('sequence_id', sequence_id)
          .order('step_order', { ascending: false })
          .limit(1)
          .single();

        const nextOrder = (maxStep?.step_order || 0) + 1;

        const { data: step, error } = await supabaseAdmin
          .from('email_sequence_steps')
          .insert({
            sequence_id,
            step_order: nextOrder,
            delay_days: data?.delay_days || 0,
            delay_hours: data?.delay_hours || 0,
            subject: data?.subject || 'Email Subject',
            body_html: data?.body_html || '<p>Email body</p>',
            body_text: data?.body_text,
            ab_variant: data?.ab_variant
          })
          .select()
          .single();

        if (error) {
          console.error('[email-sequence-manager] Add step error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to add step' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, data: step }),
          { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'update_step': {
        if (!step_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'step_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: step, error } = await supabaseAdmin
          .from('email_sequence_steps')
          .update({
            ...data,
            updated_at: new Date().toISOString()
          })
          .eq('id', step_id)
          .select()
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to update step' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, data: step }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'delete_step': {
        if (!step_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'step_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { error } = await supabaseAdmin
          .from('email_sequence_steps')
          .delete()
          .eq('id', step_id);

        if (error) {
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to delete step' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'enroll': {
        if (!sequence_id || !contact_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'sequence_id and contact_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Check if already enrolled
        const { data: existing } = await supabaseAdmin
          .from('email_sequence_enrollments')
          .select('id')
          .eq('sequence_id', sequence_id)
          .eq('contact_id', contact_id)
          .eq('status', 'active')
          .single();

        if (existing) {
          return new Response(
            JSON.stringify({ success: false, error: 'Contact already enrolled' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get first step delay
        const { data: firstStep } = await supabaseAdmin
          .from('email_sequence_steps')
          .select('delay_days, delay_hours')
          .eq('sequence_id', sequence_id)
          .eq('step_order', 1)
          .single();

        const nextSend = new Date();
        if (firstStep) {
          nextSend.setDate(nextSend.getDate() + (firstStep.delay_days || 0));
          nextSend.setHours(nextSend.getHours() + (firstStep.delay_hours || 0));
        }

        const { data: enrollment, error } = await supabaseAdmin
          .from('email_sequence_enrollments')
          .insert({
            tenant_id,
            sequence_id,
            contact_id,
            current_step: 1,
            status: 'active',
            next_send_at: nextSend.toISOString()
          })
          .select()
          .single();

        if (error) {
          console.error('[email-sequence-manager] Enroll error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to enroll contact' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[email-sequence-manager] Enrolled contact ${contact_id} in sequence ${sequence_id}`);
        return new Response(
          JSON.stringify({ success: true, data: enrollment }),
          { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'unenroll': {
        if (!sequence_id || !contact_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'sequence_id and contact_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { error } = await supabaseAdmin
          .from('email_sequence_enrollments')
          .update({ status: 'unsubscribed' })
          .eq('sequence_id', sequence_id)
          .eq('contact_id', contact_id)
          .eq('status', 'active');

        if (error) {
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to unenroll contact' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'clone': {
        if (!sequence_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'sequence_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get original sequence
        const { data: original } = await supabaseAdmin
          .from('email_sequences')
          .select('*, email_sequence_steps(*)')
          .eq('id', sequence_id)
          .single();

        if (!original) {
          return new Response(
            JSON.stringify({ success: false, error: 'Sequence not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Create clone
        const { data: clone, error } = await supabaseAdmin
          .from('email_sequences')
          .insert({
            tenant_id,
            name: `${original.name} (Copy)`,
            description: original.description,
            trigger_type: original.trigger_type,
            is_active: false,
            created_by: userId
          })
          .select()
          .single();

        if (error || !clone) {
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to clone sequence' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Clone steps
        if (original.email_sequence_steps?.length) {
          const stepsToInsert = original.email_sequence_steps.map((step: Record<string, unknown>) => ({
            sequence_id: clone.id,
            step_order: step.step_order,
            delay_days: step.delay_days,
            delay_hours: step.delay_hours,
            subject: step.subject,
            body_html: step.body_html,
            body_text: step.body_text,
            ab_variant: step.ab_variant
          }));

          await supabaseAdmin
            .from('email_sequence_steps')
            .insert(stepsToInsert);
        }

        console.log(`[email-sequence-manager] Cloned sequence ${sequence_id} to ${clone.id}`);
        return new Response(
          JSON.stringify({ success: true, data: clone }),
          { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

  } catch (error) {
    console.error('[email-sequence-manager] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

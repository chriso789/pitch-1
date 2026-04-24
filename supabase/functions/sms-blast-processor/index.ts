import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing authorization header');

    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) throw new Error('Unauthorized');

    const { blast_id } = await req.json();
    if (!blast_id) throw new Error('Missing blast_id');

    // Load the blast
    const { data: blast, error: blastError } = await supabaseAdmin
      .from('sms_blasts')
      .select('*')
      .eq('id', blast_id)
      .single();

    if (blastError || !blast) throw new Error('Blast not found');
    if (blast.status !== 'draft') throw new Error(`Blast status is "${blast.status}", expected "draft"`);

    // Mark blast as sending
    await supabaseAdmin
      .from('sms_blasts')
      .update({ status: 'sending', started_at: new Date().toISOString() })
      .eq('id', blast_id);

    // Load all pending items
    const { data: items, error: itemsError } = await supabaseAdmin
      .from('sms_blast_items')
      .select('*')
      .eq('blast_id', blast_id)
      .eq('status', 'pending');

    if (itemsError) throw itemsError;

    let sentCount = 0;
    let failedCount = 0;
    let optedOutCount = 0;

    for (const item of items || []) {
      // Check opt-out status
      const { data: optOut } = await supabaseAdmin
        .from('opt_outs')
        .select('id')
        .eq('phone', item.phone)
        .eq('tenant_id', blast.tenant_id)
        .maybeSingle();

      if (optOut) {
        await supabaseAdmin
          .from('sms_blast_items')
          .update({ status: 'opted_out' })
          .eq('id', item.id);
        optedOutCount++;
        continue;
      }

      // Check if blast was cancelled mid-send
      const { data: currentBlast } = await supabaseAdmin
        .from('sms_blasts')
        .select('status')
        .eq('id', blast_id)
        .single();

      if (currentBlast?.status === 'cancelled') {
        // Mark remaining items as cancelled
        await supabaseAdmin
          .from('sms_blast_items')
          .update({ status: 'cancelled' })
          .eq('blast_id', blast_id)
          .eq('status', 'pending');
        break;
      }

      // Resolve template variables
      let messageText = blast.script;
      const firstName = item.contact_name?.split(' ')[0] || '';
      const lastName = item.contact_name?.split(' ').slice(1).join(' ') || '';
      messageText = messageText
        .replace(/\{\{first_name\}\}/gi, firstName)
        .replace(/\{\{last_name\}\}/gi, lastName)
        .replace(/\{\{full_name\}\}/gi, item.contact_name || '')
        .replace(/\{\{phone\}\}/gi, item.phone);

      // Auto-append opt-out notice if not present
      if (!/stop/i.test(messageText)) {
        messageText += '\n\nReply STOP to opt out.';
      }

      try {
        // Call telnyx-send-sms via service role
        const { data: smsResult, error: smsError } = await supabaseAdmin.functions.invoke(
          'telnyx-send-sms',
          {
            body: {
              to: item.phone,
              message: messageText,
              contactId: item.contact_id,
              tenant_id: blast.tenant_id,
              sent_by: blast.created_by,
            },
          }
        );

        if (smsError || !smsResult?.success) {
          throw new Error(smsError?.message || smsResult?.error || 'SMS send failed');
        }

        await supabaseAdmin
          .from('sms_blast_items')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', item.id);
        sentCount++;
      } catch (sendError: any) {
        await supabaseAdmin
          .from('sms_blast_items')
          .update({ status: 'failed', error_message: sendError.message?.substring(0, 500) })
          .eq('id', item.id);
        failedCount++;
      }

      // Update running counters
      await supabaseAdmin
        .from('sms_blasts')
        .update({ sent_count: sentCount, failed_count: failedCount, opted_out_count: optedOutCount })
        .eq('id', blast_id);

      // Rate limiting — 150ms between sends
      await new Promise(r => setTimeout(r, 150));
    }

    // Mark blast as completed
    const finalStatus = (await supabaseAdmin
      .from('sms_blasts')
      .select('status')
      .eq('id', blast_id)
      .single()).data?.status;

    if (finalStatus !== 'cancelled') {
      await supabaseAdmin
        .from('sms_blasts')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          sent_count: sentCount,
          failed_count: failedCount,
          opted_out_count: optedOutCount,
        })
        .eq('id', blast_id);
    }

    return new Response(
      JSON.stringify({ success: true, sent: sentCount, failed: failedCount, opted_out: optedOutCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('sms-blast-processor error:', error);
    return new Response(
      JSON.stringify({ success: false, error: (error instanceof Error ? error.message : String(error)) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

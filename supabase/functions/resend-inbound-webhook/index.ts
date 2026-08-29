import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { notifySenderEngagement } from "../_shared/engagement-notify.ts";


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-resend-signature',
};

interface ResendInboundEmail {
  from: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  headers: Record<string, string>;
  attachments?: Array<{
    filename: string;
    content: string;
    content_type: string;
  }>;
}

// Extract email address from "Name <email@domain.com>" format
function extractEmailAddress(emailString: string): string {
  const match = emailString.match(/<([^>]+)>/) || emailString.match(/([^\s<>]+@[^\s<>]+)/);
  return match ? match[1].toLowerCase() : emailString.toLowerCase();
}

// Extract name from "Name <email@domain.com>" format
function extractName(emailString: string): string {
  const match = emailString.match(/^([^<]+)\s*</);
  return match ? match[1].trim() : '';
}

// Generate a unique thread ID
function generateThreadId(): string {
  return `thread_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

const handler = async (req: Request): Promise<Response> => {
  console.log('Resend inbound webhook received');
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const email: ResendInboundEmail = await req.json();
    console.log('Received inbound email:', { 
      from: email.from, 
      to: email.to, 
      subject: email.subject 
    });

    const fromEmail = extractEmailAddress(email.from);
    const fromName = extractName(email.from);
    const toAddresses = Array.isArray(email.to) ? email.to : [email.to];
    const toEmail = extractEmailAddress(toAddresses[0]);

    // Get headers for threading
    const messageId = email.headers?.['message-id'] || email.headers?.['Message-ID'] || `msg_${Date.now()}`;
    const inReplyTo = email.headers?.['in-reply-to'] || email.headers?.['In-Reply-To'];
    const references = email.headers?.['references'] || email.headers?.['References'];

    // Find matching contact by email
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('id, tenant_id, first_name, last_name, assigned_rep')
      .ilike('email', fromEmail)
      .limit(1)
      .maybeSingle();

    if (contactError) {
      console.error('Error finding contact:', contactError);
    }

    console.log('Found contact:', contact);

    // Determine thread_id - try to find existing thread by in_reply_to or references
    let threadId: string | null = null;
    
    if (inReplyTo || references) {
      // Look for existing messages that match
      const searchMessageIds = [inReplyTo, ...(references?.split(' ') || [])].filter(Boolean);
      
      const { data: existingMsg } = await supabase
        .from('communication_history')
        .select('thread_id, message_id')
        .in('message_id', searchMessageIds)
        .limit(1)
        .maybeSingle();

      if (existingMsg?.thread_id) {
        threadId = existingMsg.thread_id;
        console.log('Found existing thread:', threadId);
      }
    }

    // ------------------------------------------------------------------
    // Attach the reply to the same lead/project + rep as the original
    // outbound message so it shows up in the Comms tab of that record.
    // ------------------------------------------------------------------
    let parent: any = null;

    if (threadId) {
      const { data } = await supabase
        .from('communication_history')
        .select('tenant_id, contact_id, pipeline_entry_id, project_id, rep_id')
        .eq('thread_id', threadId)
        .eq('direction', 'outbound')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      parent = data;
    }

    // Fallback: most recent outbound email to this address (quote / document sends)
    if (!parent) {
      const { data } = await supabase
        .from('communication_history')
        .select('tenant_id, contact_id, pipeline_entry_id, project_id, rep_id, thread_id')
        .eq('communication_type', 'email')
        .eq('direction', 'outbound')
        .ilike('to_address', `%${fromEmail}%`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      parent = data;
      if (!threadId && data?.thread_id) threadId = data.thread_id;
    }

    // If no existing thread, generate new thread_id
    if (!threadId) {
      threadId = generateThreadId();
      console.log('Creating new thread:', threadId);
    }

    const tenantId = parent?.tenant_id || contact?.tenant_id || null;
    const contactId = parent?.contact_id || contact?.id || null;
    const pipelineEntryId = parent?.pipeline_entry_id || null;
    const projectId = parent?.project_id || null;
    // Alert the rep who actually sent the email, not just the assigned rep
    const repId = parent?.rep_id || contact?.assigned_rep || null;

    // Log the received email to communication_history
    const { data: logEntry, error: logError } = await supabase
      .from('communication_history')
      .insert({
        tenant_id: tenantId,
        contact_id: contactId,
        pipeline_entry_id: pipelineEntryId,
        project_id: projectId,
        rep_id: repId,
        communication_type: 'email',
        direction: 'inbound',
        subject: email.subject,
        content: email.text || email.html || '',
        thread_id: threadId,
        message_id: messageId,
        in_reply_to: inReplyTo,
        from_address: email.from,
        to_address: toAddresses.join(', '),
        delivery_status: 'received',
        metadata: {
          raw_headers: email.headers,
          has_attachments: !!email.attachments?.length,
          attachment_count: email.attachments?.length || 0,
          sender_name: fromName,
          references: references,
          matched_via: parent ? 'outbound_thread' : (contact ? 'contact_email' : 'none'),
        }
      })
      .select()
      .single();

    if (logError) {
      console.error('Error logging email:', logError);
      throw logError;
    }

    console.log('Email logged successfully:', logEntry?.id);

    // Drop a note on the lead/project so the reply is visible in the record
    if (pipelineEntryId && tenantId) {
      try {
        await supabase.from('internal_notes').insert({
          tenant_id: tenantId,
          pipeline_entry_id: pipelineEntryId,
          contact_id: contactId,
          author_id: repId,
          content: `📨 Email reply from ${fromName || fromEmail}: ${(email.text || '').slice(0, 500) || email.subject}`,
        });
      } catch (e) {
        console.error('Error adding internal note:', e);
      }
    }

    // Alert the sending rep by in-app + SMS (company number) + email
    if (repId && tenantId) {
      try {
        await notifySenderEngagement({
          supabase,
          tenantId,
          userId: repId,
          type: 'email_received',
          title: 'New Email Reply',
          message: `${fromName || fromEmail} replied: ${email.subject}`,
          emailSubject: `Reply from ${fromName || fromEmail}`,
          detailLines: [
            `<strong>From:</strong> ${fromEmail}`,
            `<strong>Subject:</strong> ${email.subject || '(no subject)'}`,
            `<strong>Message:</strong> ${(email.text || '').slice(0, 800)}`,
          ],
          actionUrl: pipelineEntryId ? `https://pitch-crm.ai/lead/${pipelineEntryId}` : null,
          metadata: {
            contact_id: contactId,
            pipeline_entry_id: pipelineEntryId,
            communication_id: logEntry?.id,
            thread_id: threadId,
          },
        });
      } catch (e) {
        console.error('Error notifying rep:', e);
      }
    }


    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Email received and logged',
        communication_id: logEntry?.id,
        thread_id: threadId
      }),
      { 
        status: 200, 
        headers: { 'Content-Type': 'application/json', ...corsHeaders } 
      }
    );

  } catch (error) {
    console.error('Error processing inbound email:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { 
        status: 500, 
        headers: { 'Content-Type': 'application/json', ...corsHeaders } 
      }
    );
  }
};

Deno.serve(handler);

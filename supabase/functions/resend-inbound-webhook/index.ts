import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // If no existing thread, generate new thread_id
    if (!threadId) {
      threadId = generateThreadId();
      console.log('Creating new thread:', threadId);
    }

    // Log the received email to communication_history
    const { data: logEntry, error: logError } = await supabase
      .from('communication_history')
      .insert({
        tenant_id: contact?.tenant_id,
        contact_id: contact?.id,
        rep_id: contact?.assigned_rep,
        communication_type: 'email',
        direction: 'inbound',
        subject: email.subject,
        content: email.text || email.html || '',
        status: 'received',
        thread_id: threadId,
        message_id: messageId,
        in_reply_to: inReplyTo,
        from_address: email.from,
        to_address: toAddresses.join(', '),
        metadata: {
          raw_headers: email.headers,
          has_attachments: !!email.attachments?.length,
          attachment_count: email.attachments?.length || 0,
          sender_name: fromName,
          references: references
        }
      })
      .select()
      .single();

    if (logError) {
      console.error('Error logging email:', logError);
      throw logError;
    }

    console.log('Email logged successfully:', logEntry?.id);

    // Create a notification for the rep if we found a contact
    if (contact?.assigned_rep && contact?.tenant_id) {
      const { error: notifError } = await supabase
        .from('notifications')
        .insert({
          tenant_id: contact.tenant_id,
          user_id: contact.assigned_rep,
          type: 'email_received',
          title: 'New Email Reply',
          message: `${fromName || fromEmail} replied: ${email.subject}`,
          metadata: {
            contact_id: contact.id,
            communication_id: logEntry?.id,
            thread_id: threadId
          }
        });

      if (notifError) {
        console.error('Error creating notification:', notifError);
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

serve(handler);

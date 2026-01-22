import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MentionNotificationRequest {
  pipeline_entry_id: string;
  mentioned_user_ids: string[];
  author_id: string;
  note_content: string;
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: MentionNotificationRequest = await req.json();
    const { pipeline_entry_id, mentioned_user_ids, author_id, note_content } = body;

    if (!pipeline_entry_id || !mentioned_user_ids?.length || !author_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get author info
    const { data: author } = await supabase
      .from('profiles')
      .select('first_name, last_name, email')
      .eq('id', author_id)
      .single();

    const authorName = author 
      ? [author.first_name, author.last_name].filter(Boolean).join(' ') || author.email 
      : 'A team member';

    // Get lead info for context
    const { data: lead } = await supabase
      .from('pipeline_entries')
      .select(`
        id,
        contact:contacts(first_name, last_name, address_street, address_city)
      `)
      .eq('id', pipeline_entry_id)
      .single();

    const contact = lead?.contact as any;
    const leadName = contact 
      ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Lead'
      : 'Lead';
    const leadAddress = contact?.address_street 
      ? `${contact.address_street}, ${contact.address_city || ''}`
      : '';

    // Get mentioned users
    const { data: mentionedUsers } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, email, phone')
      .in('id', mentioned_user_ids);

    if (!mentionedUsers?.length) {
      return new Response(
        JSON.stringify({ message: 'No valid users to notify' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Truncate note content for SMS
    const truncatedNote = note_content.length > 100 
      ? note_content.substring(0, 100) + '...' 
      : note_content;

    const notificationPromises: Promise<any>[] = [];

    for (const user of mentionedUsers) {
      // Create in-app notification
      notificationPromises.push(
        supabase.from('user_notifications').insert({
          tenant_id: (await supabase.from('profiles').select('tenant_id').eq('id', user.id).single()).data?.tenant_id,
          user_id: user.id,
          type: 'mention',
          title: `${authorName} mentioned you`,
          message: `On lead ${leadName}${leadAddress ? ` at ${leadAddress}` : ''}: "${truncatedNote}"`,
          action_url: `/lead/${pipeline_entry_id}`,
          metadata: {
            author_id,
            pipeline_entry_id,
            note_preview: truncatedNote,
          },
        })
      );

      // Send SMS if user has phone
      if (user.phone) {
        notificationPromises.push(
          supabase.functions.invoke('telnyx-send-sms', {
            body: {
              to: user.phone,
              message: `PITCH CRM: ${authorName} mentioned you on ${leadName}: "${truncatedNote}" - View in app`,
            }
          }).catch(err => {
            console.error(`Failed to send SMS to ${user.id}:`, err);
            return null;
          })
        );
      }

      // Send email notification
      if (user.email) {
        notificationPromises.push(
          supabase.functions.invoke('email-send', {
            body: {
              to: [user.email],
              subject: `${authorName} mentioned you in a lead note`,
              html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                  <h2 style="color: #2563eb;">You were mentioned in a team note</h2>
                  <p><strong>${authorName}</strong> mentioned you on lead <strong>${leadName}</strong>${leadAddress ? ` at ${leadAddress}` : ''}:</p>
                  <blockquote style="border-left: 3px solid #2563eb; padding-left: 12px; margin: 16px 0; color: #374151;">
                    ${note_content}
                  </blockquote>
                  <a href="${Deno.env.get('PUBLIC_APP_URL') || 'https://pitch-1.lovable.app'}/lead/${pipeline_entry_id}" 
                     style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 16px;">
                    View Lead
                  </a>
                </div>
              `,
            }
          }).catch(err => {
            console.error(`Failed to send email to ${user.id}:`, err);
            return null;
          })
        );
      }
    }

    await Promise.allSettled(notificationPromises);

    return new Response(
      JSON.stringify({ 
        success: true, 
        notified_count: mentionedUsers.length 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in send-mention-notification:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

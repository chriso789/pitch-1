import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Follow-up schedule: Day 2, Day 5, Day 10
const FOLLOW_UP_DAYS = [2, 5, 10];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('[Follow-up Scheduler] Starting daily follow-up check...');

    // 1. Schedule follow-ups for newly sent proposals (no follow-ups created yet)
    const { data: newProposals, error: newError } = await supabaseClient
      .from('enhanced_estimates')
      .select('id, tenant_id, share_token_created_at, customer_email')
      .not('share_token', 'is', null)
      .is('signed_at', null)
      .eq('follow_up_enabled', true)
      .not('id', 'in', `(SELECT DISTINCT estimate_id FROM proposal_follow_ups)`);

    if (newError) {
      console.error('Error fetching new proposals:', newError);
    } else if (newProposals && newProposals.length > 0) {
      console.log(`[Follow-up Scheduler] Found ${newProposals.length} new proposals to schedule`);
      
      for (const proposal of newProposals) {
        const sentDate = new Date(proposal.share_token_created_at);
        
        // Create follow-up entries for each day
        for (let i = 0; i < FOLLOW_UP_DAYS.length; i++) {
          const scheduledDate = new Date(sentDate);
          scheduledDate.setDate(scheduledDate.getDate() + FOLLOW_UP_DAYS[i]);
          scheduledDate.setHours(9, 0, 0, 0); // 9 AM local time
          
          await supabaseClient
            .from('proposal_follow_ups')
            .insert({
              tenant_id: proposal.tenant_id,
              estimate_id: proposal.id,
              sequence_step: i + 1,
              scheduled_for: scheduledDate.toISOString(),
              status: 'pending',
              email_template: getEmailTemplate(i + 1)
            });
        }
      }
    }

    // 2. Process due follow-ups
    const now = new Date();
    const { data: dueFollowUps, error: dueError } = await supabaseClient
      .from('proposal_follow_ups')
      .select(`
        *,
        estimate:enhanced_estimates (
          id,
          customer_name,
          customer_email,
          customer_address,
          estimate_number,
          share_token,
          first_viewed_at,
          signed_at,
          good_tier_total,
          better_tier_total,
          best_tier_total,
          tenant_id,
          tenants (
            name,
            phone,
            email
          )
        )
      `)
      .eq('status', 'pending')
      .lte('scheduled_for', now.toISOString());

    if (dueError) {
      console.error('Error fetching due follow-ups:', dueError);
    } else if (dueFollowUps && dueFollowUps.length > 0) {
      console.log(`[Follow-up Scheduler] Processing ${dueFollowUps.length} due follow-ups`);

      for (const followUp of dueFollowUps) {
        const estimate = followUp.estimate as any;
        
        // Skip if already signed
        if (estimate?.signed_at) {
          await supabaseClient
            .from('proposal_follow_ups')
            .update({ status: 'cancelled' })
            .eq('id', followUp.id);
          continue;
        }

        // Skip step 1 if already viewed
        if (followUp.sequence_step === 1 && estimate?.first_viewed_at) {
          await supabaseClient
            .from('proposal_follow_ups')
            .update({ status: 'skipped' })
            .eq('id', followUp.id);
          continue;
        }

        // Send the follow-up email
        if (estimate?.customer_email) {
          const tenant = estimate.tenants;
          const proposalLink = `${Deno.env.get('PUBLIC_SITE_URL') || 'https://app.pitchcrm.com'}/proposal/${estimate.share_token}`;
          
          const emailContent = generateEmailContent(
            followUp.sequence_step,
            estimate.customer_name || 'Valued Customer',
            estimate.customer_address || '',
            proposalLink,
            tenant?.name || 'Your Roofing Company',
            tenant?.phone || ''
          );

          // Send via Resend
          const resendApiKey = Deno.env.get('RESEND_API_KEY');
          if (resendApiKey) {
            const emailResponse = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${resendApiKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                from: `${tenant?.name || 'PITCH CRM'} <noreply@pitchcrm.com>`,
                to: [estimate.customer_email],
                subject: emailContent.subject,
                html: emailContent.html
              })
            });

            if (emailResponse.ok) {
              console.log(`[Follow-up] Sent step ${followUp.sequence_step} to ${estimate.customer_email}`);
              await supabaseClient
                .from('proposal_follow_ups')
                .update({ 
                  status: 'sent',
                  sent_at: new Date().toISOString()
                })
                .eq('id', followUp.id);
            } else {
              console.error('[Follow-up] Email send failed:', await emailResponse.text());
            }
          }
        }
      }
    }

    console.log('[Follow-up Scheduler] Completed successfully');

    return new Response(JSON.stringify({ 
      success: true,
      scheduled: newProposals?.length || 0,
      processed: dueFollowUps?.length || 0
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Follow-up Scheduler] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function getEmailTemplate(step: number): string {
  switch (step) {
    case 1: return 'day_2_reminder';
    case 2: return 'day_5_reminder';
    case 3: return 'day_10_final';
    default: return 'generic_reminder';
  }
}

function generateEmailContent(
  step: number,
  customerName: string,
  address: string,
  proposalLink: string,
  companyName: string,
  companyPhone: string
): { subject: string; html: string } {
  const firstName = customerName.split(' ')[0];
  
  switch (step) {
    case 1:
      return {
        subject: `${firstName}, your roofing proposal is ready to review`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Hi ${firstName},</h2>
            <p>I wanted to make sure you received the roofing proposal we prepared for ${address || 'your property'}.</p>
            <p>We put together a few options based on your needs, and I'd love to answer any questions you might have.</p>
            <p style="text-align: center; margin: 30px 0;">
              <a href="${proposalLink}" style="background-color: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold;">View Your Proposal</a>
            </p>
            <p>Feel free to reach out if you'd like to discuss the options${companyPhone ? ` – you can call me at ${companyPhone}` : ''}.</p>
            <p>Best regards,<br>${companyName}</p>
          </div>
        `
      };
    case 2:
      return {
        subject: `Your roofing proposal expires soon - ${firstName}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Hi ${firstName},</h2>
            <p>Just a quick follow-up on your roofing proposal for ${address || 'your property'}.</p>
            <p>I noticed you haven't had a chance to review it yet. The pricing and availability we quoted are still valid, but I wanted to check in before anything changes.</p>
            <p style="text-align: center; margin: 30px 0;">
              <a href="${proposalLink}" style="background-color: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold;">Review Proposal Now</a>
            </p>
            <p>If you have any concerns or questions about the estimate, I'm happy to discuss. We can also schedule a quick call if that's easier.</p>
            <p>Looking forward to hearing from you,<br>${companyName}</p>
          </div>
        `
      };
    case 3:
      return {
        subject: `Final reminder: Your roofing proposal for ${address || 'your property'}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Hi ${firstName},</h2>
            <p>This is a final reminder about the roofing proposal we sent for ${address || 'your property'}.</p>
            <p>We understand that timing is important for home improvement projects. If now isn't the right time, no problem at all – just let us know and we can follow up when you're ready.</p>
            <p style="text-align: center; margin: 30px 0;">
              <a href="${proposalLink}" style="background-color: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold;">View Your Proposal</a>
            </p>
            <p>If you've decided to go with another contractor, we'd appreciate knowing so we can improve our service.</p>
            <p>Thank you for considering ${companyName}!</p>
            <p>Best,<br>${companyName}${companyPhone ? `<br>${companyPhone}` : ''}</p>
          </div>
        `
      };
    default:
      return {
        subject: `Your roofing proposal from ${companyName}`,
        html: `<p>View your proposal: <a href="${proposalLink}">${proposalLink}</a></p>`
      };
  }
}

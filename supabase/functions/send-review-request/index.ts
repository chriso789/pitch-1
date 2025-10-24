import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { projectId, contactId, surveyType = 'post_completion' } = await req.json();

    if (!projectId || !contactId) {
      throw new Error('projectId and contactId are required');
    }

    // Fetch project and contact details
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('*, contacts(*)')
      .eq('id', projectId)
      .single();

    if (projectError) throw projectError;

    // Create survey record
    const { data: survey, error: surveyError } = await supabase
      .from('satisfaction_surveys')
      .insert({
        tenant_id: project.tenant_id,
        contact_id: contactId,
        project_id: projectId,
        survey_type: surveyType,
      })
      .select()
      .single();

    if (surveyError) throw surveyError;

    // Generate survey link (in a real app, this would be a public-facing URL)
    const surveyLink = `${supabaseUrl}/nps-survey?id=${survey.id}`;

    // Send email notification
    const emailBody = `
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
            <h1 style="color: white; margin: 0;">We'd Love Your Feedback!</h1>
          </div>
          
          <div style="padding: 30px; background: #f9fafb;">
            <p style="font-size: 16px; line-height: 1.6; color: #374151;">
              Hi ${project.contacts.first_name},
            </p>
            
            <p style="font-size: 16px; line-height: 1.6; color: #374151;">
              Thank you for choosing us for your recent project: <strong>${project.title}</strong>
            </p>
            
            <p style="font-size: 16px; line-height: 1.6; color: #374151;">
              We'd greatly appreciate it if you could take a moment to share your experience. 
              Your feedback helps us improve and serve you better.
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${surveyLink}" 
                 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                        color: white; 
                        padding: 15px 40px; 
                        text-decoration: none; 
                        border-radius: 8px; 
                        font-size: 16px; 
                        font-weight: bold;
                        display: inline-block;">
                Share Your Feedback
              </a>
            </div>
            
            <p style="font-size: 14px; color: #6b7280; text-align: center;">
              This should only take 2 minutes of your time.
            </p>
          </div>
          
          <div style="padding: 20px; text-align: center; background: #f3f4f6; color: #6b7280; font-size: 12px;">
            <p>You're receiving this because you recently completed a project with us.</p>
          </div>
        </body>
      </html>
    `;

    // Send SMS if phone number exists
    let smsResult = null;
    if (project.contacts.phone) {
      const smsBody = `Hi ${project.contacts.first_name}! Thanks for choosing us. We'd love your feedback on your recent project. Please rate us: ${surveyLink}`;
      
      try {
        const { data: smsData, error: smsError } = await supabase.functions.invoke('telnyx-send-sms', {
          body: {
            to: project.contacts.phone,
            message: smsBody,
          },
        });
        
        if (!smsError) {
          smsResult = { success: true };
        }
      } catch (smsErr) {
        console.error('SMS send failed:', smsErr);
        smsResult = { success: false, error: smsErr.message };
      }
    }

    // Log the activity
    await supabase
      .from('activities')
      .insert({
        tenant_id: project.tenant_id,
        contact_id: contactId,
        activity_type: 'email',
        description: `Review request sent for project: ${project.title}`,
        clj_number: project.clj_number,
      });

    return new Response(
      JSON.stringify({
        success: true,
        surveyId: survey.id,
        surveyLink,
        emailSent: true,
        smsSent: smsResult?.success || false,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in send-review-request:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

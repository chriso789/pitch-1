import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface DemoRequestData {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  companyName: string;
  jobTitle?: string;
  message?: string;
  requestedAt: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Initialize Supabase client
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let requestData: DemoRequestData | null = null;

  try {
    requestData = await req.json();
    
    console.log("[send-demo-request] Received demo request:", {
      name: `${requestData.firstName} ${requestData.lastName}`,
      email: requestData.email,
      company: requestData.companyName,
      timestamp: new Date().toISOString()
    });

    // First, log the request to database (even if email fails)
    const { data: insertedRequest, error: insertError } = await supabase
      .from('demo_requests')
      .insert({
        first_name: requestData.firstName,
        last_name: requestData.lastName,
        email: requestData.email,
        phone: requestData.phone || null,
        company_name: requestData.companyName,
        job_title: requestData.jobTitle || null,
        message: requestData.message || null,
        email_sent: false,
      })
      .select()
      .single();

    if (insertError) {
      console.error("[send-demo-request] Error inserting demo request:", insertError);
    } else {
      console.log("[send-demo-request] Demo request logged to database:", insertedRequest.id);
    }

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px; font-weight: bold;">
            PITCH CRM Demo Request
          </h1>
          <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">
            New demo request received
          </p>
        </div>
        
        <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
          <h2 style="color: #333; margin-top: 0; font-size: 20px;">Contact Information</h2>
          
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #666; width: 120px;">Name:</td>
                <td style="padding: 8px 0; color: #333;">${requestData.firstName} ${requestData.lastName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #666;">Email:</td>
                <td style="padding: 8px 0; color: #333;">
                  <a href="mailto:${requestData.email}" style="color: #667eea; text-decoration: none;">${requestData.email}</a>
                </td>
              </tr>
              ${requestData.phone ? `
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #666;">Phone:</td>
                <td style="padding: 8px 0; color: #333;">
                  <a href="tel:${requestData.phone}" style="color: #667eea; text-decoration: none;">${requestData.phone}</a>
                </td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #666;">Company:</td>
                <td style="padding: 8px 0; color: #333;">${requestData.companyName}</td>
              </tr>
              ${requestData.jobTitle ? `
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #666;">Job Title:</td>
                <td style="padding: 8px 0; color: #333;">${requestData.jobTitle}</td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #666;">Requested:</td>
                <td style="padding: 8px 0; color: #333;">${new Date(requestData.requestedAt).toLocaleString()}</td>
              </tr>
            </table>
          </div>

          ${requestData.message ? `
          <h3 style="color: #333; margin: 25px 0 10px 0;">Message:</h3>
          <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; border-left: 4px solid #667eea;">
            <p style="margin: 0; color: #555; line-height: 1.6;">${requestData.message}</p>
          </div>
          ` : ''}

          <div style="margin-top: 30px; padding: 20px; background: #e3f2fd; border-radius: 8px; border: 1px solid #bbdefb;">
            <h3 style="color: #1976d2; margin: 0 0 10px 0; font-size: 16px;">Next Steps:</h3>
            <ul style="color: #666; margin: 0; padding-left: 20px;">
              <li style="margin-bottom: 5px;">Reply to this email to schedule the demo</li>
              <li style="margin-bottom: 5px;">Prepare a personalized demonstration</li>
              <li>Follow up within 24 hours</li>
            </ul>
          </div>
        </div>
        
        <div style="text-align: center; margin-top: 20px; color: #666; font-size: 12px;">
          <p>This demo request was submitted through the PITCH CRM website</p>
        </div>
      </div>
    `;

    // Use Resend's verified domain (onboarding@resend.dev works without domain verification)
    const emailResponse = await resend.emails.send({
      from: "PITCH CRM <onboarding@resend.dev>",
      to: ["chrisobrien91@gmail.com"],
      replyTo: requestData.email,
      subject: `Demo Request: ${requestData.firstName} ${requestData.lastName} from ${requestData.companyName}`,
      html: emailHtml,
    });

    console.log("[send-demo-request] Email sent successfully:", emailResponse);

    // Update database record with email status
    if (insertedRequest?.id) {
      await supabase
        .from('demo_requests')
        .update({ 
          email_sent: true,
        })
        .eq('id', insertedRequest.id);
    }

    return new Response(JSON.stringify({ 
      success: true, 
      message: "Demo request submitted successfully",
      emailId: emailResponse.data?.id 
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("[send-demo-request] Error:", error);
    
    // Try to update database with error if we have a record
    if (requestData) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        
        await supabase
          .from('demo_requests')
          .update({ 
            email_error: error instanceof Error ? error.message : String(error),
          })
          .eq('email', requestData.email)
          .order('created_at', { ascending: false })
          .limit(1);
      } catch (dbError) {
        console.error("[send-demo-request] Error updating database with error:", dbError);
      }
    }
    
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : String(error),
        success: false 
      }),
      {
        status: 500,
        headers: { 
          "Content-Type": "application/json", 
          ...corsHeaders 
        },
      }
    );
  }
};

serve(handler);
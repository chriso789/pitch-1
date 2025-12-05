import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AnnouncementRequest {
  announcement_id: string;
  title: string;
  message: string;
  announcement_type: string;
  target_companies?: string[] | null;
}

const TYPE_CONFIG: Record<string, { emoji: string; color: string; bgColor: string }> = {
  feature: { emoji: '🚀', color: '#8b5cf6', bgColor: '#f5f3ff' },
  maintenance: { emoji: '🔧', color: '#f97316', bgColor: '#fff7ed' },
  urgent: { emoji: '⚠️', color: '#ef4444', bgColor: '#fef2f2' },
  general: { emoji: '📢', color: '#3b82f6', bgColor: '#eff6ff' }
};

const generateAnnouncementEmail = (
  title: string, 
  message: string, 
  type: string,
  companyName: string,
  recipientName: string
) => {
  const config = TYPE_CONFIG[type] || TYPE_CONFIG.general;
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%;">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 32px; border-radius: 16px 16px 0 0;">
              <table width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <div style="display: inline-block; width: 48px; height: 48px; background: linear-gradient(135deg, #16a34a 0%, #22c55e 100%); border-radius: 12px; text-align: center; line-height: 48px; color: white; font-weight: bold; font-size: 20px;">P</div>
                  </td>
                  <td style="padding-left: 16px;">
                    <h1 style="margin: 0; color: white; font-size: 20px; font-weight: 700;">PITCH CRM</h1>
                    <p style="margin: 4px 0 0; color: #94a3b8; font-size: 13px;">Platform Announcement</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="background: white; padding: 32px;">
              <!-- Greeting -->
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px;">
                Hi ${recipientName},
              </p>
              
              <!-- Type Badge -->
              <div style="display: inline-block; background: ${config.bgColor}; color: ${config.color}; padding: 6px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; margin-bottom: 20px;">
                ${config.emoji} ${type.charAt(0).toUpperCase() + type.slice(1)} Update
              </div>
              
              <h2 style="margin: 0 0 20px; color: #0f172a; font-size: 24px; font-weight: 700;">
                ${title}
              </h2>
              
              <div style="color: #475569; font-size: 16px; line-height: 1.7; white-space: pre-wrap;">
                ${message.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>')}
              </div>
              
              <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e2e8f0;">
                <p style="margin: 0; color: #94a3b8; font-size: 13px;">
                  This announcement was sent to <strong style="color: #64748b;">${companyName}</strong>
                </p>
              </div>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background: #f1f5f9; padding: 24px 32px; border-radius: 0 0 16px 16px;">
              <table width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <p style="margin: 0; color: #64748b; font-size: 13px;">
                      Questions? Reply to this email or contact support.
                    </p>
                  </td>
                  <td align="right">
                    <p style="margin: 0; color: #94a3b8; font-size: 12px;">
                      © ${new Date().getFullYear()} PITCH CRM
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromDomain = Deno.env.get("RESEND_FROM_DOMAIN") || "resend.dev";
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { announcement_id, title, message, announcement_type, target_companies }: AnnouncementRequest = await req.json();

    console.log(`Sending platform announcement: ${title}`);

    // Get target companies
    let companiesQuery = supabase
      .from('tenants')
      .select('id, name, email, owner_email, owner_name')
      .eq('is_active', true);

    if (target_companies && target_companies.length > 0) {
      companiesQuery = companiesQuery.in('id', target_companies);
    }

    const { data: companies, error: companiesError } = await companiesQuery;

    if (companiesError) {
      throw new Error(`Failed to fetch companies: ${companiesError.message}`);
    }

    if (!companies || companies.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: "No target companies found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${companies.length} target companies`);

    // Get admin profiles for each company to find owner emails
    const companyIds = companies.map(c => c.id);
    const { data: adminProfiles, error: profilesError } = await supabase
      .from('profiles')
      .select('tenant_id, email, first_name, last_name')
      .in('tenant_id', companyIds);

    if (profilesError) {
      console.warn(`Warning: Could not fetch profiles: ${profilesError.message}`);
    }

    // Create a map of tenant_id to admin profile
    const profilesByTenant: Record<string, { email: string; first_name: string | null; last_name: string | null }> = {};
    if (adminProfiles) {
      for (const profile of adminProfiles) {
        // Take the first profile found for each tenant (could be improved with role check)
        if (profile.tenant_id && !profilesByTenant[profile.tenant_id] && profile.email) {
          profilesByTenant[profile.tenant_id] = {
            email: profile.email,
            first_name: profile.first_name,
            last_name: profile.last_name
          };
        }
      }
    }

    let sentCount = 0;
    let errorCount = 0;
    const skippedCompanies: string[] = [];

    if (resendApiKey) {
      const resend = new Resend(resendApiKey);

      // Send to each company
      for (const company of companies) {
        // Priority: 1. Admin profile email, 2. owner_email field, 3. company email
        const adminProfile = profilesByTenant[company.id];
        const targetEmail = adminProfile?.email || company.owner_email || company.email;
        
        // Get recipient name
        const recipientName = adminProfile?.first_name || company.owner_name?.split(' ')[0] || 'Team';

        if (!targetEmail) {
          console.warn(`Company ${company.name} has no email (checked: profile, owner_email, email), skipping`);
          skippedCompanies.push(company.name);
          continue;
        }

        try {
          const emailHtml = generateAnnouncementEmail(title, message, announcement_type, company.name, recipientName);
          
          const config = TYPE_CONFIG[announcement_type] || TYPE_CONFIG.general;
          
          console.log(`Sending to ${company.name}: ${targetEmail} (source: ${adminProfile?.email ? 'profile' : company.owner_email ? 'owner_email' : 'company_email'})`);

          await resend.emails.send({
            from: `PITCH CRM <announcements@${fromDomain}>`,
            to: [targetEmail],
            subject: `${config.emoji} ${title}`,
            html: emailHtml,
          });

          sentCount++;
          console.log(`✓ Sent to ${targetEmail}`);
        } catch (error: any) {
          console.error(`✗ Failed to send to ${targetEmail}:`, error.message);
          errorCount++;
        }
      }
    } else {
      console.warn('RESEND_API_KEY not configured, skipping email send');
    }

    // Update announcement with sent count
    if (announcement_id) {
      await supabase
        .from('platform_announcements')
        .update({
          read_by: [{ 
            sent_count: sentCount, 
            error_count: errorCount, 
            skipped: skippedCompanies,
            sent_at: new Date().toISOString() 
          }]
        })
        .eq('id', announcement_id);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        sent: sentCount,
        errors: errorCount,
        skipped: skippedCompanies,
        total_companies: companies.length
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error('Platform announcement error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

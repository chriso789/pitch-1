import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface VerifyDomainRequest {
  action: 'generate_token' | 'verify' | 'check_status';
  domain?: string;
  from_name?: string;
  from_email?: string;
  reply_to_email?: string;
  domain_id?: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get user from auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user's tenant
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, active_tenant_id")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return new Response(
        JSON.stringify({ success: false, error: "Profile not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tenantId = profile.active_tenant_id || profile.tenant_id;
    const body: VerifyDomainRequest = await req.json();

    switch (body.action) {
      case 'generate_token': {
        if (!body.domain || !body.from_name || !body.from_email) {
          return new Response(
            JSON.stringify({ success: false, error: "Missing required fields" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Generate verification token
        const verificationToken = `pitch-verify-${crypto.randomUUID().slice(0, 8)}`;
        
        // Store domain configuration
        const { data: domain, error: insertError } = await supabase
          .from("company_email_domains")
          .upsert({
            tenant_id: tenantId,
            domain: body.domain.toLowerCase(),
            from_name: body.from_name,
            from_email: body.from_email,
            reply_to_email: body.reply_to_email || body.from_email,
            verification_token: verificationToken,
            verification_status: 'pending',
            created_by: user.id,
          }, {
            onConflict: 'tenant_id,domain'
          })
          .select()
          .single();

        if (insertError) {
          console.error("Error saving domain:", insertError);
          return new Response(
            JSON.stringify({ success: false, error: "Failed to save domain configuration" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            domain_id: domain.id,
            verification_token: verificationToken,
            dns_instructions: {
              type: 'TXT',
              name: `_pitch-verify.${body.domain}`,
              value: verificationToken,
              ttl: 300
            }
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'verify': {
        if (!body.domain_id) {
          return new Response(
            JSON.stringify({ success: false, error: "Missing domain_id" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Get domain config
        const { data: domainConfig } = await supabase
          .from("company_email_domains")
          .select("*")
          .eq("id", body.domain_id)
          .eq("tenant_id", tenantId)
          .single();

        if (!domainConfig) {
          return new Response(
            JSON.stringify({ success: false, error: "Domain not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Check DNS TXT record
        try {
          const dnsResponse = await fetch(
            `https://dns.google/resolve?name=_pitch-verify.${domainConfig.domain}&type=TXT`
          );
          const dnsData = await dnsResponse.json();
          
          let verified = false;
          if (dnsData.Answer) {
            for (const answer of dnsData.Answer) {
              const txtValue = answer.data?.replace(/"/g, '');
              if (txtValue === domainConfig.verification_token) {
                verified = true;
                break;
              }
            }
          }

          if (verified) {
            // Add domain to Resend if API key exists
            let resendDomainId = null;
            if (resendApiKey) {
              try {
                const resendResponse = await fetch("https://api.resend.com/domains", {
                  method: "POST",
                  headers: {
                    "Authorization": `Bearer ${resendApiKey}`,
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({
                    name: domainConfig.domain
                  })
                });
                
                if (resendResponse.ok) {
                  const resendData = await resendResponse.json();
                  resendDomainId = resendData.id;
                }
              } catch (resendError) {
                console.error("Resend domain error:", resendError);
              }
            }

            // Update domain status
            await supabase
              .from("company_email_domains")
              .update({
                verification_status: 'verified',
                verified_at: new Date().toISOString(),
                resend_domain_id: resendDomainId
              })
              .eq("id", body.domain_id);

            return new Response(
              JSON.stringify({ 
                success: true, 
                verified: true,
                message: "Domain verified successfully!"
              }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          } else {
            return new Response(
              JSON.stringify({ 
                success: true, 
                verified: false,
                message: "DNS record not found. Please add the TXT record and try again."
              }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        } catch (dnsError) {
          console.error("DNS lookup error:", dnsError);
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: "Failed to verify DNS record"
            }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      case 'check_status': {
        const { data: domains } = await supabase
          .from("company_email_domains")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .order("created_at", { ascending: false });

        return new Response(
          JSON.stringify({ success: true, domains: domains || [] }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: "Invalid action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (error) {
    console.error("Error in verify-email-domain:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface OwnerData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  tenantId: string;
  companyName: string;
}

const OWNERS_TO_CREATE: OwnerData[] = [
  {
    firstName: "Caylan",
    lastName: "Tarvin",
    email: "legacyexteriors.co@gmail.com",
    phone: "305-548-0869",
    tenantId: "5d250471-1452-4bf1-8f6c-daa6243b3249",
    companyName: "Legacy Exteriors"
  },
  {
    firstName: "Drew",
    lastName: "Braddock",
    email: "info@laderaroofing.com",
    phone: "512-669-0558",
    tenantId: "6f185a6e-a074-4370-a95a-2ce77fa0759a",
    companyName: "Ladera Roofing"
  },
  {
    firstName: "Reese",
    lastName: "Ganneway",
    email: "solutionroofingllc@gmail.com",
    phone: "918-902-2193",
    tenantId: "30f71f27-8a91-404f-b835-13f436faaf55",
    companyName: "Solutions Roofing LLC"
  }
];

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Verify caller is master user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Check if user is master
    const { data: callerRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "master")
      .maybeSingle();

    if (!callerRole) {
      return new Response(JSON.stringify({ error: "Only master users can seed owners" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const results: { email: string; status: string; error?: string }[] = [];
    // Always use APP_URL with reliable production fallback - never rely on origin header
    const appUrl = Deno.env.get("APP_URL") || "https://pitch-1.lovable.app";
    const resetRedirectUrl = `${appUrl}/reset-password?onboarding=true`;

    for (const owner of OWNERS_TO_CREATE) {
      try {
        console.log(`Processing ${owner.firstName} ${owner.lastName} (${owner.email})`);

        // Check for existing auth user
        const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
        const existingAuthUser = existingUsers?.users?.find(
          u => u.email?.toLowerCase() === owner.email.toLowerCase()
        );

        if (existingAuthUser) {
          // Check if profile exists
          const { data: existingProfile } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .eq("id", existingAuthUser.id)
            .maybeSingle();

          if (existingProfile) {
            results.push({ email: owner.email, status: "skipped", error: "User already exists with profile" });
            continue;
          }

          // Orphaned auth user - delete it
          console.log(`Deleting orphaned auth user: ${existingAuthUser.id}`);
          await supabaseAdmin.auth.admin.deleteUser(existingAuthUser.id);
        }

        // Create new auth user
        const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email: owner.email,
          email_confirm: false,
          user_metadata: {
            first_name: owner.firstName,
            last_name: owner.lastName
          }
        });

        if (createError || !newUser.user) {
          results.push({ email: owner.email, status: "failed", error: createError?.message || "Failed to create auth user" });
          continue;
        }

        const userId = newUser.user.id;
        console.log(`Created auth user: ${userId}`);

        // Create profile with correct column name 'title' (not 'job_title')
        const { error: profileError } = await supabaseAdmin
          .from("profiles")
          .insert({
            id: userId,
            email: owner.email,
            first_name: owner.firstName,
            last_name: owner.lastName,
            phone: owner.phone,
            tenant_id: owner.tenantId,
            active_tenant_id: owner.tenantId,
            title: "Owner",
            pay_type: "commission"
          });

        if (profileError) {
          console.error(`Profile error for ${owner.email}:`, profileError);
          results.push({ email: owner.email, status: "partial", error: `Profile error: ${profileError.message}` });
          continue;
        }

        // Create user_roles entry
        const { error: roleError } = await supabaseAdmin
          .from("user_roles")
          .insert({
            user_id: userId,
            role: "owner",
            tenant_id: owner.tenantId
          });

        if (roleError) {
          console.error(`Role error for ${owner.email}:`, roleError);
        }

        // Create user_company_access entry
        const { error: accessError } = await supabaseAdmin
          .from("user_company_access")
          .insert({
            user_id: userId,
            tenant_id: owner.tenantId,
            access_level: "full",
            is_active: true,
            granted_at: new Date().toISOString()
          });

        if (accessError) {
          console.error(`Access error for ${owner.email}:`, accessError);
        }

        // Fetch company branding for welcome email
        const { data: companyData } = await supabaseAdmin
          .from("tenants")
          .select("name, logo_url, primary_color, secondary_color")
          .eq("id", owner.tenantId)
          .single();

        // Generate invite link for password setup - use standardized resetRedirectUrl
        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
          type: "invite",
          email: owner.email,
          options: {
            redirectTo: resetRedirectUrl
          }
        });

        if (linkError) {
          console.error(`Invite link error for ${owner.email}:`, linkError);
        }

        // Send personalized welcome email with company branding
        if (linkData?.properties?.action_link) {
          try {
            const emailPayload = {
              email: owner.email,
              firstName: owner.firstName,
              lastName: owner.lastName,
              role: "owner",
              companyName: companyData?.name || owner.companyName,
              companyLogo: companyData?.logo_url || null,
              companyPrimaryColor: companyData?.primary_color || "#1e3a5f",
              companySecondaryColor: companyData?.secondary_color || "#3b82f6",
              inviteLink: linkData.properties.action_link,
              // Platform admin as the sender for owner invitations
              ownerName: "Chris O'Brien",
              ownerHeadshot: null,
              ownerTitle: "Platform Administrator",
              ownerEmail: "chrisobrien91@gmail.com"
            };

            console.log(`Sending welcome email to ${owner.email}...`);
            
            const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-user-invitation`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${serviceRoleKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify(emailPayload)
            });

            if (!emailResponse.ok) {
              const errorText = await emailResponse.text();
              console.error(`Email send error for ${owner.email}:`, errorText);
            } else {
              console.log(`Welcome email sent to ${owner.email}`);
            }
          } catch (emailErr) {
            console.error(`Email error for ${owner.email}:`, emailErr);
          }
        }

        results.push({ 
          email: owner.email, 
          status: "created",
          error: linkData?.properties?.action_link ? undefined : "Could not generate invite link"
        });

        console.log(`Successfully created owner: ${owner.firstName} ${owner.lastName} for ${owner.companyName}`);

      } catch (err) {
        console.error(`Error processing ${owner.email}:`, err);
        results.push({ email: owner.email, status: "failed", error: String(err) });
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Owner seeding complete",
        results 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Seed owners error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

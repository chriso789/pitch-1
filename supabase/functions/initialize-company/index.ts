import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { tenant_id, created_by } = await req.json();

    if (!tenant_id) {
      return new Response(
        JSON.stringify({ error: "tenant_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[initialize-company] Starting initialization for tenant: ${tenant_id}`);

    // Get tenant details (including owner info)
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('id, name, owner_email, owner_name, owner_phone')
      .eq('id', tenant_id)
      .single();

    if (tenantError || !tenant) {
      console.error('[initialize-company] Failed to fetch tenant:', tenantError);
      return new Response(
        JSON.stringify({ error: "Tenant not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: Record<string, any> = {
      tenant_id,
      tenant_name: tenant.name,
      pipeline_stages: 0,
      job_types: 0,
      tags: 0,
      commission_plans: 0,
      notification_templates: 0,
      activity_folder: false,
      owner_provisioned: false,
    };

    // 1. Create default pipeline stages
    const pipelineStages = [
      { tenant_id, name: 'New Lead', stage_order: 1, color: '#3b82f6', is_active: true },
      { tenant_id, name: 'Contacted', stage_order: 2, color: '#8b5cf6', is_active: true },
      { tenant_id, name: 'Inspection Scheduled', stage_order: 3, color: '#f59e0b', is_active: true },
      { tenant_id, name: 'Estimate Sent', stage_order: 4, color: '#ec4899', is_active: true },
      { tenant_id, name: 'Negotiation', stage_order: 5, color: '#6366f1', is_active: true },
      { tenant_id, name: 'Sold', stage_order: 6, color: '#22c55e', is_active: true },
      { tenant_id, name: 'In Production', stage_order: 7, color: '#14b8a6', is_active: true },
      { tenant_id, name: 'Complete', stage_order: 8, color: '#10b981', is_active: true },
      { tenant_id, name: 'Lost', stage_order: 9, color: '#ef4444', is_active: true },
    ];

    const { data: stagesData, error: stagesError } = await supabase
      .from('pipeline_stages')
      .insert(pipelineStages)
      .select();

    if (stagesError) {
      console.error('[initialize-company] Error creating pipeline stages:', stagesError);
    } else {
      results.pipeline_stages = stagesData?.length || 0;
      console.log(`[initialize-company] Created ${results.pipeline_stages} pipeline stages`);
    }

    // 2. Create default job types
    const jobTypes = [
      { tenant_id, name: 'Roofing - Shingle', description: 'Asphalt shingle roofing', is_active: true },
      { tenant_id, name: 'Roofing - Metal', description: 'Metal roofing installation', is_active: true },
      { tenant_id, name: 'Roofing - Tile', description: 'Tile roofing installation', is_active: true },
      { tenant_id, name: 'Roofing - Flat', description: 'Flat/low-slope roofing', is_active: true },
      { tenant_id, name: 'Siding', description: 'Siding installation and repair', is_active: true },
      { tenant_id, name: 'Gutters', description: 'Gutter installation and repair', is_active: true },
      { tenant_id, name: 'Windows', description: 'Window replacement', is_active: true },
      { tenant_id, name: 'Storm Damage', description: 'Storm damage restoration', is_active: true },
      { tenant_id, name: 'Insurance Claim', description: 'Insurance claim project', is_active: true },
    ];

    const { error: jobTypesError } = await supabase.from('job_types').insert(jobTypes);
    if (jobTypesError) {
      console.log('[initialize-company] Job types note:', jobTypesError.message);
    } else {
      results.job_types = jobTypes.length;
      console.log(`[initialize-company] Created ${jobTypes.length} job types`);
    }

    // 3. Create default tags
    const defaultTags = [
      { tenant_id, name: 'Hot Lead', color: '#ef4444', tag_type: 'contact' },
      { tenant_id, name: 'Referral', color: '#22c55e', tag_type: 'contact' },
      { tenant_id, name: 'Insurance', color: '#3b82f6', tag_type: 'contact' },
      { tenant_id, name: 'Cash Deal', color: '#f59e0b', tag_type: 'contact' },
      { tenant_id, name: 'VIP', color: '#8b5cf6', tag_type: 'contact' },
      { tenant_id, name: 'Follow Up', color: '#ec4899', tag_type: 'contact' },
      { tenant_id, name: 'Urgent', color: '#ef4444', tag_type: 'project' },
      { tenant_id, name: 'Priority', color: '#f59e0b', tag_type: 'project' },
    ];

    const { error: tagsError } = await supabase.from('tags').insert(defaultTags);
    if (tagsError) {
      console.log('[initialize-company] Tags note:', tagsError.message);
    } else {
      results.tags = defaultTags.length;
      console.log(`[initialize-company] Created ${defaultTags.length} tags`);
    }

    // 4. Create default commission plan
    const defaultCommissionPlan = {
      tenant_id,
      name: 'Standard Commission',
      commission_type: 'percentage',
      base_rate: 10,
      is_active: true,
      plan_config: {
        type: 'percentage',
        rate: 10,
        description: 'Standard 10% commission on contract value'
      },
      created_by: created_by || null,
    };

    const { data: commissionData, error: commissionError } = await supabase
      .from('commission_plans')
      .insert(defaultCommissionPlan)
      .select();

    if (commissionError) {
      console.error('[initialize-company] Error creating commission plan:', commissionError);
    } else {
      results.commission_plans = commissionData?.length || 0;
      console.log(`[initialize-company] Created ${results.commission_plans} commission plan`);
    }

    // 5. Create default notification templates
    const notificationTemplates = [
      {
        tenant_id,
        name: 'New Lead Assignment',
        type: 'email',
        subject: 'New Lead Assigned: {{contact_name}}',
        content: 'You have been assigned a new lead: {{contact_name}} at {{address}}. Please follow up within 24 hours.',
        trigger_event: 'lead_assigned',
        is_active: true,
        created_by: created_by || null,
      },
      {
        tenant_id,
        name: 'Appointment Reminder',
        type: 'sms',
        subject: 'Appointment Reminder',
        content: 'Reminder: You have an appointment with {{contact_name}} at {{time}} today.',
        trigger_event: 'appointment_reminder',
        is_active: true,
        created_by: created_by || null,
      },
      {
        tenant_id,
        name: 'Estimate Follow-up',
        type: 'email',
        subject: 'Following up on your estimate',
        content: 'Hi {{contact_name}}, we wanted to follow up on the estimate we sent for your roofing project. Please let us know if you have any questions.',
        trigger_event: 'estimate_followup',
        is_active: true,
        created_by: created_by || null,
      },
    ];

    const { data: templatesData, error: templatesError } = await supabase
      .from('notification_templates')
      .insert(notificationTemplates)
      .select();

    if (templatesError) {
      console.error('[initialize-company] Error creating notification templates:', templatesError);
    } else {
      results.notification_templates = templatesData?.length || 0;
      console.log(`[initialize-company] Created ${results.notification_templates} notification templates`);
    }

    // 6. Create storage folder
    try {
      const folderMarker = new Blob([''], { type: 'text/plain' });
      const { error: storageError } = await supabase.storage
        .from('company-data')
        .upload(`${tenant_id}/activity/.keep`, folderMarker, { upsert: true, contentType: 'text/plain' });

      if (storageError) {
        console.log('[initialize-company] Storage folder creation note:', storageError.message);
      } else {
        results.activity_folder = true;
        console.log('[initialize-company] Created activity folder');
      }
    } catch (storageErr) {
      console.log('[initialize-company] Storage setup skipped:', storageErr);
    }

    // 7. Create default app settings
    if (created_by) {
      const defaultSettings = {
        tenant_id,
        user_id: created_by,
        setting_key: 'company_preferences',
        setting_value: {
          timezone: 'America/Chicago',
          features_enabled: ['crm', 'estimates', 'calendar', 'pipeline'],
          notifications_enabled: true,
          auto_assign_leads: false,
        },
      };

      const { error: settingsError } = await supabase.from('app_settings').insert(defaultSettings);
      if (settingsError) {
        console.error('[initialize-company] Error creating app settings:', settingsError);
      } else {
        console.log('[initialize-company] Created default app settings');
      }
    }

    // ===== 8. AUTO-PROVISION OWNER =====
    if (tenant.owner_email) {
      console.log(`[initialize-company] Auto-provisioning owner: ${tenant.owner_email}`);
      
      try {
        const ownerEmail = tenant.owner_email.toLowerCase().trim();
        const ownerName = tenant.owner_name || ownerEmail.split('@')[0];
        
        // Check if user already exists in auth
        const { data: existingUsers } = await supabase.auth.admin.listUsers();
        const existingUser = existingUsers?.users?.find(
          (u: any) => u.email?.toLowerCase() === ownerEmail
        );

        let userId: string;
        let isNewUser = false;

        if (existingUser) {
          userId = existingUser.id;
          console.log(`[initialize-company] Owner already exists in auth: ${userId}`);
        } else {
          // Create new auth user with temporary password
          const tempPassword = crypto.randomUUID() + "Aa1!";
          const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
            email: ownerEmail,
            password: tempPassword,
            email_confirm: true,
            user_metadata: {
              full_name: ownerName,
              tenant_id: tenant_id,
            },
          });

          if (createError) {
            throw new Error(`Failed to create auth user: ${createError.message}`);
          }
          
          userId = newUser.user.id;
          isNewUser = true;
          console.log(`[initialize-company] Created new auth user: ${userId}`);
        }

        // Upsert profile (identity data only - no role field!)
        const nameParts = ownerName.split(' ');
        const { error: profileError } = await supabase
          .from('profiles')
          .upsert({
            id: userId,
            email: ownerEmail,
            first_name: nameParts[0] || ownerName,
            last_name: nameParts.slice(1).join(' ') || '',
            phone: tenant.owner_phone || null,
            tenant_id: tenant_id,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'id' });

        if (profileError) {
          console.error('[initialize-company] Profile upsert error:', profileError);
        }

        // Insert user_roles entry for owner
        const { error: roleError } = await supabase
          .from('user_roles')
          .upsert({
            user_id: userId,
            tenant_id: tenant_id,
            role: 'owner',
          }, { onConflict: 'user_id,tenant_id' });

        if (roleError) {
          console.error('[initialize-company] Role upsert error:', roleError);
        }

        // Grant company access
        const { error: accessError } = await supabase
          .from('user_company_access')
          .upsert({
            user_id: userId,
            tenant_id: tenant_id,
            access_level: 'full',
            granted_by: created_by || userId,
          }, { onConflict: 'user_id,tenant_id' });

        if (accessError) {
          console.error('[initialize-company] Access upsert error:', accessError);
        }

        // Generate password reset link for new users and send email
        if (isNewUser) {
          const { data: resetData, error: resetError } = await supabase.auth.admin.generateLink({
            type: 'recovery',
            email: ownerEmail,
            options: {
              redirectTo: `${supabaseUrl.replace('.supabase.co', '.lovable.app')}/auth?mode=reset`,
            },
          });

          if (resetError) {
            console.error('[initialize-company] Reset link error:', resetError);
          } else {
            // Send owner setup email
            const resendApiKey = Deno.env.get("RESEND_API_KEY");
            const resendFromDomain = Deno.env.get("RESEND_FROM_DOMAIN") || "onboarding@resend.dev";
            
            if (resendApiKey && resetData?.properties?.action_link) {
              const resend = new Resend(resendApiKey);
              
              const { error: emailError } = await resend.emails.send({
                from: `PITCH CRM <${resendFromDomain}>`,
                to: [ownerEmail],
                subject: `Welcome to ${tenant.name} - Set Up Your Account`,
                html: `
                  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h1 style="color: #1a1a2e;">Welcome to PITCH CRM!</h1>
                    <p>Hi ${ownerName},</p>
                    <p>Your company <strong>${tenant.name}</strong> has been set up in PITCH CRM. As the owner, you have full access to manage your team, projects, and settings.</p>
                    <p>Click the button below to set your password and access your account:</p>
                    <div style="text-align: center; margin: 30px 0;">
                      <a href="${resetData.properties.action_link}" 
                         style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                        Set Up Your Account
                      </a>
                    </div>
                    <p style="color: #666; font-size: 14px;">This link will expire in 24 hours.</p>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                    <p style="color: #888; font-size: 12px;">
                      If you didn't expect this email, you can safely ignore it.
                    </p>
                  </div>
                `,
              });

              if (emailError) {
                console.error('[initialize-company] Email send error:', emailError);
              } else {
                console.log('[initialize-company] Owner setup email sent successfully');
              }
            }
          }
        }

        results.owner_provisioned = true;
        results.owner_email = ownerEmail;
        results.owner_is_new = isNewUser;
        console.log(`[initialize-company] Owner provisioned successfully: ${ownerEmail} (new: ${isNewUser})`);

      } catch (ownerError: any) {
        console.error('[initialize-company] Owner provisioning failed:', ownerError);
        results.owner_error = ownerError.message;
      }
    } else {
      console.log('[initialize-company] No owner_email set, skipping owner provisioning');
    }

    // Log activity
    try {
      await supabase.from('company_activity_log').insert({
        tenant_id,
        activity_type: 'company_initialized',
        description: `Company initialized${results.owner_provisioned ? ` with owner ${results.owner_email}` : ''}`,
        metadata: results,
        created_by: created_by || null,
      });
    } catch (logError) {
      console.error('[initialize-company] Activity log error:', logError);
    }

    console.log('[initialize-company] Initialization complete:', results);

    return new Response(
      JSON.stringify({ 
        success: true, 
        tenant_id,
        initialized: results,
        message: `Company initialized with ${results.pipeline_stages} pipeline stages${results.owner_provisioned ? ` and owner ${results.owner_email}` : ''}`
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("[initialize-company] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { tenant_id, created_by } = await req.json();

    if (!tenant_id) {
      return new Response(
        JSON.stringify({ error: 'tenant_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[initialize-company] Initializing CRM skeleton for tenant: ${tenant_id}`);

    const results = {
      pipeline_stages: 0,
      commission_plans: 0,
      notification_templates: 0,
      activity_folder: false,
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

    // 1b. Create default job types
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

    const { error: jobTypesError } = await supabase
      .from('job_types')
      .insert(jobTypes);

    if (jobTypesError) {
      console.log('[initialize-company] Job types note:', jobTypesError.message);
    } else {
      console.log(`[initialize-company] Created ${jobTypes.length} job types`);
    }

    // 1c. Create default tags
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

    const { error: tagsError } = await supabase
      .from('tags')
      .insert(defaultTags);

    if (tagsError) {
      console.log('[initialize-company] Tags note:', tagsError.message);
    } else {
      console.log(`[initialize-company] Created ${defaultTags.length} tags`);
    }

    // 2. Create default commission plan
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

    // 3. Create default notification templates
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

    // 4. Create company activity storage folder marker
    try {
      const folderMarker = new Blob([''], { type: 'text/plain' });
      const { error: storageError } = await supabase.storage
        .from('company-data')
        .upload(`${tenant_id}/activity/.keep`, folderMarker, { 
          upsert: true,
          contentType: 'text/plain'
        });

      if (storageError) {
        // Bucket might not exist, try to create it
        console.log('[initialize-company] Storage folder creation note:', storageError.message);
      } else {
        results.activity_folder = true;
        console.log(`[initialize-company] Created activity folder for tenant`);
      }
    } catch (storageErr) {
      console.log('[initialize-company] Storage setup skipped:', storageErr);
    }

    // 5. Create default app settings
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

      const { error: settingsError } = await supabase
        .from('app_settings')
        .insert(defaultSettings);

      if (settingsError) {
        console.error('[initialize-company] Error creating app settings:', settingsError);
      } else {
        console.log('[initialize-company] Created default app settings');
      }
    }

    console.log(`[initialize-company] Initialization complete for tenant: ${tenant_id}`, results);

    return new Response(
      JSON.stringify({ 
        success: true, 
        tenant_id,
        initialized: results,
        message: `Company initialized with ${results.pipeline_stages} pipeline stages, ${results.commission_plans} commission plan, and ${results.notification_templates} notification templates`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[initialize-company] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

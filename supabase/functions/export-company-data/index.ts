import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Verify JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    // Check admin role
    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const isAdmin = userRoles?.some(r => ['master', 'corporate', 'office_admin'].includes(r.role));
    if (!isAdmin) {
      throw new Error('Only administrators can export company data');
    }

    const { tenant_id } = await req.json();
    if (!tenant_id) {
      throw new Error('Missing tenant_id');
    }

    console.log('[export-company-data] Starting export for tenant:', tenant_id);

    // Fetch company info
    const { data: company } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', tenant_id)
      .single();

    if (!company) {
      throw new Error('Company not found');
    }

    // Collect all data in parallel
    const [
      contacts,
      pipelineEntries,
      projects,
      estimates,
      documents,
      photos,
      callLogs,
      tasks
    ] = await Promise.all([
      supabase.from('contacts').select('*').eq('tenant_id', tenant_id),
      supabase.from('pipeline_entries').select('*').eq('tenant_id', tenant_id),
      supabase.from('projects').select('*').eq('tenant_id', tenant_id),
      supabase.from('enhanced_estimates').select('*').eq('tenant_id', tenant_id),
      supabase.from('documents').select('*').eq('tenant_id', tenant_id),
      supabase.from('photos').select('*').eq('tenant_id', tenant_id),
      supabase.from('call_logs').select('*').eq('tenant_id', tenant_id),
      supabase.from('tasks').select('*').eq('tenant_id', tenant_id)
    ]);

    // Create export package
    const exportData = {
      export_info: {
        company_name: company.name,
        tenant_id: tenant_id,
        exported_at: new Date().toISOString(),
        exported_by: user.id,
      },
      company_profile: company,
      contacts: contacts.data || [],
      pipeline_entries: pipelineEntries.data || [],
      projects: projects.data || [],
      estimates: estimates.data || [],
      documents: documents.data || [],
      photos: photos.data || [],
      call_logs: callLogs.data || [],
      tasks: tasks.data || []
    };

    const dataSummary = {
      contacts: (contacts.data || []).length,
      pipeline_entries: (pipelineEntries.data || []).length,
      projects: (projects.data || []).length,
      estimates: (estimates.data || []).length,
      documents: (documents.data || []).length,
      photos: (photos.data || []).length,
      call_logs: (callLogs.data || []).length,
      tasks: (tasks.data || []).length
    };

    console.log('[export-company-data] Data collected:', dataSummary);

    // Create JSON export
    const jsonExport = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonExport], { type: 'application/json' });
    
    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = company.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const fileName = `exports/${safeName}_${timestamp}.json`;

    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from('company-backups')
      .upload(fileName, blob, {
        contentType: 'application/json',
        upsert: false
      });

    if (uploadError) {
      throw new Error(`Failed to upload export: ${uploadError.message}`);
    }

    // Generate signed URL (24 hour expiry)
    const { data: signedUrl } = await supabase.storage
      .from('company-backups')
      .createSignedUrl(fileName, 86400);

    // Log export
    await supabase.from('audit_log').insert({
      action: 'EXPORT_COMPANY_DATA',
      table_name: 'tenants',
      record_id: tenant_id,
      tenant_id: tenant_id,
      changed_by: user.id,
      new_values: {
        file_path: fileName,
        data_summary: dataSummary
      }
    });

    console.log('[export-company-data] Export complete:', fileName);

    return new Response(JSON.stringify({
      success: true,
      message: 'Export created successfully',
      download_url: signedUrl?.signedUrl,
      file_path: fileName,
      data_summary: dataSummary,
      expires_at: new Date(Date.now() + 86400000).toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('[export-company-data] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
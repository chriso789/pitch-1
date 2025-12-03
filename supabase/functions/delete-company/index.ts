import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Extract request metadata for audit logging
  const ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown';
  const userAgent = req.headers.get('user-agent') || 'unknown';

  let userId: string | null = null;
  let companyId: string | null = null;
  let companyName: string | null = null;

  const logAudit = async (action: string, success: boolean, details: Record<string, any>) => {
    try {
      await supabase.from('audit_log').insert({
        tenant_id: companyId,
        table_name: 'tenants',
        record_id: companyId || 'unknown',
        action,
        changed_by: userId,
        old_values: {
          company_name: companyName,
          attempt_type: 'company_deletion',
          timestamp: new Date().toISOString(),
          ...details
        },
        new_values: {
          status: success ? 'deleted' : 'failed',
          ...details
        },
        ip_address: ipAddress,
        user_agent: userAgent,
        session_id: `deletion-${Date.now()}`
      });
    } catch (e) {
      console.error('Failed to log audit:', e);
    }
  };

  try {
    // Verify JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      await logAudit('DELETE_ATTEMPT_FAILED', false, { reason: 'No authorization header' });
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      await logAudit('DELETE_ATTEMPT_FAILED', false, { reason: 'Invalid token' });
      return new Response(JSON.stringify({ error: 'Unauthorized - Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    userId = user.id;

    // Check master role
    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);

    const isMaster = userRoles?.some(r => r.role === 'master');
    if (!isMaster) {
      await logAudit('DELETE_ATTEMPT_FAILED', false, { reason: 'Insufficient permissions - requires master role', user_id: userId });
      return new Response(JSON.stringify({ error: 'Only master administrators can delete companies' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Parse request body
    const body = await req.json();
    companyId = body.company_id;
    companyName = body.company_name;

    if (!companyId || !companyName) {
      await logAudit('DELETE_ATTEMPT_FAILED', false, { reason: 'Missing company_id or company_name' });
      return new Response(JSON.stringify({ error: 'company_id and company_name are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Verify company exists
    const { data: company, error: companyError } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', companyId)
      .single();

    if (companyError || !company) {
      await logAudit('DELETE_ATTEMPT_FAILED', false, { reason: 'Company not found', company_id: companyId });
      return new Response(JSON.stringify({ error: 'Company not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[delete-company] Starting deletion for company: ${companyName} (${companyId})`);

    // Collect all company data for backup
    const [
      { data: contacts },
      { data: pipelineEntries },
      { data: projects },
      { data: estimates },
      { data: profiles },
      { data: locations },
      { data: documents },
      { data: measurements }
    ] = await Promise.all([
      supabase.from('contacts').select('*').eq('tenant_id', companyId),
      supabase.from('pipeline_entries').select('*').eq('tenant_id', companyId),
      supabase.from('projects').select('*').eq('tenant_id', companyId),
      supabase.from('enhanced_estimates').select('*').eq('tenant_id', companyId),
      supabase.from('profiles').select('*').eq('tenant_id', companyId),
      supabase.from('locations').select('*').eq('tenant_id', companyId),
      supabase.from('documents').select('*').eq('tenant_id', companyId),
      supabase.from('measurements').select('*').eq('tenant_id', companyId)
    ]);

    // Create backup object
    const backupData = {
      company,
      contacts: contacts || [],
      pipeline_entries: pipelineEntries || [],
      projects: projects || [],
      estimates: estimates || [],
      profiles: profiles || [],
      locations: locations || [],
      documents: documents || [],
      measurements: measurements || [],
      deleted_at: new Date().toISOString(),
      deleted_by: userId
    };

    const dataSummary = {
      contacts: contacts?.length || 0,
      pipeline_entries: pipelineEntries?.length || 0,
      projects: projects?.length || 0,
      estimates: estimates?.length || 0,
      profiles: profiles?.length || 0,
      locations: locations?.length || 0,
      documents: documents?.length || 0,
      measurements: measurements?.length || 0
    };

    // Store backup in Supabase Storage
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `deletions/${companyId}/${timestamp}-backup.json`;
    const backupJson = JSON.stringify(backupData, null, 2);
    const backupBytes = new TextEncoder().encode(backupJson);

    const { error: uploadError } = await supabase.storage
      .from('company-backups')
      .upload(backupPath, backupBytes, {
        contentType: 'application/json',
        upsert: true
      });

    if (uploadError) {
      console.error('[delete-company] Backup upload failed:', uploadError);
      await logAudit('DELETE_ATTEMPT_FAILED', false, { 
        reason: 'Backup creation failed', 
        error: uploadError.message 
      });
      return new Response(JSON.stringify({ error: 'Failed to create backup' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[delete-company] Backup created at: ${backupPath}`);

    // Get user info for logging
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('first_name, last_name, email')
      .eq('id', userId)
      .single();

    // Log to company_deletion_backups
    const { error: logError } = await supabase
      .from('company_deletion_backups')
      .insert({
        company_id: companyId,
        company_name: companyName,
        deleted_by: userId,
        deleted_by_name: userProfile ? `${userProfile.first_name} ${userProfile.last_name}` : 'Unknown',
        deleted_by_email: userProfile?.email,
        backup_storage_path: backupPath,
        backup_size_bytes: backupBytes.length,
        email_sent_to: 'chrisobrien91@gmail.com',
        email_sent_at: new Date().toISOString(),
        data_summary: dataSummary,
        status: 'completed'
      });

    if (logError) {
      console.error('[delete-company] Failed to log deletion:', logError);
    }

    // Delete the company (cascades to related data)
    const { error: deleteError } = await supabase
      .from('tenants')
      .delete()
      .eq('id', companyId);

    if (deleteError) {
      console.error('[delete-company] Delete failed:', deleteError);
      await logAudit('DELETE_ATTEMPT_FAILED', false, { 
        reason: 'Database deletion failed', 
        error: deleteError.message,
        backup_path: backupPath
      });
      return new Response(JSON.stringify({ error: 'Failed to delete company' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Log successful deletion
    await logAudit('DELETE', true, {
      backup_path: backupPath,
      data_summary: dataSummary,
      email_sent_to: 'chrisobrien91@gmail.com'
    });

    console.log(`[delete-company] Successfully deleted company: ${companyName}`);

    return new Response(JSON.stringify({ 
      success: true, 
      message: `Company "${companyName}" deleted successfully`,
      backup_path: backupPath,
      data_summary: dataSummary
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('[delete-company] Unexpected error:', error);
    await logAudit('DELETE_ATTEMPT_FAILED', false, { 
      reason: 'Unexpected error', 
      error: error.message 
    });
    return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
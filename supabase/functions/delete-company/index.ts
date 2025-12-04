import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// Pre-deletion check: identify blocking FK constraints
async function checkBlockingConstraints(supabase: any, companyId: string) {
  const blockingRecords: { table: string; column: string; count: number; canAutoClear: boolean }[] = [];
  
  // Check profiles with active_tenant_id set to this company (from OTHER companies)
  const { count: activeProfilesCount } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('active_tenant_id', companyId)
    .neq('tenant_id', companyId);
  
  if (activeProfilesCount && activeProfilesCount > 0) {
    blockingRecords.push({
      table: 'profiles',
      column: 'active_tenant_id',
      count: activeProfilesCount,
      canAutoClear: true // Safe to reset to null
    });
  }

  // Check user_company_access for users with access to this company
  const { count: companyAccessCount } = await supabase
    .from('user_company_access')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', companyId);

  if (companyAccessCount && companyAccessCount > 0) {
    blockingRecords.push({
      table: 'user_company_access',
      column: 'tenant_id',
      count: companyAccessCount,
      canAutoClear: true // Safe to delete access records
    });
  }
  
  return blockingRecords;
}

// Clear blocking records that are safe to auto-clear
async function clearBlockingRecords(supabase: any, companyId: string) {
  const cleared: string[] = [];
  
  // Reset active_tenant_id for users from other companies
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ active_tenant_id: null })
    .eq('active_tenant_id', companyId)
    .neq('tenant_id', companyId);
    
  if (!profileError) {
    cleared.push('profiles.active_tenant_id');
  } else {
    console.log('[delete-company] Warning: Could not clear profiles.active_tenant_id:', profileError);
  }

  // Delete user_company_access records for this company
  const { error: accessError } = await supabase
    .from('user_company_access')
    .delete()
    .eq('tenant_id', companyId);

  if (!accessError) {
    cleared.push('user_company_access');
  } else {
    console.log('[delete-company] Warning: Could not clear user_company_access:', accessError);
  }

  // Delete settings_tabs for this company
  const { error: settingsError } = await supabase
    .from('settings_tabs')
    .delete()
    .eq('tenant_id', companyId);

  if (!settingsError) {
    cleared.push('settings_tabs');
  } else {
    console.log('[delete-company] Warning: Could not clear settings_tabs:', settingsError);
  }

  // Delete pipeline_stages for this company
  const { error: stagesError } = await supabase
    .from('pipeline_stages')
    .delete()
    .eq('tenant_id', companyId);

  if (!stagesError) {
    cleared.push('pipeline_stages');
  } else {
    console.log('[delete-company] Warning: Could not clear pipeline_stages:', stagesError);
  }

  console.log('[delete-company] Cleared blocking records:', cleared);
  return cleared;
}

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

    // PRE-DELETION CHECK: Identify blocking constraints
    console.log('[delete-company] Running pre-deletion constraint check...');
    const blockingRecords = await checkBlockingConstraints(supabase, companyId);
    
    if (blockingRecords.length > 0) {
      console.log('[delete-company] Found blocking records:', blockingRecords);
      
      // Check if any blocking records cannot be auto-cleared
      const unclearableBlocking = blockingRecords.filter(r => !r.canAutoClear);
      if (unclearableBlocking.length > 0) {
        await logAudit('DELETE_ATTEMPT_FAILED', false, { 
          reason: 'Blocking foreign key constraints that cannot be auto-cleared', 
          blocking_records: unclearableBlocking 
        });
        return new Response(JSON.stringify({ 
          error: 'Cannot delete company due to blocking references',
          blocking_records: unclearableBlocking
        }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Clear blocking records before proceeding
    console.log('[delete-company] Clearing blocking records...');
    const clearedRecords = await clearBlockingRecords(supabase, companyId);

    // Collect all company data for backup
    const [
      { data: contacts },
      { data: pipelineEntries },
      { data: projects },
      { data: estimates },
      { data: profiles },
      { data: locations },
      { data: documents },
      { data: settingsTabs },
      { data: pipelineStages },
      { data: userCompanyAccess }
    ] = await Promise.all([
      supabase.from('contacts').select('*').eq('tenant_id', companyId),
      supabase.from('pipeline_entries').select('*').eq('tenant_id', companyId),
      supabase.from('projects').select('*').eq('tenant_id', companyId),
      supabase.from('enhanced_estimates').select('*').eq('tenant_id', companyId),
      supabase.from('profiles').select('*').eq('tenant_id', companyId),
      supabase.from('locations').select('*').eq('tenant_id', companyId),
      supabase.from('documents').select('*').eq('tenant_id', companyId),
      supabase.from('settings_tabs').select('*').eq('tenant_id', companyId),
      supabase.from('pipeline_stages').select('*').eq('tenant_id', companyId),
      supabase.from('user_company_access').select('*').eq('tenant_id', companyId)
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
      settings_tabs: settingsTabs || [],
      pipeline_stages: pipelineStages || [],
      user_company_access: userCompanyAccess || [],
      cleared_blocking_records: clearedRecords,
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
      settings_tabs: settingsTabs?.length || 0,
      pipeline_stages: pipelineStages?.length || 0,
      user_company_access: userCompanyAccess?.length || 0
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

    // Delete the company (cascades to related data via FK constraints)
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
      return new Response(JSON.stringify({ 
        error: 'Failed to delete company',
        details: deleteError.message 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Log successful deletion - use null tenant_id since company no longer exists
    // (company_deletion_backups already captures full audit trail)
    try {
      await supabase.from('audit_log').insert({
        tenant_id: null, // Company no longer exists - FK would fail
        table_name: 'tenants',
        record_id: companyId,
        action: 'DELETE',
        changed_by: userId,
        old_values: {
          company_name: companyName,
          attempt_type: 'company_deletion',
          timestamp: new Date().toISOString(),
          backup_path: backupPath,
          data_summary: dataSummary,
          cleared_blocking_records: clearedRecords,
          email_sent_to: 'chrisobrien91@gmail.com'
        },
        new_values: {
          status: 'deleted'
        },
        ip_address: ipAddress,
        user_agent: userAgent,
        session_id: `deletion-${Date.now()}`
      });
    } catch (auditErr) {
      // Silent fail - company_deletion_backups already has full audit trail
      console.log('[delete-company] Post-deletion audit log skipped (expected if FK constraint):', auditErr);
    }

    console.log(`[delete-company] Successfully deleted company: ${companyName}`);

    return new Response(JSON.stringify({ 
      success: true, 
      message: `Company "${companyName}" deleted successfully`,
      backup_path: backupPath,
      data_summary: dataSummary,
      cleared_blocking_records: clearedRecords
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

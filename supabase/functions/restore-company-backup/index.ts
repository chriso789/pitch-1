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

    // Check master role
    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const isMaster = userRoles?.some(r => r.role === 'master');
    if (!isMaster) {
      throw new Error('Only master administrators can restore backups');
    }

    const { backup_path, target_tenant_id, tables_to_restore } = await req.json();

    if (!backup_path || !target_tenant_id) {
      throw new Error('Missing backup_path or target_tenant_id');
    }

    console.log('[restore-company-backup] Starting restoration:', {
      backup_path,
      target_tenant_id,
      tables_to_restore,
      user_id: user.id
    });

    // Download backup from storage
    const { data: backupFile, error: downloadError } = await supabase.storage
      .from('company-backups')
      .download(backup_path);

    if (downloadError || !backupFile) {
      throw new Error(`Failed to download backup: ${downloadError?.message}`);
    }

    const backupText = await backupFile.text();
    const backupData = JSON.parse(backupText);

    console.log('[restore-company-backup] Backup loaded, keys:', Object.keys(backupData));

    // Default tables to restore if not specified
    const tablesToRestore = tables_to_restore || [
      'contacts',
      'pipeline_entries',
      'projects',
      'estimates',
      'documents',
      'photos'
    ];

    const results: Record<string, { success: boolean; count: number; error?: string }> = {};

    // Restore each table
    for (const tableName of tablesToRestore) {
      const tableData = backupData[tableName];
      if (!tableData || !Array.isArray(tableData) || tableData.length === 0) {
        results[tableName] = { success: true, count: 0 };
        continue;
      }

      try {
        // Update tenant_id to target tenant
        const updatedData = tableData.map((row: any) => ({
          ...row,
          tenant_id: target_tenant_id,
          id: undefined, // Let database generate new IDs
        }));

        const { error: insertError } = await supabase
          .from(tableName)
          .insert(updatedData);

        if (insertError) {
          results[tableName] = { success: false, count: 0, error: insertError.message };
        } else {
          results[tableName] = { success: true, count: tableData.length };
        }
      } catch (tableError: any) {
        results[tableName] = { success: false, count: 0, error: tableError.message };
      }
    }

    // Log restoration attempt
    await supabase.from('audit_log').insert({
      action: 'RESTORE_BACKUP',
      table_name: 'company_backups',
      record_id: target_tenant_id,
      changed_by: user.id,
      new_values: {
        backup_path,
        tables_restored: tablesToRestore,
        results
      }
    });

    const successCount = Object.values(results).filter(r => r.success).length;
    const totalRecords = Object.values(results).reduce((sum, r) => sum + r.count, 0);

    console.log('[restore-company-backup] Restoration complete:', {
      tables_processed: tablesToRestore.length,
      success_count: successCount,
      total_records: totalRecords
    });

    return new Response(JSON.stringify({
      success: true,
      message: `Restored ${totalRecords} records across ${successCount} tables`,
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('[restore-company-backup] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
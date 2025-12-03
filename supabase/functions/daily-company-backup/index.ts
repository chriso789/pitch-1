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

  console.log('[daily-company-backup] Starting daily backup job...');

  try {
    // Get all active companies
    const { data: companies, error: companiesError } = await supabase
      .from('tenants')
      .select('id, name')
      .eq('is_active', true);

    if (companiesError) {
      throw new Error(`Failed to fetch companies: ${companiesError.message}`);
    }

    console.log(`[daily-company-backup] Found ${companies?.length || 0} active companies`);

    const results: Array<{ company: string; status: string; path?: string; error?: string }> = [];

    for (const company of companies || []) {
      try {
        console.log(`[daily-company-backup] Backing up: ${company.name}`);

        // Collect all company data
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
          supabase.from('contacts').select('*').eq('tenant_id', company.id),
          supabase.from('pipeline_entries').select('*').eq('tenant_id', company.id),
          supabase.from('projects').select('*').eq('tenant_id', company.id),
          supabase.from('enhanced_estimates').select('*').eq('tenant_id', company.id),
          supabase.from('profiles').select('*').eq('tenant_id', company.id),
          supabase.from('locations').select('*').eq('tenant_id', company.id),
          supabase.from('documents').select('*').eq('tenant_id', company.id),
          supabase.from('measurements').select('*').eq('tenant_id', company.id)
        ]);

        // Create backup object
        const backupData = {
          company_id: company.id,
          company_name: company.name,
          backup_date: new Date().toISOString(),
          backup_type: 'daily_auto',
          data: {
            contacts: contacts || [],
            pipeline_entries: pipelineEntries || [],
            projects: projects || [],
            estimates: estimates || [],
            profiles: profiles || [],
            locations: locations || [],
            documents: documents || [],
            measurements: measurements || []
          }
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
        const date = new Date().toISOString().split('T')[0];
        const backupPath = `daily/${company.id}/${date}-backup.json`;
        const backupJson = JSON.stringify(backupData, null, 2);
        const backupBytes = new TextEncoder().encode(backupJson);

        const { error: uploadError } = await supabase.storage
          .from('company-backups')
          .upload(backupPath, backupBytes, {
            contentType: 'application/json',
            upsert: true
          });

        if (uploadError) {
          throw new Error(`Upload failed: ${uploadError.message}`);
        }

        // Log to company_backups table
        await supabase.from('company_backups').insert({
          tenant_id: company.id,
          company_name: company.name,
          backup_type: 'daily_auto',
          backup_storage_path: backupPath,
          backup_size_bytes: backupBytes.length,
          data_summary: dataSummary,
          status: 'completed'
        });

        results.push({ 
          company: company.name, 
          status: 'success', 
          path: backupPath 
        });

        console.log(`[daily-company-backup] Completed backup for: ${company.name}`);

      } catch (companyError: any) {
        console.error(`[daily-company-backup] Failed for ${company.name}:`, companyError);

        // Log failed backup
        await supabase.from('company_backups').insert({
          tenant_id: company.id,
          company_name: company.name,
          backup_type: 'daily_auto',
          backup_storage_path: '',
          status: 'failed',
          error_message: companyError.message
        });

        results.push({ 
          company: company.name, 
          status: 'failed', 
          error: companyError.message 
        });
      }
    }

    const successCount = results.filter(r => r.status === 'success').length;
    const failCount = results.filter(r => r.status === 'failed').length;

    console.log(`[daily-company-backup] Completed. Success: ${successCount}, Failed: ${failCount}`);

    return new Response(JSON.stringify({
      success: true,
      total_companies: companies?.length || 0,
      successful_backups: successCount,
      failed_backups: failCount,
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('[daily-company-backup] Fatal error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
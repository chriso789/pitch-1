import { supabaseService } from '../_shared/supabase.ts';
import { corsHeaders } from '../_shared/cors.ts';

// Edge function to auto-close capped-out pipeline entries after X days
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const serviceClient = supabaseService();

    // Get all pipeline stages with auto_close_days configured
    const { data: stages, error: stagesError } = await serviceClient
      .from('pipeline_stages')
      .select('id, key, tenant_id, auto_close_days')
      .not('auto_close_days', 'is', null)
      .gt('auto_close_days', 0);

    if (stagesError) throw stagesError;
    if (!stages || stages.length === 0) {
      return new Response(JSON.stringify({ message: 'No auto-close stages configured', closed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let totalClosed = 0;

    for (const stage of stages) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - stage.auto_close_days!);

      // Find entries in this stage that have been there longer than auto_close_days
      const { data: entries, error: entriesError } = await serviceClient
        .from('pipeline_entries')
        .select('id')
        .eq('tenant_id', stage.tenant_id)
        .eq('status', stage.key)
        .eq('is_deleted', false)
        .lt('updated_at', cutoffDate.toISOString());

      if (entriesError) {
        console.error(`Error fetching entries for stage ${stage.key}:`, entriesError);
        continue;
      }

      if (!entries || entries.length === 0) continue;

      // Move them to 'closed'
      const entryIds = entries.map(e => e.id);
      const { error: updateError } = await serviceClient
        .from('pipeline_entries')
        .update({ status: 'closed', updated_at: new Date().toISOString() })
        .in('id', entryIds);

      if (updateError) {
        console.error(`Error closing entries for stage ${stage.key}:`, updateError);
        continue;
      }

      // Audit log
      for (const entry of entries) {
        await serviceClient.from('audit_log').insert({
          tenant_id: stage.tenant_id,
          changed_by: null,
          action: 'UPDATE',
          table_name: 'pipeline_entries',
          record_id: entry.id,
          old_values: { status: stage.key },
          new_values: { status: 'closed', auto_closed: true, auto_close_days: stage.auto_close_days }
        }).catch(err => console.error('Audit log error:', err));
      }

      totalClosed += entries.length;
      console.log(`Auto-closed ${entries.length} entries from stage ${stage.key} (tenant: ${stage.tenant_id})`);
    }

    return new Response(JSON.stringify({ 
      message: `Auto-closed ${totalClosed} entries`,
      closed: totalClosed 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in pipeline-auto-close:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? (error instanceof Error ? error.message : String(error)) : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
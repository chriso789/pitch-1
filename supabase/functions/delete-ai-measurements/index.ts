import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { corsHeaders } from '../_shared/cors.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('tenant_id, active_tenant_id')
      .eq('id', user.id)
      .single();

    const tenantId = profile?.active_tenant_id || profile?.tenant_id;
    if (profileError || !tenantId) {
      return jsonResponse({ success: false, error: 'No tenant found for user' }, 400);
    }

    const body = await req.json().catch(() => ({}));
    const pipelineEntryId = typeof body.pipelineEntryId === 'string' ? body.pipelineEntryId : null;
    const rawIds: unknown[] = Array.isArray(body.measurementIds)
      ? body.measurementIds
      : typeof body.measurementId === 'string'
        ? [body.measurementId]
        : [];

    const allIds = [...new Set(rawIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
    // History rows for raw AI Pull jobs (no roof_measurements row) come in with `job-<uuid>` ids
    const jobIds = allIds.filter((id) => id.startsWith('job-')).map((id) => id.slice(4));
    const measurementIds = allIds.filter((id) => !id.startsWith('job-'));

    if (!pipelineEntryId || allIds.length === 0) {
      return jsonResponse({ success: false, error: 'pipelineEntryId and measurementIds are required' }, 400);
    }

    // Look up pipeline entry - check user's tenant OR allow master users to access child tenants
    const { data: pipelineEntry, error: pipelineEntryError } = await supabase
      .from('pipeline_entries')
      .select('id, tenant_id')
      .eq('id', pipelineEntryId)
      .single();

    if (pipelineEntryError || !pipelineEntry) {
      return jsonResponse({ success: false, error: 'Lead not found or access denied' }, 404);
    }

    // Verify user has access: either their tenant matches the pipeline entry's tenant,
    // or they have access via user_company_access
    const peTenantId = pipelineEntry.tenant_id;
    if (peTenantId !== tenantId) {
      const { data: access } = await supabase
        .from('user_company_access')
        .select('id')
        .eq('user_id', user.id)
        .eq('company_id', peTenantId)
        .maybeSingle();

      if (!access) {
        return jsonResponse({ success: false, error: 'Lead not found or access denied' }, 404);
      }
    }

    // Look up measurements - they may be under the pipeline entry's tenant OR the user's tenant
    const { data: measurements, error: measurementsError } = measurementIds.length > 0
      ? await supabase
          .from('roof_measurements')
          .select('id, created_at, ai_measurement_job_id')
          .in('id', measurementIds)
          .eq('customer_id', pipelineEntryId)
      : { data: [] as any[], error: null };

    if (measurementsError) throw measurementsError;

    const foundMeasurementIds = (measurements || []).map((measurement) => measurement.id);
    // IDs that no longer exist in roof_measurements are treated as already-deleted
    // (idempotent delete). The UI may have a stale cache from a prior deletion or
    // an out-of-band cleanup. We still report them as "deleted" so the cache clears.
    const alreadyMissingIds = measurementIds.filter((id) => !foundMeasurementIds.includes(id));
    if (alreadyMissingIds.length > 0) {
      console.warn('delete-ai-measurements: treating missing IDs as already-deleted', {
        missingIds: alreadyMissingIds,
        tenantId,
        peTenantId,
      });
    }

    const importedAtValues = new Set(
      (measurements || [])
        .map((measurement) => measurement.created_at)
        .filter((value): value is string => Boolean(value))
    );

    let linkedApprovalIds: string[] = [];
    if (foundMeasurementIds.length > 0) {
      const { data: approvals, error: approvalsError } = await supabase
        .from('measurement_approvals')
        .select('id, measurement_id, saved_tags')
        .eq('pipeline_entry_id', pipelineEntryId)
        .eq('tenant_id', tenantId);

      if (approvalsError) throw approvalsError;

      linkedApprovalIds = (approvals || [])
        .filter((approval) => {
          const importedAt = typeof approval.saved_tags === 'object' && approval.saved_tags !== null
            ? (approval.saved_tags as Record<string, unknown>).imported_at
            : null;

          return foundMeasurementIds.includes(approval.measurement_id || '') ||
            (typeof importedAt === 'string' && importedAtValues.has(importedAt));
        })
        .map((approval) => approval.id);

      const approvalIdsToUnlink = (approvals || [])
        .filter((approval) => foundMeasurementIds.includes(approval.measurement_id || ''))
        .map((approval) => approval.id);

      if (approvalIdsToUnlink.length > 0) {
        const { error: unlinkApprovalsError } = await supabase
          .from('measurement_approvals')
          .update({ measurement_id: null })
          .in('id', approvalIdsToUnlink);

        if (unlinkApprovalsError) throw unlinkApprovalsError;
      }

      const { error: unlinkEstimatesError } = await supabase
        .from('enhanced_estimates')
        .update({ measurement_report_id: null })
        .in('measurement_report_id', foundMeasurementIds);

      if (unlinkEstimatesError) throw unlinkEstimatesError;

      const { error: unlinkValidationError } = await supabase
        .from('roof_measurement_validation_tests')
        .update({ measurement_id: null })
        .in('measurement_id', foundMeasurementIds);

      if (unlinkValidationError) throw unlinkValidationError;
    }

    let deletedMeasurementIds: string[] = [];
    if (foundMeasurementIds.length > 0) {
      const { data: deletedMeasurements, error: deleteMeasurementsError } = await supabase
        .from('roof_measurements')
        .delete()
        .in('id', foundMeasurementIds)
        .select('id');

      if (deleteMeasurementsError) throw deleteMeasurementsError;
      deletedMeasurementIds = (deletedMeasurements || []).map((m) => m.id);
      if (deletedMeasurementIds.length !== foundMeasurementIds.length) {
        return jsonResponse({ success: false, error: 'Some measurements could not be removed from history' }, 500);
      }
    }

    // ── Delete job-only history rows AND parent jobs of deleted measurements ──
    // (otherwise the parent ai_measurement_jobs row reappears as orphaned history)
    const linkedJobIds = (measurements || [])
      .map((m: any) => m.ai_measurement_job_id)
      .filter((id: any): id is string => typeof id === 'string' && id.length > 0);
    const allJobIdsToDelete = [...new Set([...jobIds, ...linkedJobIds])];

    let deletedJobIds: string[] = [];
    if (allJobIdsToDelete.length > 0) {
      // Verify the jobs belong to this lead before deleting (defense-in-depth; service key bypasses RLS)
      const { data: jobsToDelete, error: jobsLookupError } = await supabase
        .from('ai_measurement_jobs')
        .select('id')
        .in('id', allJobIdsToDelete)
        .or(`lead_id.eq.${pipelineEntryId},source_record_id.eq.${pipelineEntryId}`);

      if (jobsLookupError) throw jobsLookupError;

      const validJobIds = (jobsToDelete || []).map((j) => j.id);
      if (validJobIds.length > 0) {
        const { data: deletedJobs, error: deleteJobsError } = await supabase
          .from('ai_measurement_jobs')
          .delete()
          .in('id', validJobIds)
          .select('id');

        if (deleteJobsError) throw deleteJobsError;
        deletedJobIds = (deletedJobs || []).map((j) => j.id);
      }
    }

    return jsonResponse({
      success: true,
      deletedMeasurementIds: [
        ...deletedMeasurementIds,
        ...alreadyMissingIds,
        ...deletedJobIds.map((id) => `job-${id}`),
      ],
      deletedJobIds,
      alreadyMissingIds,
      linkedApprovalIds,
    });
  } catch (error) {
    console.error('delete-ai-measurements error:', error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unexpected error deleting measurements',
    }, 500);
  }
});
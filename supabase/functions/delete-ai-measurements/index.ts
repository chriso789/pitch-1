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
    const rawIds = Array.isArray(body.measurementIds)
      ? body.measurementIds
      : typeof body.measurementId === 'string'
        ? [body.measurementId]
        : [];

    const measurementIds = [...new Set(rawIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];

    if (!pipelineEntryId || measurementIds.length === 0) {
      return jsonResponse({ success: false, error: 'pipelineEntryId and measurementIds are required' }, 400);
    }

    const { data: pipelineEntry, error: pipelineEntryError } = await supabase
      .from('pipeline_entries')
      .select('id, tenant_id')
      .eq('id', pipelineEntryId)
      .eq('tenant_id', tenantId)
      .single();

    if (pipelineEntryError || !pipelineEntry) {
      return jsonResponse({ success: false, error: 'Lead not found or access denied' }, 404);
    }

    const { data: measurements, error: measurementsError } = await supabase
      .from('roof_measurements')
      .select('id, created_at')
      .in('id', measurementIds)
      .eq('tenant_id', tenantId)
      .eq('customer_id', pipelineEntryId);

    if (measurementsError) throw measurementsError;

    const foundMeasurementIds = (measurements || []).map((measurement) => measurement.id);
    if (foundMeasurementIds.length !== measurementIds.length) {
      const missingIds = measurementIds.filter((id) => !foundMeasurementIds.includes(id));
      return jsonResponse({
        success: false,
        error: missingIds.length === 1
          ? 'Measurement could not be removed from history'
          : 'Some measurements could not be removed from history',
        missingIds,
      }, 404);
    }

    const importedAtValues = new Set(
      (measurements || [])
        .map((measurement) => measurement.created_at)
        .filter((value): value is string => Boolean(value))
    );

    const { data: approvals, error: approvalsError } = await supabase
      .from('measurement_approvals')
      .select('id, measurement_id, saved_tags')
      .eq('pipeline_entry_id', pipelineEntryId)
      .eq('tenant_id', tenantId);

    if (approvalsError) throw approvalsError;

    const linkedApprovalIds = (approvals || [])
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
      .in('measurement_report_id', foundMeasurementIds)
      .eq('tenant_id', tenantId);

    if (unlinkEstimatesError) throw unlinkEstimatesError;

    const { error: unlinkValidationError } = await supabase
      .from('roof_measurement_validation_tests')
      .update({ measurement_id: null })
      .in('measurement_id', foundMeasurementIds);

    if (unlinkValidationError) throw unlinkValidationError;

    const { data: deletedMeasurements, error: deleteMeasurementsError } = await supabase
      .from('roof_measurements')
      .delete()
      .in('id', foundMeasurementIds)
      .select('id');

    if (deleteMeasurementsError) throw deleteMeasurementsError;

    const deletedMeasurementIds = (deletedMeasurements || []).map((measurement) => measurement.id);
    if (deletedMeasurementIds.length !== foundMeasurementIds.length) {
      return jsonResponse({ success: false, error: 'Some measurements could not be removed from history' }, 500);
    }

    return jsonResponse({
      success: true,
      deletedMeasurementIds,
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
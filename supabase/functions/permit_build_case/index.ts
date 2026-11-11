// ============================================
// PERMIT BUILD CASE - Main Orchestrator Edge Function
// POST /functions/v1/permit_build_case
// ============================================

import { z } from 'npm:zod@3.23.8';

import { supabaseAuth, getAuthUser, supabaseService } from '../_shared/supabase.ts';
import { jsonOK, jsonErr, handleCors } from '../_shared/response.ts';
import { buildPermitContext } from '../_shared/context_builder.ts';
import { evalTemplate } from '../_shared/template_eval.ts';
import { generateChecklistPdf, generatePermitPacket, permitAttachments, fillPermitPdf } from '../_shared/pdf_fill.ts';
import { uploadBytes, signedUrlForPath } from '../_shared/storage.ts';
import { nowIso, versionedDocPath } from '../_shared/util.ts';
import type {
  PermitBuildCaseRequest,
  PermitBuildCaseResponse,
  CanonicalPermitContext,
  MissingItem,
  ValidationError,
  NextAction,
  ContextPreview,
  PermitDocumentOutput,
} from '../_shared/permit_types.ts';

// Request validation schema
const ReqSchema = z.object({
  job_id: z.string().uuid(),
  estimate_id: z.string().uuid().nullable().optional(),
  options: z.object({
    force_rebuild: z.boolean().optional(),
    auto_detect_jurisdiction: z.boolean().optional(),
    auto_fetch_parcel: z.boolean().optional(),
    parcel_cache_ttl_days: z.number().int().min(0).optional(),
    auto_link_approvals: z.boolean().optional(),
    auto_extract_approval_fields: z.boolean().optional(),
    generate_application_pdf: z.boolean().optional(),
    generate_packet_zip: z.boolean().optional(),
    include_checklist_pdf: z.boolean().optional(),
    dry_run: z.boolean().optional(),
  }).optional(),
});

Deno.serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    if (req.method !== 'POST') {
      return jsonErr(405, 'METHOD_NOT_ALLOWED', 'Use POST');
    }

    const body = await req.json().catch(() => null);
    const parsed = ReqSchema.safeParse(body);
    if (!parsed.success) {
      return jsonErr(400, 'INVALID_REQUEST', 'Invalid payload', {
        issues: parsed.error.issues,
      });
    }

    const payload = parsed.data as PermitBuildCaseRequest;
    const options = payload.options || {};

    // Authenticate user
    const sb = supabaseAuth(req);
    const user = await getAuthUser(sb);
    
    if (!user) {
      return jsonErr(401, 'UNAUTHORIZED', 'Authentication required');
    }

    const tenantId = user.tenantId;
    if (!tenantId) {
      return jsonErr(403, 'FORBIDDEN', 'No active company found');
    }

    // Use service client for write operations
    const adminSb = supabaseService();

    // Step 1: Upsert / reuse permit case (idempotent)
    const permitCase = await upsertPermitCase(adminSb, {
      tenant_id: tenantId,
      job_id: payload.job_id,
      estimate_id: payload.estimate_id ?? null,
      created_by: user.id,
      force_rebuild: !!options.force_rebuild,
    });

    // Step 2: Build Permit Context (includes all data gathering)
    const { context, missing: contextMissing } = await buildPermitContext(adminSb, {
      tenant_id: tenantId,
      permit_case_id: permitCase.id,
      job_id: payload.job_id,
      estimate_id: payload.estimate_id ?? null,
      options: {
        auto_fetch_parcel: options.auto_fetch_parcel,
        parcel_cache_ttl_days: options.parcel_cache_ttl_days,
        auto_link_approvals: options.auto_link_approvals,
      },
    });

    // Step 3: Evaluate template fields + calcs + validations
    const {
      application_field_values,
      calculation_results,
      validation_errors: templateValErrors,
      template_missing_items,
      output_plan,
    } = evalTemplate({
      context,
      template_json: context.meta.template_json,
    });

    // Step 4: Combine all missing items
    const missing_items: MissingItem[] = [
      ...contextMissing,
      ...template_missing_items,
    ];

    // Combine validation errors
    const validation_errors: ValidationError[] = templateValErrors;

    // Step 5: Compute next status
    const status = computeNextStatus(missing_items, validation_errors);

    // Step 6: Persist summary to permit_cases (if not dry_run)
    if (!options.dry_run) {
      await persistPermitCaseSummary(adminSb, {
        tenant_id: tenantId,
        permit_case_id: permitCase.id,
        authority_id: context.authority?.id ?? null,
        template_id: context.meta.template_id,
        jurisdiction: context.permit_case,
        application_field_values,
        calculation_results,
        missing_items,
        validation_errors,
        status,
      });

      await emitPermitEvent(adminSb, {
        tenant_id: tenantId,
        permit_case_id: permitCase.id,
        event_type: 'CALCS_RUN',
        message: 'Template evaluated and fields resolved',
        details: { sources_used: context.meta.sources_used },
        created_by: user.id,
      });
    }

    // Step 7: Generate outputs (if enabled and not dry_run)
    const documents: PermitDocumentOutput[] = [];

    if (!options.dry_run && status === 'DRAFT_BUILT' && options.generate_application_pdf !== false) {
      try {
        const appPdfBytes = await fillPermitPdf({
          supabase: adminSb,
          template_pdf_bucket: context.meta.template_pdf_bucket || output_plan?.application_pdf?.input_pdf_storage?.bucket || null,
          template_pdf_path: context.meta.template_pdf_path || output_plan?.application_pdf?.input_pdf_storage?.path || null,
          field_values: application_field_values,
          field_map: output_plan?.application_pdf?.field_map || [],
        });

        const bucket = 'permits';
        const path = versionedDocPath({
          tenant_id: tenantId,
          permit_case_id: permitCase.id,
          filename: 'application.pdf',
        });

        await uploadBytes(adminSb, { bucket, path, bytes: appPdfBytes, contentType: 'application/pdf' });
        const signed_url = await signedUrlForPath(adminSb, { bucket, path, expiresInSec: 3600 });

        const docRow = await insertPermitDocument(adminSb, {
          tenant_id: tenantId,
          permit_case_id: permitCase.id,
          kind: 'PERMIT_APPLICATION',
          title: 'Permit Application',
          bucket,
          path,
          created_by: user.id,
        });

        documents.push({
          id: docRow.id,
          kind: 'PERMIT_APPLICATION',
          title: 'Permit Application',
          bucket,
          path,
          signed_url,
          content_type: 'application/pdf',
        });

        await emitPermitEvent(adminSb, {
          tenant_id: tenantId,
          permit_case_id: permitCase.id,
          event_type: 'APPLICATION_GENERATED',
          message: 'Application PDF generated',
          details: { bucket, path },
          created_by: user.id,
        });
      } catch (err) {
        console.error('PDF generation failed:', err);
        throw err;
      }
    }

    if (!options.dry_run && status === 'DRAFT_BUILT' && options.include_checklist_pdf) {
      const attachments = await permitAttachments(adminSb, tenantId, permitCase.id);
      const bytes = await generateChecklistPdf({ permit_case_id: permitCase.id,
        authority_name: context.authority?.county_name || 'Permitting authority',
        required_attachments: context.authority?.default_required_attachments || [],
        available_attachments: attachments.flatMap((doc: any) => [doc.kind, doc.title]),
      });
      const bucket = 'permits';
      const path = versionedDocPath({ tenant_id: tenantId, permit_case_id: permitCase.id, filename: 'checklist.pdf' });
      await uploadBytes(adminSb, { bucket, path, bytes, contentType: 'application/pdf' });
      const row = await insertPermitDocument(adminSb, { tenant_id: tenantId, permit_case_id: permitCase.id,
        kind: 'CHECKLIST', title: 'Submission Checklist', bucket, path, created_by: user.id });
      documents.push({ id: row.id, kind: 'CHECKLIST', title: 'Submission Checklist', bucket, path,
        signed_url: await signedUrlForPath(adminSb, { bucket, path, expiresInSec: 3600 }), content_type: 'application/pdf' });
    }

    // Assemble actual attachment bytes into a ZIP
    if (!options.dry_run && status === 'DRAFT_BUILT' && options.generate_packet_zip) {
      try {
        const manifest = await generatePermitPacket(adminSb, tenantId, permitCase.id, output_plan?.packet_zip?.include ?? []);

        const bucket = 'permits';
        const path = versionedDocPath({
          tenant_id: tenantId,
          permit_case_id: permitCase.id,
          filename: 'permit_packet.zip',
        });

        await uploadBytes(adminSb, { bucket, path, bytes: manifest, contentType: 'application/zip' });
        const signed_url = await signedUrlForPath(adminSb, { bucket, path, expiresInSec: 3600 });

        const docRow = await insertPermitDocument(adminSb, {
          tenant_id: tenantId,
          permit_case_id: permitCase.id,
          kind: 'PERMIT_PACKET',
          title: 'Permit Packet',
          bucket,
          path,
          created_by: user.id,
        });

        documents.push({
          id: docRow.id,
          kind: 'PERMIT_PACKET',
          title: 'Permit Packet',
          bucket,
          path,
          signed_url,
          content_type: 'application/zip',
        });

        await emitPermitEvent(adminSb, {
          tenant_id: tenantId,
          permit_case_id: permitCase.id,
          event_type: 'PACKET_GENERATED',
          message: 'Permit packet generated',
          details: { bucket, path },
          created_by: user.id,
        });
      } catch (err) {
        throw err;
      }
    }

    // Step 8: Build response
    const response: PermitBuildCaseResponse = {
      permit_case: {
        id: permitCase.id,
        status,
        job_id: payload.job_id,
        estimate_id: payload.estimate_id ?? null,
        authority_id: context.authority?.id ?? null,
        template_id: context.meta.template_id,
        jurisdiction: {
          state: context.permit_case.state,
          county_name: context.permit_case.county_name,
          city_name: context.permit_case.city_name,
          jurisdiction_type: context.permit_case.jurisdiction_type,
        },
      },
      missing_items,
      validation_errors,
      application_field_values,
      calculation_results,
      documents,
      next_actions: buildNextActions(context, missing_items, validation_errors),
      context_preview: buildContextPreview(context),
    };

    return jsonOK(response);
  } catch (e: any) {
    console.error('permit_build_case error:', e);
    return jsonErr(500, 'INTERNAL_ERROR', e?.message ?? 'Unknown error', { stack: e?.stack });
  }
});

// ============================================
// Helper Functions
// ============================================

async function upsertPermitCase(
  sb: any,
  args: {
    tenant_id: string;
    job_id: string;
    estimate_id: string | null;
    created_by: string;
    force_rebuild: boolean;
  }
): Promise<{ id: string }> {
  // Check for existing permit case (idempotency)
  if (!args.force_rebuild) {
    const { data: existing } = await sb
      .from('permit_cases')
      .select('id, status')
      .eq('tenant_id', args.tenant_id)
      .eq('job_id', args.job_id)
      .eq('estimate_id', args.estimate_id)
      .neq('status', 'VOID')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      return { id: existing.id };
    }
  }

  // Create new permit case
  const { data, error } = await sb
    .from('permit_cases')
    .insert({
      tenant_id: args.tenant_id,
      job_id: args.job_id,
      estimate_id: args.estimate_id,
      status: 'NOT_STARTED',
      created_by: args.created_by,
    })
    .select('id')
    .single();

  if (error) throw new Error(`permit_cases insert failed: ${error.message}`);
  return { id: data.id };
}

function computeNextStatus(missing: MissingItem[], valErrs: ValidationError[]): string {
  const hasError = 
    valErrs.some(e => e.severity === 'error') ||
    missing.some(m => m.severity === 'error');
  
  if (hasError) return 'WAITING_ON_DOCS';
  return 'DRAFT_BUILT';
}

async function persistPermitCaseSummary(
  sb: any,
  args: {
    tenant_id: string;
    permit_case_id: string;
    authority_id: string | null;
    template_id: string | null;
    jurisdiction: any;
    application_field_values: Record<string, unknown>;
    calculation_results: Record<string, unknown>;
    missing_items: MissingItem[];
    validation_errors: ValidationError[];
    status: string;
  }
) {
  const { error } = await sb
    .from('permit_cases')
    .update({
      authority_id: args.authority_id,
      template_id: args.template_id,
      state: args.jurisdiction.state ?? 'FL',
      county_name: args.jurisdiction.county_name ?? null,
      city_name: args.jurisdiction.city_name ?? null,
      jurisdiction_type: args.jurisdiction.jurisdiction_type ?? null,
      application_field_values: args.application_field_values,
      calculation_results: args.calculation_results,
      missing_items: args.missing_items.map(m => m.key),
      validation_errors: args.validation_errors,
      status: args.status,
      updated_at: nowIso(),
    })
    .eq('tenant_id', args.tenant_id)
    .eq('id', args.permit_case_id);

  if (error) throw new Error(`permit_cases update failed: ${error.message}`);
}

async function emitPermitEvent(
  sb: any,
  args: {
    tenant_id: string;
    permit_case_id: string;
    event_type: string;
    message: string;
    details: Record<string, unknown>;
    created_by: string;
  }
) {
  const { error } = await sb
    .from('permit_case_events')
    .insert({
      tenant_id: args.tenant_id,
      permit_case_id: args.permit_case_id,
      event_type: args.event_type,
      message: args.message,
      details: args.details,
      created_by: args.created_by,
    });
  
  if (error) {
    console.error('permit_case_events insert failed:', error.message);
  }
}

async function insertPermitDocument(
  sb: any,
  args: {
    tenant_id: string;
    permit_case_id: string;
    kind: string;
    title: string;
    bucket: string;
    path: string;
    created_by: string;
  }
): Promise<{ id: string }> {
  const { data, error } = await sb
    .from('permit_documents')
    .insert({
      tenant_id: args.tenant_id,
      permit_case_id: args.permit_case_id,
      kind: args.kind,
      title: args.title,
      storage_bucket: args.bucket,
      storage_path: args.path,
      created_by: args.created_by,
    })
    .select('id')
    .single();

  if (error) throw new Error(`permit_documents insert failed: ${error.message}`);
  return { id: data.id };
}

function buildNextActions(
  context: CanonicalPermitContext,
  missing: MissingItem[],
  valErrs: ValidationError[]
): NextAction[] {
  const actions: NextAction[] = [];
  const hasErrors = 
    valErrs.some(e => e.severity === 'error') ||
    missing.some(m => m.severity === 'error');

  // Portal link
  if (context.authority?.portal_url) {
    actions.push({
      action: 'OPEN_PERMITTING_PORTAL',
      label: 'Open Portal',
      url: context.authority.portal_url,
      when: { status_in: ['DRAFT_BUILT', 'READY_TO_SUBMIT', 'SUBMITTED'] },
    });
  }

  // Fix missing items
  if (hasErrors) {
    actions.push({
      action: 'FIX_MISSING_ITEMS',
      label: 'Resolve missing items',
      items: missing.filter(m => m.severity === 'error').map(m => m.key),
    });
  }

  return actions;
}

function buildContextPreview(context: CanonicalPermitContext): ContextPreview {
  return {
    authority: context.authority ? {
      county_name: context.authority.county_name,
      city_name: context.authority.city_name,
      portal_type: context.authority.portal_type,
    } : null,
    measurements: {
      total_roof_area_sqft: context.measurements?.total_roof_area_sqft ?? null,
      predominant_pitch: context.measurements?.predominant_pitch ?? null,
    },
    products: {
      primary: {
        manufacturer: context.products.primary.manufacturer,
        model: context.products.primary.model,
      },
    },
  };
}

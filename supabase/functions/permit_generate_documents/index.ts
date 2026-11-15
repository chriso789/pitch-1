// ============================================
// PERMIT GENERATE DOCUMENTS Edge Function
// POST /functions/v1/permit_generate_documents
// Generates or regenerates documents for an existing permit case
// ============================================

import { z } from 'npm:zod@3.23.8';

import { supabaseAuth, getAuthUser, supabaseService } from '../_shared/supabase.ts';
import { jsonOK, jsonErr, handleCors } from '../_shared/response.ts';
import { buildPermitContext } from '../_shared/context_builder.ts';
import { evalTemplate } from '../_shared/template_eval.ts';
import { generatePermitPacket, permitAttachments, fillPermitPdf, generateChecklistPdf } from '../_shared/pdf_fill.ts';
import { uploadBytes, signedUrlForPath } from '../_shared/storage.ts';
import { versionedDocPath, nowIso } from '../_shared/util.ts';
import type { PermitDocumentOutput } from '../_shared/permit_types.ts';

const ReqSchema = z.object({
  permit_case_id: z.string().uuid(),
  outputs: z.array(z.enum(['APPLICATION_PDF', 'CHECKLIST_PDF', 'PACKET_ZIP'])),
  options: z.object({
    overwrite: z.boolean().optional(),
  }).optional(),
});

Deno.serve(async (req) => {
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

    const { permit_case_id, outputs, options } = parsed.data;

    // Authenticate
    const sb = supabaseAuth(req);
    const user = await getAuthUser(sb);
    
    if (!user) {
      return jsonErr(401, 'UNAUTHORIZED', 'Authentication required');
    }

    const tenantId = user.tenantId;
    if (!tenantId) {
      return jsonErr(403, 'FORBIDDEN', 'No active company found');
    }

    const adminSb = supabaseService();

    // Get permit case
    const { data: permitCase, error: pcErr } = await adminSb
      .from('permit_cases')
      .select('*')
      .eq('id', permit_case_id)
      .eq('tenant_id', tenantId)
      .single();

    if (pcErr || !permitCase) {
      return jsonErr(404, 'NOT_FOUND', 'Permit case not found');
    }

    // Build context
    const { context, missing } = await buildPermitContext(adminSb, {
      tenant_id: tenantId,
      permit_case_id,
      job_id: permitCase.job_id,
      estimate_id: permitCase.estimate_id,
      options: {},
    });

    // Evaluate template
    const { application_field_values, output_plan, validation_errors, template_missing_items } = evalTemplate({
      context,
      template_json: context.meta.template_json,
    });

    const blockers = [...missing, ...template_missing_items].filter(item => item.severity === 'error');
    if (blockers.length || validation_errors.length) return jsonErr(412, 'PERMIT_INCOMPLETE', 'Resolve required permit fields before generating', { blockers, validation_errors });
    const attachments = await permitAttachments(adminSb, tenantId, permit_case_id);
    const documents: PermitDocumentOutput[] = [];
    const bucket = 'permits';

    // Generate requested outputs
    const orderedOutputs = [...new Set(outputs)].sort((a, b) => Number(a === 'PACKET_ZIP') - Number(b === 'PACKET_ZIP'));
    for (const output of orderedOutputs) {
      try {
        if (output === 'APPLICATION_PDF') {
          const pdfBytes = await fillPermitPdf({
          supabase: adminSb,
            template_pdf_bucket: context.meta.template_pdf_bucket || output_plan?.application_pdf?.input_pdf_storage?.bucket || null,
            template_pdf_path: context.meta.template_pdf_path || output_plan?.application_pdf?.input_pdf_storage?.path || null,
            field_values: application_field_values,
            field_map: output_plan?.application_pdf?.field_map || [],
          });

          const path = versionedDocPath({
            tenant_id: tenantId,
            permit_case_id,
            filename: 'application.pdf',
          });

          await uploadBytes(adminSb, { bucket, path, bytes: pdfBytes, contentType: 'application/pdf' });
          const signed_url = await signedUrlForPath(adminSb, { bucket, path, expiresInSec: 3600 });

          const { data: docRow } = await adminSb
            .from('permit_documents')
            .insert({
              tenant_id: tenantId,
              permit_case_id,
              kind: 'PERMIT_APPLICATION',
              title: 'Permit Application',
              storage_bucket: bucket,
              storage_path: path,
              created_by: user.id,
            })
            .select('id')
            .single();

          documents.push({
            id: docRow?.id || '',
            kind: 'PERMIT_APPLICATION',
            title: 'Permit Application',
            bucket,
            path,
            signed_url,
            content_type: 'application/pdf',
          });
        }

        if (output === 'CHECKLIST_PDF') {
          const checklistBytes = await generateChecklistPdf({
            permit_case_id,
            authority_name: context.authority?.county_name || 'Unknown Authority',
            required_attachments: context.authority?.default_required_attachments || [],
            available_attachments: attachments.flatMap((doc: any) => [doc.kind, doc.title]),
          });

          const path = versionedDocPath({
            tenant_id: tenantId,
            permit_case_id,
            filename: 'checklist.pdf',
          });

          await uploadBytes(adminSb, { bucket, path, bytes: checklistBytes, contentType: 'application/pdf' });
          const signed_url = await signedUrlForPath(adminSb, { bucket, path, expiresInSec: 3600 });

          const { data: docRow } = await adminSb
            .from('permit_documents')
            .insert({
              tenant_id: tenantId,
              permit_case_id,
              kind: 'CHECKLIST',
              title: 'Submission Checklist',
              storage_bucket: bucket,
              storage_path: path,
              created_by: user.id,
            })
            .select('id')
            .single();

          documents.push({
            id: docRow?.id || '',
            kind: 'CHECKLIST',
            title: 'Submission Checklist',
            bucket,
            path,
            signed_url,
            content_type: 'application/pdf',
          });
        }

        if (output === 'PACKET_ZIP') {
          // Assemble verified attachment bytes
          const manifest = await generatePermitPacket(adminSb, tenantId, permit_case_id, output_plan?.packet_zip?.include ?? []);

          const path = versionedDocPath({
            tenant_id: tenantId,
            permit_case_id,
            filename: 'permit_packet.zip',
          });

          await uploadBytes(adminSb, { bucket, path, bytes: manifest, contentType: 'application/zip' });
          const signed_url = await signedUrlForPath(adminSb, { bucket, path, expiresInSec: 3600 });

          const { data: docRow } = await adminSb
            .from('permit_documents')
            .insert({
              tenant_id: tenantId,
              permit_case_id,
              kind: 'PERMIT_PACKET',
              title: 'Permit Packet',
              storage_bucket: bucket,
              storage_path: path,
              created_by: user.id,
            })
            .select('id')
            .single();

          documents.push({
            id: docRow?.id || '',
            kind: 'PERMIT_PACKET',
            title: 'Permit Packet',
            bucket,
            path,
            signed_url,
            content_type: 'application/zip',
          });
        }
      } catch (err) {
        throw err;
      }
    }

    // Log event
    await adminSb.from('permit_case_events').insert({
      tenant_id: tenantId,
      permit_case_id,
      event_type: 'APPLICATION_GENERATED',
      message: `Generated ${outputs.join(', ')}`,
      details: { outputs, document_count: documents.length },
      created_by: user.id,
    });

    return jsonOK({
      permit_case_id,
      documents,
    });
  } catch (e: any) {
    console.error('permit_generate_documents error:', e);
    return jsonErr(500, 'INTERNAL_ERROR', e?.message ?? 'Unknown error');
  }
});

/**
 * Shared load/save for PITCH `documents` rows edited by PDF Studio tools.
 * Originals are never overwritten: every save uploads a new file under the company's
 * tenant folder and inserts a new `documents` row linked to its root original.
 */
import { supabase } from '@/integrations/supabase/client';
import type { pageMap as PageMapFn } from './pageOps';

const db = supabase as any;
export type PageMap = ReturnType<typeof PageMapFn>;
export interface DocRow { id: string; filename: string; file_path: string; document_type: string; tenant_id: string; metadata: Record<string, any> | null }

/** commercial drawings live in `documents`; Smart Docs company files live in `smartdoc-assets`. */
export const bucketFor = (doc: Pick<DocRow, 'document_type'>) => (doc.document_type === 'company_resource' ? 'smartdoc-assets' : 'documents');

export async function loadDocumentPdf(tenantId: string, documentId: string) {
  const { data: doc, error } = await db.from('documents').select('id, filename, file_path, document_type, tenant_id, metadata').eq('id', documentId).eq('tenant_id', tenantId).maybeSingle();
  if (error || !doc) throw new Error('Document not found for this company');
  const { data: blob, error: dErr } = await supabase.storage.from(bucketFor(doc)).download(doc.file_path);
  if (dErr || !blob) throw new Error('Could not open the PDF file');
  return { doc: doc as DocRow, bytes: new Uint8Array(await blob.arrayBuffer()) };
}

export async function saveDocumentVersion(args: { tenantId: string; doc: DocRow; bytes: Uint8Array; kind: 'pages' | 'markup'; tool: import('./featureGate').PdfTool; summary: string; metadata?: Record<string, any> }) {
  const { tenantId, doc, bytes, kind, summary } = args;
  if (doc.tenant_id !== tenantId) throw new Error('This document belongs to a different company');
  const root = doc.metadata?.versions_root_id ?? doc.metadata?.pages_from_document_id ?? doc.id;
  const { count } = await db.from('documents').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).contains('metadata', { versions_root_id: root });
  const version = (count || 0) + 2; // v1 is the original
  const projectId = doc.metadata?.commercial_project_id;
  const folder = projectId ? `commercial/${projectId}/drawings/versions` : 'company-docs/versions';
  const path = `${tenantId}/${folder}/${root}-v${version}-${kind}-${Date.now()}.pdf`;
  const bucket = bucketFor(doc);
  const { error: up } = await supabase.storage.from(bucket).upload(path, new Blob([bytes as BlobPart], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false });
  if (up) throw up;
  const base = doc.filename.replace(/\.pdf$/i, '').replace(/ \((pages|markup|measured) v\d+\)$/, '');
  const filename = `${base} (${kind} v${version}).pdf`;
  const { data: row, error } = await db.from('documents').insert({
    tenant_id: tenantId, filename, file_path: path, file_size: bytes.byteLength, mime_type: 'application/pdf', document_type: doc.document_type,
    description: `${kind === 'pages' ? 'Page edits' : 'Markups'} v${version}: ${summary}`,
    metadata: { ...(doc.metadata ?? {}), ...(args.metadata ?? {}), pdf_tool: args.tool, versions_root_id: root, edited_from_document_id: doc.id, version_number: version, version_kind: kind, measurement_reconciliation: args.metadata?.measurement_reconciliation ?? null },
  }).select('id').single();
  if (error) { await supabase.storage.from(bucket).remove([path]); throw error; }
  return { id: row.id as string, filename, version };
}

export interface Reconciliation { page: number; sourcePage: number | null; status: 'carried' | 'invalidated' | 'none'; reason?: string; scales: number; measurements: number }

/**
 * Carry measurement scales/measurements to an edited drawing version.
 * Measurement points are in PDF user space, so reordering, duplicating and /Rotate changes
 * leave them valid. Crops are valid only when every point stays inside the crop. Resizing
 * changes physical dimensions, so those sheets are invalidated (never transformed silently).
 * Carried measurements always come back as DRAFT so nothing reaches a takeoff without re-approval.
 */
export async function reconcileMeasurements(args: { tenantId: string; sourceDocId: string; newDocId: string; projectId: string | null; map: PageMap; cropBoxes: Record<number, [number, number, number, number] | null> }): Promise<Reconciliation[]> {
  const { tenantId, sourceDocId, newDocId, projectId, map } = args;
  const [{ data: scales }, { data: ms }] = await Promise.all([
    db.from('plan_sheet_scales').select('*').eq('tenant_id', tenantId).eq('document_id', sourceDocId),
    db.from('plan_measurements').select('*').eq('tenant_id', tenantId).eq('document_id', sourceDocId).is('deleted_at', null),
  ]);
  const out: Reconciliation[] = [];
  const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
  for (const m of map) {
    if (m.sourceId !== sourceDocId) { out.push({ page: m.out, sourcePage: null, status: 'none', scales: 0, measurements: 0 }); continue; }
    const sc = (scales ?? []).filter((s: any) => s.page_index === m.sourceIndex);
    const mm = (ms ?? []).filter((x: any) => x.page_index === m.sourceIndex && x.status !== 'rejected');
    if (!sc.length && !mm.length) { out.push({ page: m.out, sourcePage: m.sourceIndex, status: 'none', scales: 0, measurements: 0 }); continue; }
    let reason: string | undefined;
    if (m.resized) reason = 'Sheet was resized, so its physical scale changed. Re-calibrate this sheet.';
    const crop = args.cropBoxes[m.out];
    if (!reason && crop) {
      const inside = (p: [number, number]) => p[0] >= crop[0] - 0.01 && p[1] >= crop[1] - 0.01 && p[0] <= crop[2] + 0.01 && p[1] <= crop[3] + 0.01;
      if (mm.some((x: any) => !(x.points as [number, number][]).every(inside))) reason = 'Crop cuts through measured geometry. Re-measure this sheet.';
    }
    if (reason) { out.push({ page: m.out, sourcePage: m.sourceIndex, status: 'invalidated', reason, scales: sc.length, measurements: mm.length }); continue; }
    const idMap = new Map<string, string>();
    for (const s of sc) {
      const { id, created_at, updated_at, ...rest } = s;
      const { data: ns, error } = await db.from('plan_sheet_scales').insert({ ...rest, document_id: newDocId, page_index: m.out, project_id: projectId ?? s.project_id, created_by: uid,
        calibration: { ...(s.calibration ?? {}), carried_from: { document_id: sourceDocId, page_index: s.page_index, scale_id: id } } }).select('id').single();
      if (error) throw error; idMap.set(id, ns.id);
    }
    let carried = 0;
    for (const x of mm) {
      const { id, created_at, updated_at, approved_by, approved_at, takeoff_quantity_id, revision, ...rest } = x;
      const { error } = await db.from('plan_measurements').insert({ ...rest, document_id: newDocId, page_index: m.out, scale_id: x.scale_id ? idMap.get(x.scale_id) ?? null : null, status: 'draft', created_by: uid,
        label: x.label ? `${x.label}` : null });
      if (error) throw error; carried++;
    }
    out.push({ page: m.out, sourcePage: m.sourceIndex, status: 'carried', scales: sc.length, measurements: carried });
  }
  return out;
}

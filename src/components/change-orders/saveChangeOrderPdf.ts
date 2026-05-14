import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { supabase } from '@/integrations/supabase/client';

interface SaveArgs {
  domId: string;
  changeOrderId: string;
  coNumber: string;
  title: string;
  reason?: string | null;
  pipelineEntryId: string;
  tenantId: string;
  /** Existing documents.id, if regenerating after edit */
  existingDocumentId?: string | null;
}

/**
 * Renders the on-screen Change Order document to a PDF, uploads it to the
 * `documents` storage bucket, and creates (or updates) a row in the
 * `documents` table linked back to the change order so it surfaces in the
 * Documents tab.
 */
export async function saveChangeOrderPdfToDocuments({
  domId,
  changeOrderId,
  coNumber,
  title,
  reason,
  pipelineEntryId,
  tenantId,
  existingDocumentId,
}: SaveArgs): Promise<string | null> {
  const el = document.getElementById(domId);
  if (!el) {
    console.warn('Change order DOM not found for PDF capture:', domId);
    return null;
  }

  // Wait for fonts
  try {
    await (document as any).fonts?.ready;
  } catch {
    /* noop */
  }

  const canvas = await html2canvas(el, {
    scale: 1.5,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    windowWidth: el.scrollWidth,
    windowHeight: el.scrollHeight,
  });

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const imgWidth = 215.9; // letter mm
  const pageHeight = 279.4;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  const imgData = canvas.toDataURL('image/jpeg', 0.65);

  let heightLeft = imgHeight;
  let position = 0;
  pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;
  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  const blob: Blob = pdf.output('blob');

  // Upload to storage — RLS requires {tenant_id}/... as first folder
  const filePath = `${tenantId}/change-orders/${changeOrderId}.pdf`;
  const { error: upErr } = await supabase.storage
    .from('documents')
    .upload(filePath, blob, {
      contentType: 'application/pdf',
      upsert: true,
    });
  if (upErr) {
    console.error('CO PDF upload failed', upErr);
    return null;
  }

  const safeTitle = (title || coNumber).trim().replace(/[\\/:*?"<>|]/g, '-');
  const filename = `${safeTitle}.pdf`;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let documentId = existingDocumentId || null;

  if (documentId) {
    await supabase
      .from('documents')
      .update({
        filename,
        file_path: filePath,
        file_size: blob.size,
        mime_type: 'application/pdf',
        document_type: 'change_order',
        description: reason || null,
      })
      .eq('id', documentId);
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from('documents')
      .insert({
        tenant_id: tenantId,
        pipeline_entry_id: pipelineEntryId,
        document_type: 'change_order',
        filename,
        file_path: filePath,
        file_size: blob.size,
        mime_type: 'application/pdf',
        uploaded_by: user?.id,
        description: reason || null,
      })
      .select('id')
      .single();
    if (insErr) {
      console.error('CO documents insert failed', insErr);
      return null;
    }
    documentId = inserted?.id || null;
    if (documentId) {
      await (supabase as any)
        .from('change_orders')
        .update({ document_id: documentId })
        .eq('id', changeOrderId);
    }
  }

  return documentId;
}

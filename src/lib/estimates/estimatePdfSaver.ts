import { supabase } from '@/integrations/supabase/client';

export interface EstimatePdfSaveResult {
  success: boolean;
  filePath: string | null;
  error?: string;
}

/**
 * Uploads an estimate PDF to storage and creates a document record.
 * 
 * The storage path is structured as: {pipelineEntryId}/estimates/{estimateNumber}.pdf
 * This matches the RLS policy on storage.objects for the 'documents' bucket,
 * which expects the first folder to be the pipeline_entry_id.
 */
export async function saveEstimatePdf({
  pdfBlob,
  pipelineEntryId,
  tenantId,
  estimateNumber,
  description,
  userId,
  estimateDisplayName,
  estimatePricingTier,
}: {
  pdfBlob: Blob;
  pipelineEntryId: string;
  tenantId: string;
  estimateNumber: string;
  description: string;
  userId: string;
  estimateDisplayName?: string | null;
  estimatePricingTier?: string | null;
}): Promise<EstimatePdfSaveResult> {
  try {
    // Path structure: pipelineEntryId first to satisfy RLS policy
    const pdfPath = `${pipelineEntryId}/estimates/${estimateNumber}.pdf`;
    
    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(pdfPath, pdfBlob, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload failed:', uploadError);
      return {
        success: false,
        filePath: null,
        error: uploadError.message
      };
    }

    // Create document record
    const { error: docError } = await (supabase as any)
      .from('documents')
      .insert({
        tenant_id: tenantId,
        pipeline_entry_id: pipelineEntryId,
        document_type: 'estimate',
        filename: `${estimateNumber}.pdf`,
        file_path: pdfPath,
        file_size: pdfBlob.size,
        mime_type: 'application/pdf',
        description,
        uploaded_by: userId,
        estimate_display_name: estimateDisplayName || null,
        estimate_pricing_tier: estimatePricingTier || null,
      });

    if (docError) {
      console.error('Document record creation failed:', docError);
      // Still return success since the file was uploaded
      return {
        success: true,
        filePath: pdfPath,
        error: `File uploaded but document record failed: ${docError.message}`
      };
    }

    return {
      success: true,
      filePath: pdfPath
    };
  } catch (error: any) {
    console.error('Error saving estimate PDF:', error);
    return {
      success: false,
      filePath: null,
      error: error.message || 'Unknown error saving PDF'
    };
  }
}

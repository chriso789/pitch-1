import { useCallback, useState } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { uploadBlobToStorage, generateSignedURL } from '@/lib/export-utils';
import { format } from 'date-fns';

interface EnhancedPDFOptions {
  filename?: string;
  orientation?: 'portrait' | 'landscape';
  format?: 'a4' | 'letter';
  quality?: number;
  
  // Report metadata
  measurementId?: string;
  propertyId?: string;
  pipelineEntryId?: string;
  customerName?: string;
  propertyAddress?: string;
  customerEmail?: string;
  
  // Sharing options
  generateShareLink?: boolean;
  shareExpiration?: number; // Days until expiration (0 = never)
  makePublic?: boolean;
}

interface PDFGenerationResult {
  success: boolean;
  blob?: Blob;
  reportId?: string;
  shareUrl?: string;
  downloadUrl?: string;
  error?: string;
}

export function useEnhancedPDFGeneration() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);

  const generateAndUploadPDF = useCallback(async (
    elementId: string,
    options: EnhancedPDFOptions = {}
  ): Promise<PDFGenerationResult> => {
    const {
      filename = 'measurement-report.pdf',
      orientation = 'portrait',
      format = 'letter',
      quality = 2,
      generateShareLink = true,
      shareExpiration = 7,
      makePublic = false,
    } = options;

    setIsGenerating(true);
    setProgress(10);

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error('User not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('active_tenant_id, tenant_id, first_name, last_name')
        .eq('id', user.id)
        .single();

      const tenantId = profile?.active_tenant_id || profile?.tenant_id;
      if (!tenantId) throw new Error('No tenant found');

      setProgress(20);
      console.log('📄 Generating PDF from element:', elementId);

      const element = document.getElementById(elementId);
      if (!element) throw new Error('Report element not found');

      setProgress(30);
      toast.info('Capturing report preview...');

      const canvas = await html2canvas(element, {
        scale: quality,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
      });

      setProgress(50);
      toast.info('Creating PDF...');

      const imgWidth = orientation === 'portrait' ? 210 : 297;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      const pdf = new jsPDF({
        orientation,
        unit: 'mm',
        format,
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      
      let heightLeft = imgHeight;
      let position = 0;
      const pageHeight = orientation === 'portrait' ? 297 : 210;

      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      const blob = pdf.output('blob');
      const fileSize = blob.size;

      setProgress(70);
      toast.info('Uploading to cloud storage...');

      const reportId = `RPT-${format(new Date(), 'yyyyMMdd-HHmmss')}`;
      const timestamp = Date.now();
      const storagePath = `${tenantId}/${options.propertyId || 'general'}/${reportId}-${timestamp}.pdf`;

      console.log('☁️ Uploading to storage:', storagePath);

      await uploadBlobToStorage(blob, 'measurement-reports', storagePath);

      setProgress(85);

      const shareToken = Math.random().toString(36).substring(2, 10);
      const expiresAt = shareExpiration > 0
        ? new Date(Date.now() + shareExpiration * 24 * 60 * 60 * 1000)
        : null;

      const { data: reportData, error: reportError } = await supabase
        .from('measurement_reports')
        .insert({
          tenant_id: tenantId,
          measurement_id: options.measurementId,
          property_id: options.propertyId,
          pipeline_entry_id: options.pipelineEntryId,
          report_id: reportId,
          file_name: filename,
          file_size_bytes: fileSize,
          storage_path: storagePath,
          storage_bucket: 'measurement-reports',
          share_token: shareToken,
          expires_at: expiresAt,
          is_public: makePublic,
          generated_by: user.id,
          customer_name: options.customerName,
          property_address: options.propertyAddress,
          customer_email: options.customerEmail,
          metadata: {
            orientation,
            format,
            generated_at: new Date().toISOString(),
          },
        })
        .select()
        .single();

      if (reportError) {
        console.error('Failed to save report metadata:', reportError);
        throw new Error('Failed to save report metadata');
      }

      setProgress(95);

      let shareUrl: string | undefined;
      let downloadUrl: string | undefined;

      if (generateShareLink) {
        const baseUrl = window.location.origin;
        shareUrl = `${baseUrl}/reports/${shareToken}`;
        
        downloadUrl = await generateSignedURL(
          `measurement-reports/${storagePath}`,
          604800
        );
      }

      setProgress(100);
      toast.success('Report generated and uploaded!');

      console.log('✅ Report generated successfully:', {
        reportId,
        shareUrl,
        downloadUrl,
      });

      return {
        success: true,
        blob,
        reportId,
        shareUrl,
        downloadUrl,
      };
    } catch (error: any) {
      console.error('❌ PDF generation error:', error);
      toast.error(error.message || 'Failed to generate PDF');
      return {
        success: false,
        error: error.message,
      };
    } finally {
      setIsGenerating(false);
      setProgress(0);
    }
  }, []);

  const downloadPDF = useCallback(async (
    elementId: string,
    options: EnhancedPDFOptions = {}
  ) => {
    const result = await generateAndUploadPDF(elementId, {
      ...options,
      generateShareLink: false,
    });

    if (result.success && result.blob) {
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = options.filename || 'measurement-report.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    return result;
  }, [generateAndUploadPDF]);

  return {
    generateAndUploadPDF,
    downloadPDF,
    isGenerating,
    progress,
  };
}

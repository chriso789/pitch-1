import { useState, useCallback } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface PDFGenerationOptions {
  filename?: string;
  propertyAddress?: string;
  measurementId?: string;
  pipelineEntryId?: string;
  customerName?: string;
  format?: 'a4' | 'letter';
  orientation?: 'portrait' | 'landscape';
}

interface PDFGenerationResult {
  success: boolean;
  blob?: Blob;
  filename?: string;
  storageUrl?: string;
  shareToken?: string;
  error?: string;
}

export function useMultiPagePDFGeneration() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const { toast } = useToast();

  const generateMultiPagePDF = useCallback(async (
    pageContainerId: string,
    totalPages: number,
    options: PDFGenerationOptions = {}
  ): Promise<PDFGenerationResult> => {
    setIsGenerating(true);
    setProgress(0);

    try {
      const container = document.getElementById(pageContainerId);
      if (!container) {
        throw new Error('Report container not found');
      }

      // Determine format and dimensions
      const format = options.format || 'letter';
      const orientation = options.orientation || 'portrait';
      
      const pdf = new jsPDF({
        orientation,
        unit: 'mm',
        format,
      });
      
      // Get actual page dimensions from jsPDF
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      // Get all page elements
      const pageElements = container.querySelectorAll('[data-report-page]');
      
      if (pageElements.length === 0) {
        throw new Error('No report pages found in container');
      }

      console.log(`📄 Generating PDF with ${pageElements.length} pages...`);

      for (let i = 0; i < pageElements.length; i++) {
        const pageElement = pageElements[i] as HTMLElement;
        
        setProgress(((i + 0.5) / pageElements.length) * 100);
        
        // Wait for images to load
        const images = pageElement.querySelectorAll('img');
        await Promise.all(
          Array.from(images).map(img => {
            if (img.complete) return Promise.resolve();
            return new Promise<void>((resolve) => {
              img.onload = () => resolve();
              img.onerror = () => resolve();
              // Timeout after 3 seconds
              setTimeout(resolve, 3000);
            });
          })
        );

        // Capture page to canvas
        const canvas = await html2canvas(pageElement, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          logging: false,
          imageTimeout: 5000,
        });

        // Calculate dimensions to fit page
        const imgWidth = pageWidth - 20; // 10mm margins
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        // Add new page if not first
        if (i > 0) {
          pdf.addPage();
        }

        // Add image centered on page
        const xOffset = 10;
        const yOffset = 10;
        
        pdf.addImage(
          canvas.toDataURL('image/jpeg', 0.95),
          'JPEG',
          xOffset,
          yOffset,
          imgWidth,
          Math.min(imgHeight, pageHeight - 20)
        );

        setProgress(((i + 1) / pageElements.length) * 100);
        console.log(`📄 Page ${i + 1}/${pageElements.length} captured`);
      }

      // Generate blob
      const blob = pdf.output('blob');
      const filename = options.filename || `roof-report-${Date.now()}.pdf`;

      // Upload to storage
      let storageUrl: string | undefined;
      let shareToken: string | undefined;

      try {
        const { data: userData } = await supabase.auth.getUser();
        if (userData?.user) {
          // Generate share token
          shareToken = crypto.randomUUID();
          
          const storagePath = `reports/${userData.user.id}/${shareToken}/${filename}`;
          
          const { error: uploadError } = await supabase.storage
            .from('measurement-reports')
            .upload(storagePath, blob, {
              contentType: 'application/pdf',
              upsert: true,
            });

          if (uploadError) {
            console.warn('Failed to upload PDF to storage:', uploadError);
          } else {
            // Get public URL
            const { data: urlData } = supabase.storage
              .from('measurement-reports')
              .getPublicUrl(storagePath);
            
            storageUrl = urlData?.publicUrl;
            console.log('✅ Report uploaded to storage:', storageUrl);
          }
        }
      } catch (err) {
        console.warn('Storage/DB save failed:', err);
      }

      setProgress(100);
      setIsGenerating(false);

      return {
        success: true,
        blob,
        filename,
        storageUrl,
        shareToken,
      };

    } catch (error: any) {
      console.error('PDF generation failed:', error);
      setIsGenerating(false);
      setProgress(0);

      toast({
        title: 'PDF Generation Failed',
        description: error.message || 'Failed to generate PDF report',
        variant: 'destructive',
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }, [toast]);

  const downloadPDF = useCallback(async (
    pageContainerId: string,
    totalPages: number,
    options: PDFGenerationOptions = {}
  ) => {
    const result = await generateMultiPagePDF(pageContainerId, totalPages, options);

    if (result.success && result.blob && result.filename) {
      // Trigger download
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: 'PDF Downloaded',
        description: result.storageUrl 
          ? 'Report saved and available in Documents tab' 
          : 'Report downloaded successfully',
      });

      return result;
    }

    return result;
  }, [generateMultiPagePDF, toast]);

  return {
    generateMultiPagePDF,
    downloadPDF,
    isGenerating,
    progress,
  };
}

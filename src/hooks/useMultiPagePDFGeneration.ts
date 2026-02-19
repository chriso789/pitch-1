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

/**
 * Wait for all fonts to be fully loaded and rendered
 */
async function waitForFonts(): Promise<void> {
  // Wait for fonts API to signal ready
  await document.fonts.ready;
  
  // Check specifically for Inter font
  const interLoaded = document.fonts.check('16px Inter');
  if (!interLoaded) {
    // Try to load Inter explicitly
    try {
      await document.fonts.load('400 16px Inter');
      await document.fonts.load('500 16px Inter');
      await document.fonts.load('600 16px Inter');
      await document.fonts.load('700 16px Inter');
    } catch (e) {
      console.warn('Inter font loading failed, using fallback:', e);
    }
  }
  
  // Additional delay to ensure fonts are fully rasterized (reduced for performance)
  await new Promise(resolve => setTimeout(resolve, 50));
}

/**
 * Apply PDF-optimized styles to cloned element for html2canvas
 */
function applyPDFStyles(element: HTMLElement): void {
  // CRITICAL: Reset any CSS transforms that cause font rendering issues
  element.style.transform = 'none';
  element.style.webkitTransform = 'none';
  
  // Also reset transforms on all parent elements in the cloned tree
  let parent = element.parentElement;
  while (parent) {
    parent.style.transform = 'none';
    parent.style.webkitTransform = 'none';
    parent = parent.parentElement;
  }

  // Apply font optimizations to root element
  element.style.fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  element.style.setProperty('-webkit-font-smoothing', 'antialiased');
  element.style.setProperty('-moz-osx-font-smoothing', 'grayscale');
  element.style.setProperty('text-rendering', 'optimizeLegibility');
  element.style.letterSpacing = '0.01em';
  element.classList.add('pdf-render-container');
  
  // Apply to all child elements
  const allElements = element.querySelectorAll('*');
  allElements.forEach(el => {
    if (el instanceof HTMLElement) {
      el.style.transform = 'none';
      el.style.webkitTransform = 'none';
      el.style.fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      el.style.letterSpacing = '0.01em';
    }
  });
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
      // CRITICAL: Wait for fonts to be fully loaded
      console.log('📄 Waiting for fonts to load...');
      await waitForFonts();
      setProgress(5);

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
        
        setProgress(((i + 0.3) / pageElements.length) * 90 + 5);
        
        // Wait for images to load
        const images = pageElement.querySelectorAll('img');
        await Promise.all(
          Array.from(images).map(img => {
            if (img.complete) return Promise.resolve();
            return new Promise<void>((resolve) => {
              img.onload = () => resolve();
              img.onerror = () => resolve();
              setTimeout(resolve, 3000);
            });
          })
        );

        setProgress(((i + 0.5) / pageElements.length) * 90 + 5);

        // Detect page type for adaptive quality
        const isAttachmentPage = pageElement.querySelector('img[style*="object-fit"]') !== null;
        const isPhotoPage = pageElement.querySelector('.bg-teal-500') !== null; // Photo page has teal dot
        const isImageHeavy = isAttachmentPage || isPhotoPage;
        
        // Use lower scale for image-heavy pages (photos are already raster data)
        const captureScale = isImageHeavy ? 1.5 : 2.0;

        // Capture page to canvas with adaptive settings
        const canvas = await html2canvas(pageElement, {
          scale: captureScale,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          logging: false,
          imageTimeout: 5000,
          onclone: (_clonedDoc, clonedElement) => {
            applyPDFStyles(clonedElement);
            
            // For photo pages, downscale images in the clone to speed up capture
            if (isImageHeavy) {
              const clonedImages = clonedElement.querySelectorAll('img');
              clonedImages.forEach(img => {
                // Force smaller rendering to reduce canvas pixel count
                if (img instanceof HTMLImageElement) {
                  img.style.imageRendering = 'auto';
                }
              });
            }
          },
        });

        // Calculate dimensions to fit page
        const imgWidth = pageWidth - 20; // 10mm margins
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        // Add new page if not first
        if (i > 0) {
          pdf.addPage();
        }
        
        const xOffset = 10;
        const yOffset = 10;
        
        // Use JPEG compression for image-heavy pages, PNG for text clarity
        const imageData = isImageHeavy
          ? canvas.toDataURL('image/jpeg', 0.7)
          : canvas.toDataURL('image/png');
        
        pdf.addImage(
          imageData,
          isImageHeavy ? 'JPEG' : 'PNG',
          xOffset,
          yOffset,
          imgWidth,
          Math.min(imgHeight, pageHeight - 20)
        );

        setProgress(((i + 1) / pageElements.length) * 90 + 5);
        console.log(`📄 Page ${i + 1}/${pageElements.length} captured (${isImageHeavy ? 'JPEG' : 'PNG'}, scale:${captureScale})`);
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
      console.error('❌ PDF generation failed:', error);
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

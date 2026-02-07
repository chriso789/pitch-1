import { useCallback, useState } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { toast } from 'sonner';

interface PDFGenerationOptions {
  filename?: string;
  orientation?: 'portrait' | 'landscape';
  format?: 'a4' | 'letter';
  quality?: number;
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
  
  // Additional delay to ensure fonts are fully rasterized
  await new Promise(resolve => setTimeout(resolve, 150));
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

export function usePDFGeneration() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);

  const generatePDF = useCallback(async (
    elementId: string,
    options: PDFGenerationOptions = {}
  ): Promise<Blob | null> => {
    const {
      filename = 'measurement-report.pdf',
      orientation = 'portrait',
      format = 'letter',
      quality = 3, // Increased from 2 to 3 for sharper text
    } = options;

    setIsGenerating(true);
    setProgress(10);

    try {
      // CRITICAL: Wait for fonts to be fully loaded
      console.log('📄 Waiting for fonts to load...');
      await waitForFonts();
      setProgress(20);

      const element = document.getElementById(elementId);
      if (!element) {
        throw new Error(`Report element not found: ${elementId}`);
      }

      // Validate element has dimensions
      const rect = element.getBoundingClientRect();
      console.log('📄 PDF capture element:', elementId, { 
        width: rect.width, 
        height: rect.height,
        top: rect.top,
        left: rect.left
      });
      
      if (rect.width === 0 || rect.height === 0) {
        throw new Error('Element has no dimensions - may be hidden or not rendered');
      }

      setProgress(30);
      toast.info('Generating report preview...');

      // Capture the element as canvas with enhanced settings
      const canvas = await html2canvas(element, {
        scale: quality,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        x: 0,
        y: 0,
        scrollX: 0,
        scrollY: 0,
        windowWidth: element.scrollWidth,
        windowHeight: element.scrollHeight,
        // Critical: Apply PDF-optimized styles to cloned element
        onclone: (_clonedDoc, clonedElement) => {
          applyPDFStyles(clonedElement);
        },
      });

      setProgress(60);
      toast.info('Creating PDF...');

      // Create PDF with proper dimensions
      const imgWidth = orientation === 'portrait' ? 210 : 297; // A4/Letter dimensions in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      const pdf = new jsPDF({
        orientation,
        unit: 'mm',
        format,
      });

      // Use PNG format for better text clarity (no JPEG compression artifacts)
      const imgData = canvas.toDataURL('image/png');
      
      // Add pages if content is too tall
      let heightLeft = imgHeight;
      let position = 0;
      const pageHeight = orientation === 'portrait' ? 297 : 210;

      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      setProgress(90);

      // Convert to blob
      const blob = pdf.output('blob');
      
      setProgress(100);
      toast.success('PDF generated successfully');
      
      return blob;
    } catch (error: any) {
      console.error('❌ PDF generation error:', error);
      toast.error(error.message || 'Failed to generate PDF');
      return null;
    } finally {
      setIsGenerating(false);
      setProgress(0);
    }
  }, []);

  const downloadPDF = useCallback(async (
    elementId: string,
    options: PDFGenerationOptions = {}
  ) => {
    const blob = await generatePDF(elementId, options);
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = options.filename || 'measurement-report.pdf';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [generatePDF]);

  const printPDF = useCallback(async (
    elementId: string,
    options: PDFGenerationOptions = {}
  ) => {
    const blob = await generatePDF(elementId, options);
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    const printWindow = window.open(url, '_blank');
    if (printWindow) {
      printWindow.onload = () => {
        printWindow.print();
      };
    }
    URL.revokeObjectURL(url);
  }, [generatePDF]);

  return {
    generatePDF,
    downloadPDF,
    printPDF,
    isGenerating,
    progress,
  };
}

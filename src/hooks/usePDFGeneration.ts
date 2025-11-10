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
      quality = 2,
    } = options;

    setIsGenerating(true);
    setProgress(10);

    try {
      const element = document.getElementById(elementId);
      if (!element) {
        throw new Error('Report element not found');
      }

      setProgress(30);
      toast.info('Generating report preview...');

      // Capture the element as canvas
      const canvas = await html2canvas(element, {
        scale: quality,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
      });

      setProgress(60);
      toast.info('Creating PDF...');

      // Create PDF
      const imgWidth = orientation === 'portrait' ? 210 : 297; // A4 dimensions in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      const pdf = new jsPDF({
        orientation,
        unit: 'mm',
        format,
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      
      // Add pages if content is too tall
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

      setProgress(90);

      // Convert to blob
      const blob = pdf.output('blob');
      
      setProgress(100);
      toast.success('PDF generated successfully');
      
      return blob;
    } catch (error: any) {
      console.error('PDF generation error:', error);
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

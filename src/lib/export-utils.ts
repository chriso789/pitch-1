import Papa from 'papaparse';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';

/**
 * Export data to CSV file with optional metadata headers
 */
export function exportToCSV(
  data: any[],
  filename: string,
  metadataHeaders?: string[]
): void {
  try {
    // Convert data to CSV
    const csv = Papa.unparse(data);
    
    // Prepend metadata headers if provided
    const finalCsv = metadataHeaders 
      ? metadataHeaders.join('\n') + '\n' + csv
      : csv;
    
    // Create blob and download
    const blob = new Blob([finalCsv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('CSV export failed:', error);
    throw new Error('Failed to export CSV');
  }
}

/**
 * PDF generation options
 */
export interface PDFOptions {
  title?: string;
  dateRange?: string;
  companyName?: string;
  orientation?: 'portrait' | 'landscape';
  format?: 'a4' | 'letter';
}

/**
 * Export dashboard/report to PDF using html2canvas and jsPDF
 */
export async function exportDashboardToPDF(
  elementId: string,
  filename: string,
  options: PDFOptions = {}
): Promise<Blob> {
  try {
    const element = document.getElementById(elementId);
    if (!element) {
      throw new Error(`Element with ID "${elementId}" not found`);
    }

    // Capture element as canvas
    const canvas = await html2canvas(element, {
      scale: 2, // Higher quality
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    });

    // Calculate PDF dimensions
    const imgWidth = options.orientation === 'landscape' ? 297 : 210; // A4 mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    
    // Create PDF
    const pdf = new jsPDF({
      orientation: options.orientation || 'portrait',
      unit: 'mm',
      format: options.format || 'a4',
    });

    // Add header if options provided
    if (options.companyName || options.title) {
      pdf.setFontSize(16);
      pdf.text(options.title || 'Report', 15, 15);
      
      if (options.companyName) {
        pdf.setFontSize(10);
        pdf.text(options.companyName, 15, 22);
      }
      
      if (options.dateRange) {
        pdf.setFontSize(9);
        pdf.text(options.dateRange, 15, 28);
      }
    }

    // Add canvas image to PDF
    const imgData = canvas.toDataURL('image/png');
    const yOffset = options.title ? 35 : 10;
    pdf.addImage(imgData, 'PNG', 10, yOffset, imgWidth - 20, imgHeight);

    // Add footer
    const pageCount = pdf.getNumberOfPages();
    pdf.setFontSize(8);
    pdf.text(
      `Generated: ${format(new Date(), 'PPpp')} | Page ${pageCount}`,
      15,
      pdf.internal.pageSize.height - 10
    );

    // Save PDF
    pdf.save(filename);
    
    // Return blob for upload/email
    return pdf.output('blob');
  } catch (error) {
    console.error('PDF export failed:', error);
    throw new Error('Failed to generate PDF');
  }
}

/**
 * Generate a signed URL for a file in Supabase Storage
 */
export async function generateSignedURL(
  bucketPath: string,
  expiresIn: number = 604800 // 7 days in seconds
): Promise<string> {
  try {
    // Extract bucket name and file path
    const [bucket, ...pathParts] = bucketPath.split('/');
    const filePath = pathParts.join('/');
    
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(filePath, expiresIn);
    
    if (error) throw error;
    if (!data?.signedUrl) throw new Error('Failed to generate signed URL');
    
    return data.signedUrl;
  } catch (error) {
    console.error('Signed URL generation failed:', error);
    throw new Error('Failed to generate shareable link');
  }
}

/**
 * Upload blob to Supabase Storage and return path
 */
export async function uploadBlobToStorage(
  blob: Blob,
  bucket: string,
  path: string
): Promise<string> {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, blob, {
        contentType: blob.type,
        upsert: true,
      });
    
    if (error) throw error;
    if (!data?.path) throw new Error('Upload failed: no path returned');
    
    return data.path;
  } catch (error) {
    console.error('Storage upload failed:', error);
    throw new Error('Failed to upload file to storage');
  }
}

/**
 * Utility to format date range for exports
 */
export function formatDateRangeForExport(from?: Date, to?: Date): string {
  if (!from && !to) return 'All time';
  if (!to) return `From ${format(from!, 'PP')}`;
  if (!from) return `Until ${format(to, 'PP')}`;
  return `${format(from, 'PP')} - ${format(to, 'PP')}`;
}

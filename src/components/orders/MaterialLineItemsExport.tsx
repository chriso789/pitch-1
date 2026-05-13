import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import jsPDF from "jspdf";

interface MaterialItem {
  id: string;
  item_name: string;
  notes?: string;        // Color/specs for supplier orders
  color_specs?: string;  // Alternative field name for color
  qty: number;
  unit: string;
  unit_cost: number;
  line_total: number;
}

interface CompanyInfo {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  license_number?: string;
  logo_url?: string;
}

interface MaterialLineItemsExportProps {
  estimateId: string;
  materialItems: MaterialItem[];
  totalAmount: number;
  customerName?: string;
  projectAddress?: string;
  companyInfo?: CompanyInfo;
  jobNumber?: string;
}

export function MaterialLineItemsExport({ 
  estimateId, 
  materialItems, 
  totalAmount,
  customerName,
  projectAddress,
  companyInfo,
  jobNumber,
}: MaterialLineItemsExportProps) {
  const { toast } = useToast();

  const loadImageAsDataUrl = async (url: string): Promise<{ dataUrl: string; format: 'PNG' | 'JPEG' } | null> => {
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) return null;
      const blob = await res.blob();
      const format: 'PNG' | 'JPEG' = blob.type.includes('jpeg') || blob.type.includes('jpg') ? 'JPEG' : 'PNG';
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      return { dataUrl, format };
    } catch {
      return null;
    }
  };

  const generatePDF = async () => {
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 20;
      let yPos = 20;

      // ===== Company Header (logo + contact + license) =====
      const headerHeight = 38;
      const logo = companyInfo?.logo_url
        ? await loadImageAsDataUrl(companyInfo.logo_url)
        : null;

      let textX = margin;
      if (logo) {
        try {
          doc.addImage(logo.dataUrl, logo.format, margin, yPos, 28, 28, undefined, 'FAST');
          textX = margin + 34;
        } catch (e) {
          console.warn('Logo render failed', e);
        }
      }

      doc.setTextColor(17, 24, 39);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text(companyInfo?.name || 'Your Company', textX, yPos + 6);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(75, 85, 99);
      let metaY = yPos + 12;
      const contactLine = [companyInfo?.phone, companyInfo?.email].filter(Boolean).join('  •  ');
      if (contactLine) { doc.text(contactLine, textX, metaY); metaY += 4.5; }
      if (companyInfo?.address) { doc.text(companyInfo.address, textX, metaY); metaY += 4.5; }
      if (companyInfo?.license_number) { doc.text(`License #${companyInfo.license_number}`, textX, metaY); metaY += 4.5; }

      // Divider under header
      doc.setDrawColor(229, 231, 235);
      doc.line(margin, yPos + headerHeight - 2, pageWidth - margin, yPos + headerHeight - 2);
      yPos += headerHeight + 4;

      // Header - Blue color for materials
      const bannerHeight = 28;
      doc.setFillColor(59, 130, 246);
      doc.rect(margin, yPos, pageWidth - margin * 2, bannerHeight, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.text('MATERIAL ORDER', margin + 4, yPos + 11);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      const jobLine = jobNumber
        ? `Job #${jobNumber}   |   Estimate #${estimateId.slice(-8).toUpperCase()}`
        : `Estimate #${estimateId.slice(-8).toUpperCase()}`;
      doc.text(jobLine, margin + 4, yPos + 20);
      const dateText = `Date: ${new Date().toLocaleDateString()}`;
      doc.text(dateText, pageWidth - margin - 4 - doc.getTextWidth(dateText), yPos + 20);

      yPos += bannerHeight + 10;
      doc.setTextColor(0, 0, 0);
      
      // Project Info
      if (customerName || projectAddress) {
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Project Information', margin, yPos);
        yPos += 10;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        if (customerName) {
          doc.text(`Customer: ${customerName}`, margin, yPos);
          yPos += 6;
        }
        if (projectAddress) {
          doc.text(`Address: ${projectAddress}`, margin, yPos);
          yPos += 6;
        }
        yPos += 10;
      }

      // Job Site Address - PROMINENT SECTION
      if (projectAddress) {
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Job Site Address', margin, yPos);
        yPos += 8;

        doc.setFillColor(239, 246, 255); // Light blue background
        doc.rect(margin, yPos - 4, pageWidth - 2 * margin, 16, 'F');
        doc.setDrawColor(59, 130, 246); // Blue border
        doc.rect(margin, yPos - 4, pageWidth - 2 * margin, 16, 'S');
        
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(30, 64, 175); // Dark blue text
        doc.text(projectAddress, margin + 5, yPos + 5);
        doc.setTextColor(0, 0, 0); // Reset text color
        
        yPos += 22;
      }

      // Material Items Table
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('Material Items', margin, yPos);
      yPos += 10;

      // Column X positions (dedicated Color/Specs column)
      const colItemX = margin + 2;
      const colColorX = margin + 60;   // Color / Specs column
      const colQtyX = pageWidth - 100;
      const colUnitX = pageWidth - 80;
      const colCostX = pageWidth - 55;
      const colTotalX = pageWidth - 30;

      // Table headers
      doc.setFillColor(249, 250, 251);
      doc.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Item', colItemX, yPos);
      doc.text('Color / Specs', colColorX, yPos);
      doc.text('Qty', colQtyX, yPos);
      doc.text('Unit', colUnitX, yPos);
      doc.text('Unit Cost', colCostX, yPos);
      doc.text('Total', colTotalX, yPos);
      yPos += 10;

      // Helper to truncate text to fit column width
      const truncate = (txt: string, max: number) =>
        txt.length > max ? txt.substring(0, max - 1) + '…' : txt;

      // Table rows
      doc.setFont('helvetica', 'normal');
      materialItems.forEach((item) => {
        if (yPos > 260) {
          doc.addPage();
          yPos = 20;
        }

        const itemName = truncate(item.item_name || '', 32);
        const colorSpec = (item.notes || item.color_specs || '').trim();

        // Item name
        doc.setTextColor(0, 0, 0);
        doc.text(itemName, colItemX, yPos);

        // Color / Specs (dedicated column, bold + amber when present)
        if (colorSpec) {
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(180, 83, 9);
          doc.text(truncate(colorSpec, 22), colColorX, yPos);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(0, 0, 0);
        } else {
          doc.setTextColor(156, 163, 175);
          doc.text('—', colColorX, yPos);
          doc.setTextColor(0, 0, 0);
        }

        doc.text(item.qty.toFixed(1), colQtyX, yPos);
        doc.text(item.unit, colUnitX, yPos);
        doc.text(`$${item.unit_cost.toFixed(2)}`, colCostX, yPos);
        doc.text(`$${item.line_total.toFixed(2)}`, colTotalX, yPos);

        // If color text was truncated, print the full value on a wrapped line
        if (colorSpec && colorSpec.length > 22) {
          yPos += 5;
          doc.setFontSize(9);
          doc.setTextColor(180, 83, 9);
          doc.text(`Color/Specs: ${colorSpec}`, colItemX + 2, yPos);
          doc.setTextColor(0, 0, 0);
          doc.setFontSize(10);
        }

        yPos += 8;
      });

      // Total
      yPos += 5;
      doc.setDrawColor(229, 231, 235);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 10;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text('Total Material Cost:', pageWidth - 80, yPos);
      doc.setTextColor(59, 130, 246); // Blue for materials
      doc.text(`$${totalAmount.toFixed(2)}`, pageWidth - 30, yPos);

      // Footer
      const footerY = doc.internal.pageSize.getHeight() - 20;
      doc.setFontSize(8);
      doc.setTextColor(107, 114, 128);
      doc.text('Generated by PITCH CRM - Material Orders System', pageWidth / 2, footerY, { align: 'center' });
      doc.text(new Date().toLocaleString(), pageWidth / 2, footerY + 5, { align: 'center' });

      return doc;
    } catch (error) {
      console.error('Error generating Material PDF:', error);
      toast({
        title: "PDF Generation Failed",
        description: "Could not generate the material order PDF.",
        variant: "destructive"
      });
      return null;
    }
  };

  const handleDownloadPDF = async () => {
    const doc = await generatePDF();
    if (doc) {
      const fileName = jobNumber
        ? `Material_Order_${jobNumber}_${new Date().toISOString().split('T')[0]}.pdf`
        : `Material_Order_${estimateId.slice(-8)}_${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(fileName);
      toast({
        title: "PDF Downloaded",
        description: "Material order has been saved."
      });
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownloadPDF}
      className="gap-2"
      disabled={materialItems.length === 0}
    >
      <Download className="h-4 w-4" />
      Export Material Order
    </Button>
  );
}

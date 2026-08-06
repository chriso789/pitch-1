import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
  const [hideCosts, setHideCosts] = useState(false);

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

      yPos += bannerHeight + 8;
      doc.setTextColor(0, 0, 0);

      // Combined project / job-site block (single address, no duplication)
      if (customerName || projectAddress) {
        const blockH = customerName && projectAddress ? 18 : 12;
        doc.setFillColor(239, 246, 255);
        doc.rect(margin, yPos, pageWidth - 2 * margin, blockH, 'F');
        doc.setDrawColor(59, 130, 246);
        doc.rect(margin, yPos, pageWidth - 2 * margin, blockH, 'S');

        let infoY = yPos + 7;
        doc.setFontSize(10);
        if (customerName) {
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(30, 64, 175);
          doc.text(customerName, margin + 5, infoY);
          infoY += 6;
        }
        if (projectAddress) {
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(30, 64, 175);
          doc.text(`Job Site: ${projectAddress}`, margin + 5, infoY);
        }
        doc.setTextColor(0, 0, 0);
        yPos += blockH + 8;
      }

      // Material Items Table
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text('Material Items', margin, yPos);
      yPos += 8;

      // Column X positions (dedicated Color/Specs column)
      const colItemX = margin + 2;
      const colColorX = margin + 60;   // Color / Specs column
      const colQtyX = hideCosts ? pageWidth - 60 : pageWidth - 100;
      const colUnitX = hideCosts ? pageWidth - 35 : pageWidth - 80;
      const colCostX = pageWidth - 55;
      const colTotalX = pageWidth - 30;

      // Fit-to-one-page sizing
      const pageBottom = doc.internal.pageSize.getHeight() - 32;
      const available = pageBottom - yPos - 18; // reserve space for total
      const count = Math.max(materialItems.length, 1);
      const rowH = Math.max(4.2, Math.min(7, available / count));
      const bodyFont = rowH < 5.4 ? 8 : rowH < 6.2 ? 9 : 10;

      // Table headers
      doc.setFillColor(249, 250, 251);
      doc.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
      doc.setFontSize(bodyFont);
      doc.setFont('helvetica', 'bold');
      doc.text('Item', colItemX, yPos);
      doc.text('Color / Specs', colColorX, yPos);
      doc.text('Qty', colQtyX, yPos);
      doc.text('Unit', colUnitX, yPos);
      if (!hideCosts) {
        doc.text('Unit Cost', colCostX, yPos);
        doc.text('Total', colTotalX, yPos);
      }
      yPos += rowH + 2;

      // Helper to truncate text to fit column width
      const truncate = (txt: string, max: number) =>
        txt.length > max ? txt.substring(0, max - 1) + '…' : txt;

      // Table rows
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(bodyFont);
      materialItems.forEach((item) => {
        if (yPos > pageBottom) {
          doc.addPage();
          yPos = 20;
        }

        const itemName = truncate(item.item_name || '', 34);
        const rawSpec: unknown = item.notes ?? item.color_specs ?? '';
        const colorSpec = (typeof rawSpec === 'string' ? rawSpec : String(rawSpec ?? '')).trim();

        // Item name
        doc.setTextColor(0, 0, 0);
        doc.text(itemName, colItemX, yPos);

        // Color / Specs (dedicated column, bold + amber when present)
        if (colorSpec) {
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(180, 83, 9);
          doc.text(truncate(colorSpec, 26), colColorX, yPos);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(0, 0, 0);
        } else {
          doc.setTextColor(156, 163, 175);
          doc.text('—', colColorX, yPos);
          doc.setTextColor(0, 0, 0);
        }

        doc.text(item.qty.toFixed(1), colQtyX, yPos);
        doc.text(item.unit, colUnitX, yPos);
        if (!hideCosts) {
          doc.text(`$${item.unit_cost.toFixed(2)}`, colCostX, yPos);
          doc.text(`$${item.line_total.toFixed(2)}`, colTotalX, yPos);
        }

        yPos += rowH;
      });


      // Total
      if (!hideCosts) {
        yPos += 5;
        doc.setDrawColor(229, 231, 235);
        doc.line(margin, yPos, pageWidth - margin, yPos);
        yPos += 10;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text('Total Material Cost:', pageWidth - 80, yPos);
        doc.setTextColor(59, 130, 246); // Blue for materials
        doc.text(`$${totalAmount.toFixed(2)}`, pageWidth - 30, yPos);
      }

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
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <Checkbox
          id="hide-material-costs"
          checked={hideCosts}
          onCheckedChange={(v) => setHideCosts(v === true)}
        />
        <Label htmlFor="hide-material-costs" className="text-sm font-normal cursor-pointer">
          Hide costs
        </Label>
      </div>
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
    </div>
  );
}

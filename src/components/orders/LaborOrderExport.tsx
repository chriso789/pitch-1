import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Mail, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import jsPDF from "jspdf";

interface LaborItem {
  id: string;
  item_name: string;
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
}

interface LaborOrderExportProps {
  estimateId: string;
  laborItems: LaborItem[];
  totalAmount: number;
  customerName?: string;
  projectAddress?: string;
  companyInfo?: CompanyInfo;
  crewEmail?: string;
  crewName?: string;
}

export function LaborOrderExport({ 
  estimateId, 
  laborItems, 
  totalAmount,
  customerName,
  projectAddress,
  companyInfo,
  crewEmail,
  crewName
}: LaborOrderExportProps) {
  const { toast } = useToast();
  const [sending, setSending] = useState(false);

  const generatePDF = () => {
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 20;
      let yPos = 20;

      // Header with Company Branding
      doc.setFillColor(52, 211, 153); // Green color for labor
      doc.rect(0, 0, pageWidth, 50, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(24);
      doc.text('LABOR ORDER', margin, 20);
      doc.setFontSize(12);
      doc.text(`Ref #${estimateId.slice(-8).toUpperCase()}`, margin, 30);
      doc.text(`Date: ${new Date().toLocaleDateString()}`, margin, 38);
      
      // Company Info in Header (Right Side)
      if (companyInfo?.name) {
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text(companyInfo.name, pageWidth - margin, 15, { align: 'right' });
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        let headerY = 22;
        if (companyInfo.phone) {
          doc.text(`Phone: ${companyInfo.phone}`, pageWidth - margin, headerY, { align: 'right' });
          headerY += 5;
        }
        if (companyInfo.email) {
          doc.text(`Email: ${companyInfo.email}`, pageWidth - margin, headerY, { align: 'right' });
          headerY += 5;
        }
        if (companyInfo.license_number) {
          doc.text(`License: ${companyInfo.license_number}`, pageWidth - margin, headerY, { align: 'right' });
        }
      }

      yPos = 60;
      doc.setTextColor(0, 0, 0);

      // FROM Section (Company Info)
      if (companyInfo?.name) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('FROM:', margin, yPos);
        yPos += 8;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(companyInfo.name, margin, yPos);
        yPos += 5;
        if (companyInfo.address) {
          doc.text(companyInfo.address, margin, yPos);
          yPos += 5;
        }
        if (companyInfo.phone) {
          doc.text(`Tel: ${companyInfo.phone}`, margin, yPos);
          yPos += 5;
        }
        yPos += 8;
      }

      // TO Section (Crew Info) - Right side
      if (crewName || crewEmail) {
        const rightColX = pageWidth / 2 + 10;
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('TO (Crew):', rightColX, 60);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        let crewY = 68;
        if (crewName) {
          doc.text(crewName, rightColX, crewY);
          crewY += 5;
        }
        if (crewEmail) {
          doc.text(crewEmail, rightColX, crewY);
        }
      }
      
      // Project Info
      if (customerName || projectAddress) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('Project Information', margin, yPos);
        yPos += 8;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        if (customerName) {
          doc.text(`Customer: ${customerName}`, margin, yPos);
          yPos += 5;
        }
        if (projectAddress) {
          doc.text(`Address: ${projectAddress}`, margin, yPos);
          yPos += 5;
        }
        yPos += 8;
      }

      // Job Site Address - PROMINENT SECTION
      if (projectAddress) {
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Job Site Address', margin, yPos);
        yPos += 8;

        doc.setFillColor(236, 253, 245); // Light green background
        doc.rect(margin, yPos - 4, pageWidth - 2 * margin, 16, 'F');
        doc.setDrawColor(52, 211, 153); // Green border
        doc.rect(margin, yPos - 4, pageWidth - 2 * margin, 16, 'S');
        
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(6, 95, 70); // Dark green text
        doc.text(projectAddress, margin + 5, yPos + 5);
        doc.setTextColor(0, 0, 0); // Reset text color
        
        yPos += 22;
      }

      // Labor Items Table
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('Labor Items', margin, yPos);
      yPos += 10;

      // Table headers
      doc.setFillColor(249, 250, 251);
      doc.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Description', margin + 2, yPos);
      doc.text('Qty', pageWidth - 100, yPos);
      doc.text('Unit', pageWidth - 80, yPos);
      doc.text('Rate', pageWidth - 55, yPos);
      doc.text('Total', pageWidth - 30, yPos);
      yPos += 10;

      // Table rows
      doc.setFont('helvetica', 'normal');
      laborItems.forEach((item) => {
        if (yPos > 250) {
          doc.addPage();
          yPos = 20;
        }
        
        const desc = item.item_name.length > 40 
          ? item.item_name.substring(0, 40) + '...' 
          : item.item_name;
        
        doc.text(desc, margin + 2, yPos);
        doc.text(item.qty.toFixed(1), pageWidth - 100, yPos);
        doc.text(item.unit, pageWidth - 80, yPos);
        doc.text(`$${item.unit_cost.toFixed(2)}`, pageWidth - 55, yPos);
        doc.text(`$${item.line_total.toFixed(2)}`, pageWidth - 30, yPos);
        yPos += 8;
      });

      // Total
      yPos += 5;
      doc.setDrawColor(229, 231, 235);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 10;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text('Total Labor Cost:', pageWidth - 80, yPos);
      doc.setTextColor(52, 211, 153);
      doc.text(`$${totalAmount.toFixed(2)}`, pageWidth - 30, yPos);

      // Footer with Company Branding
      const footerY = doc.internal.pageSize.getHeight() - 25;
      doc.setDrawColor(229, 231, 235);
      doc.line(margin, footerY - 5, pageWidth - margin, footerY - 5);
      doc.setFontSize(8);
      doc.setTextColor(107, 114, 128);
      if (companyInfo?.name) {
        doc.text(`Order from: ${companyInfo.name}`, margin, footerY);
        if (companyInfo.phone) {
          doc.text(`Contact: ${companyInfo.phone}`, margin, footerY + 5);
        }
      }
      doc.text('Generated by PITCH CRM', pageWidth / 2, footerY, { align: 'center' });
      doc.text(new Date().toLocaleString(), pageWidth - margin, footerY, { align: 'right' });

      return doc;
    } catch (error) {
      console.error('Error generating Labor PDF:', error);
      toast({
        title: "PDF Generation Failed",
        description: "Could not generate the labor order PDF.",
        variant: "destructive"
      });
      return null;
    }
  };

  const handleDownloadPDF = () => {
    const doc = generatePDF();
    if (doc) {
      doc.save(`Labor_Order_${estimateId.slice(-8)}_${new Date().toISOString().split('T')[0]}.pdf`);
      toast({
        title: "PDF Downloaded",
        description: "Labor order has been saved."
      });
    }
  };

  const handleEmailCrew = async () => {
    if (!crewEmail) {
      toast({
        title: "No Crew Email",
        description: "Please assign a crew with an email address first.",
        variant: "destructive"
      });
      return;
    }

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('labor-order-send-email', {
        body: {
          estimateId,
          laborItems,
          totalAmount,
          customerName,
          projectAddress,
          companyInfo,
          crewEmail,
          crewName
        }
      });

      if (error) throw error;

      toast({
        title: "Email Sent",
        description: `Labor order sent to ${crewName || crewEmail}`
      });
    } catch (error: any) {
      console.error('Failed to send email:', error);
      toast({
        title: "Failed to send email",
        description: error.message || "Please try again.",
        variant: "destructive"
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleDownloadPDF}
        className="gap-2"
        disabled={laborItems.length === 0}
      >
        <Download className="h-4 w-4" />
        Export Labor Order
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={handleEmailCrew}
        disabled={laborItems.length === 0 || sending || !crewEmail}
        className="gap-2"
      >
        {sending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Mail className="h-4 w-4" />
        )}
        {sending ? 'Sending...' : 'Email Crew'}
      </Button>
    </div>
  );
}
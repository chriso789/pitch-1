import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Download, Mail, Loader2, MailCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import jsPDF from "jspdf";

interface LaborItem {
  id: string;
  item_name: string;
  qty: number;
  unit: string;
  unit_cost: number;
  line_total: number;
  notes?: string;
  color_specs?: string;
}

interface CompanyInfo {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  license_number?: string;
  logo_url?: string;
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
  jobNumber?: string;
}

export function LaborOrderExport({
  estimateId,
  laborItems,
  customerName,
  projectAddress,
  companyInfo,
  crewEmail,
  crewName,
  jobNumber,
}: LaborOrderExportProps) {
  const { toast } = useToast();
  const effectiveTenantId = useEffectiveTenantId();
  const [sending, setSending] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [emailInput, setEmailInput] = useState(crewEmail ?? "");
  const [nameInput, setNameInput] = useState(crewName ?? "");

  // Listen for crew open notifications
  useEffect(() => {
    if (!effectiveTenantId) return;
    const channel = supabase
      .channel(`labor-order-opens-${effectiveTenantId}`)
      .on('broadcast', { event: 'labor_order_opened' }, ({ payload }) => {
        if (payload?.estimate_id && payload.estimate_id !== estimateId) return;
        toast({
          title: payload?.first_open ? "Crew opened the work order" : "Work order viewed again",
          description: `${payload?.recipient_name || payload?.recipient_email} just opened the email.`,
        });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [effectiveTenantId, estimateId, toast]);

  const buildCrewPDF = () => {
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 20;
      let yPos = 20;

      // Header
      doc.setFillColor(52, 211, 153);
      doc.rect(0, 0, pageWidth, 50, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(22);
      doc.text('CREW WORK ORDER', margin, 22);
      doc.setFontSize(11);
      doc.text(
        jobNumber
          ? `Job #${jobNumber}   |   Ref #${estimateId.slice(-8).toUpperCase()}`
          : `Ref #${estimateId.slice(-8).toUpperCase()}`,
        margin,
        32
      );
      doc.text(`Date: ${new Date().toLocaleDateString()}`, margin, 40);

      // Company info (right side)
      if (companyInfo?.name) {
        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        doc.text(companyInfo.name, pageWidth - margin, 16, { align: 'right' });
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        let h = 23;
        if (companyInfo.phone) { doc.text(`Tel: ${companyInfo.phone}`, pageWidth - margin, h, { align: 'right' }); h += 5; }
        if (companyInfo.email) { doc.text(companyInfo.email, pageWidth - margin, h, { align: 'right' }); h += 5; }
        if (companyInfo.license_number) doc.text(`Lic: ${companyInfo.license_number}`, pageWidth - margin, h, { align: 'right' });
      }

      yPos = 64;
      doc.setTextColor(0, 0, 0);

      // Job site box
      if (customerName || projectAddress) {
        doc.setFillColor(236, 253, 245);
        doc.rect(margin, yPos - 4, pageWidth - 2 * margin, 22, 'F');
        doc.setDrawColor(52, 211, 153);
        doc.rect(margin, yPos - 4, pageWidth - 2 * margin, 22, 'S');
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(6, 95, 70);
        doc.text('JOB SITE', margin + 4, yPos + 2);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(17, 24, 39);
        doc.setFontSize(11);
        if (customerName) doc.text(`Customer: ${customerName}`, margin + 4, yPos + 9);
        if (projectAddress) doc.text(`Address: ${projectAddress}`, margin + 4, yPos + 15);
        yPos += 30;
      }

      // Crew info
      if (nameInput || emailInput) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('Assigned Crew:', margin, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(`${nameInput || ''}${emailInput ? `  (${emailInput})` : ''}`, margin + 35, yPos);
        yPos += 10;
      }

      // Scope of work table — quantities only, NO pricing
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text('Scope of Work', margin, yPos);
      yPos += 8;

      doc.setFillColor(249, 250, 251);
      doc.rect(margin, yPos - 5, pageWidth - 2 * margin, 9, 'F');
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('#', margin + 2, yPos);
      doc.text('Item', margin + 14, yPos);
      doc.text('Qty', pageWidth - 60, yPos, { align: 'right' });
      doc.text('Unit', pageWidth - 25, yPos, { align: 'right' });
      yPos += 9;

      doc.setFont('helvetica', 'normal');
      laborItems.forEach((item, idx) => {
        if (yPos > 260) { doc.addPage(); yPos = 20; }
        const desc = item.item_name.length > 60 ? item.item_name.substring(0, 60) + '…' : item.item_name;
        doc.text(String(idx + 1), margin + 2, yPos);
        doc.text(desc, margin + 14, yPos);
        doc.text(Number(item.qty).toFixed(2), pageWidth - 60, yPos, { align: 'right' });
        doc.text(item.unit || '', pageWidth - 25, yPos, { align: 'right' });
        yPos += 7;
        const meta = [item.color_specs, item.notes].filter(Boolean).join(' • ');
        if (meta) {
          doc.setFontSize(8);
          doc.setTextColor(107, 114, 128);
          doc.text(meta, margin + 14, yPos);
          doc.setFontSize(10);
          doc.setTextColor(0, 0, 0);
          yPos += 6;
        }
      });

      // Footer
      const footerY = doc.internal.pageSize.getHeight() - 20;
      doc.setDrawColor(229, 231, 235);
      doc.line(margin, footerY - 5, pageWidth - margin, footerY - 5);
      doc.setFontSize(8);
      doc.setTextColor(107, 114, 128);
      if (companyInfo?.name) {
        doc.text(`Issued by: ${companyInfo.name}${companyInfo.phone ? ` • ${companyInfo.phone}` : ''}`, margin, footerY);
      }
      doc.text(new Date().toLocaleString(), pageWidth - margin, footerY, { align: 'right' });

      return doc;
    } catch (error) {
      console.error('Error generating crew PDF:', error);
      toast({ title: "PDF Generation Failed", description: "Could not generate the crew work order.", variant: "destructive" });
      return null;
    }
  };

  const handleDownloadPDF = () => {
    const doc = buildCrewPDF();
    if (doc) {
      doc.save(`Crew_Work_Order_${estimateId.slice(-8)}_${new Date().toISOString().split('T')[0]}.pdf`);
      toast({ title: "PDF Downloaded", description: "Crew work order saved (no pricing)." });
    }
  };

  const sendEmail = async () => {
    if (!emailInput || !emailInput.includes('@')) {
      toast({ title: "Email required", description: "Enter a valid crew email address.", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const { error } = await supabase.functions.invoke('email-api', {
        body: {
          __route: '/labor-order/send',
          estimateId,
          laborItems: laborItems.map(i => ({
            item_name: i.item_name,
            qty: i.qty,
            unit: i.unit,
            notes: i.notes,
            color_specs: i.color_specs,
          })),
          customerName,
          projectAddress,
          companyInfo,
          crewEmail: emailInput,
          crewName: nameInput,
        },
      });
      if (error) throw error;
      toast({
        title: "Work order sent",
        description: `Sent to ${nameInput || emailInput}. You'll be notified when it's opened.`,
      });
      setDialogOpen(false);
    } catch (error: any) {
      console.error('Failed to send email:', error);
      toast({
        title: "Failed to send email",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
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
          onClick={() => setDialogOpen(true)}
          disabled={laborItems.length === 0}
          className="gap-2"
        >
          <Mail className="h-4 w-4" />
          Email Crew
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MailCheck className="h-5 w-5 text-emerald-600" />
              Send Crew Work Order
            </DialogTitle>
            <DialogDescription>
              The crew receives a branded email with quantities only — no pricing. You'll get a notification when they open it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="crew-name">Crew / Foreman Name</Label>
              <Input
                id="crew-name"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="e.g. Mike's Install Crew"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="crew-email">Crew Email</Label>
              <Input
                id="crew-email"
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="crew@example.com"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={sendEmail} disabled={sending} className="gap-2">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              {sending ? 'Sending…' : 'Send Work Order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

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
  pipelineEntryId?: string;
  laborItems: LaborItem[];
  totalAmount: number;
  customerName?: string;
  projectAddress?: string;
  companyInfo?: CompanyInfo;
  crewEmail?: string;
  crewName?: string;
  jobNumber?: string;
}

// Fetch an image URL and return a data URL + native dims (for aspect-correct placement)
async function fetchImageAsDataURL(url: string): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    const dims: { width: number; height: number } = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: 1, height: 1 });
      img.src = dataUrl;
    });
    return { dataUrl, ...dims };
  } catch {
    return null;
  }
}

export function LaborOrderExport({
  estimateId,
  pipelineEntryId,
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
  const [downloading, setDownloading] = useState(false);
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

  const buildCrewPDF = async () => {
    try {
      const doc = new jsPDF({ unit: 'mm', format: 'letter' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 16;

      // Palette
      const brand = { r: 15, g: 118, b: 110 }; // teal-700
      const brandSoft = { r: 240, g: 253, b: 250 }; // teal-50
      const ink = { r: 17, g: 24, b: 39 }; // gray-900
      const muted = { r: 107, g: 114, b: 128 }; // gray-500
      const rule = { r: 229, g: 231, b: 235 }; // gray-200

      // ── Header band
      const headerH = 34;
      doc.setFillColor(brand.r, brand.g, brand.b);
      doc.rect(0, 0, pageWidth, headerH, 'F');

      // Logo (left) — fetch and embed if available
      let titleX = margin;
      if (companyInfo?.logo_url) {
        const img = await fetchImageAsDataURL(companyInfo.logo_url);
        if (img) {
          const maxH = 18;
          const maxW = 44;
          const ratio = img.width / img.height;
          let h = maxH;
          let w = h * ratio;
          if (w > maxW) { w = maxW; h = w / ratio; }
          try {
            doc.addImage(img.dataUrl, 'PNG', margin, (headerH - h) / 2, w, h);
            titleX = margin + w + 6;
          } catch {
            // ignore image failures — fall through to text title
          }
        }
      }

      // Title
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.text('CREW WORK ORDER', titleX, 17);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      const refLine =
        jobNumber
          ? `Job #${jobNumber}   ·   Ref #${estimateId.slice(-8).toUpperCase()}`
          : `Ref #${estimateId.slice(-8).toUpperCase()}`;
      doc.text(refLine, titleX, 24);
      doc.text(`Date: ${new Date().toLocaleDateString()}`, titleX, 29.5);

      // Company contact (right) — NO address per requirement
      if (companyInfo?.name) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(companyInfo.name, pageWidth - margin, 13, { align: 'right' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        let ch = 19;
        if (companyInfo.phone) { doc.text(companyInfo.phone, pageWidth - margin, ch, { align: 'right' }); ch += 4.5; }
        if (companyInfo.email) { doc.text(companyInfo.email, pageWidth - margin, ch, { align: 'right' }); ch += 4.5; }
        if (companyInfo.license_number) doc.text(`Lic #${companyInfo.license_number}`, pageWidth - margin, ch, { align: 'right' });
      }

      let yPos = headerH + 10;
      doc.setTextColor(ink.r, ink.g, ink.b);

      // ── Job site card
      if (customerName || projectAddress) {
        const cardH = 22;
        doc.setFillColor(brandSoft.r, brandSoft.g, brandSoft.b);
        doc.roundedRect(margin, yPos, pageWidth - 2 * margin, cardH, 2, 2, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(brand.r, brand.g, brand.b);
        doc.text('JOB SITE', margin + 4, yPos + 6);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10.5);
        doc.setTextColor(ink.r, ink.g, ink.b);
        if (customerName) doc.text(customerName, margin + 4, yPos + 12);
        if (projectAddress) {
          doc.setTextColor(muted.r, muted.g, muted.b);
          doc.setFontSize(10);
          doc.text(projectAddress, margin + 4, yPos + 18);
          doc.setTextColor(ink.r, ink.g, ink.b);
        }
        yPos += cardH + 8;
      }

      // ── Crew assignment (compact)
      if (nameInput || emailInput) {
        doc.setFontSize(9.5);
        doc.setTextColor(muted.r, muted.g, muted.b);
        doc.text('ASSIGNED CREW', margin, yPos);
        doc.setTextColor(ink.r, ink.g, ink.b);
        doc.setFont('helvetica', 'bold');
        doc.text(`${nameInput || ''}${emailInput ? `   ${emailInput}` : ''}`, margin + 40, yPos);
        doc.setFont('helvetica', 'normal');
        yPos += 8;
      }

      // ── Scope of work
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text('Scope of Work', margin, yPos);
      yPos += 5;
      doc.setDrawColor(brand.r, brand.g, brand.b);
      doc.setLineWidth(0.6);
      doc.line(margin, yPos, margin + 28, yPos);
      doc.setLineWidth(0.2);
      yPos += 6;

      // Table header row
      const colX = {
        num: margin + 2,
        item: margin + 12,
        qty: pageWidth - margin - 38,
        unit: pageWidth - margin - 4,
      };
      doc.setFillColor(249, 250, 251);
      doc.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, 'F');
      doc.setFontSize(9);
      doc.setTextColor(muted.r, muted.g, muted.b);
      doc.setFont('helvetica', 'bold');
      doc.text('#', colX.num, yPos);
      doc.text('ITEM', colX.item, yPos);
      doc.text('QTY', colX.qty, yPos, { align: 'right' });
      doc.text('UNIT', colX.unit, yPos, { align: 'right' });
      yPos += 6;

      // Rows
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(ink.r, ink.g, ink.b);
      doc.setFontSize(10.5);
      laborItems.forEach((item, idx) => {
        if (yPos > pageHeight - 30) { doc.addPage(); yPos = 20; }

        // Zebra
        if (idx % 2 === 1) {
          doc.setFillColor(252, 252, 253);
          doc.rect(margin, yPos - 4.5, pageWidth - 2 * margin, 8, 'F');
        }

        const nameLines = doc.splitTextToSize(item.item_name, colX.qty - colX.item - 4);
        doc.text(String(idx + 1), colX.num, yPos);
        doc.text(nameLines[0] || '', colX.item, yPos);
        doc.text(Number(item.qty).toFixed(2), colX.qty, yPos, { align: 'right' });
        doc.text(item.unit || '', colX.unit, yPos, { align: 'right' });
        yPos += 6;

        // Wrapped name overflow lines
        for (let li = 1; li < nameLines.length; li++) {
          if (yPos > pageHeight - 30) { doc.addPage(); yPos = 20; }
          doc.text(nameLines[li], colX.item, yPos);
          yPos += 5;
        }

        const meta = [item.color_specs, item.notes].filter(Boolean).join(' · ');
        if (meta) {
          if (yPos > pageHeight - 30) { doc.addPage(); yPos = 20; }
          doc.setFontSize(8.5);
          doc.setTextColor(muted.r, muted.g, muted.b);
          const metaLines = doc.splitTextToSize(meta, colX.qty - colX.item - 4);
          metaLines.forEach((ml: string) => {
            doc.text(ml, colX.item, yPos);
            yPos += 4;
          });
          doc.setFontSize(10.5);
          doc.setTextColor(ink.r, ink.g, ink.b);
          yPos += 1;
        }

        // Row divider
        doc.setDrawColor(rule.r, rule.g, rule.b);
        doc.line(margin, yPos - 1, pageWidth - margin, yPos - 1);
        yPos += 3;
      });

      // Signature area
      if (yPos < pageHeight - 55) {
        yPos = pageHeight - 55;
        doc.setDrawColor(rule.r, rule.g, rule.b);
        doc.setFontSize(9);
        doc.setTextColor(muted.r, muted.g, muted.b);

        const colW = (pageWidth - 2 * margin - 10) / 2;
        // Crew sig
        doc.line(margin, yPos, margin + colW, yPos);
        doc.text('Crew Foreman Signature', margin, yPos + 4);
        doc.text('Date', margin + colW - 20, yPos + 4);
        // PM sig
        doc.line(margin + colW + 10, yPos, pageWidth - margin, yPos);
        doc.text('Project Manager Signature', margin + colW + 10, yPos + 4);
        doc.text('Date', pageWidth - margin - 20, yPos + 4);
      }

      // Footer
      const footerY = pageHeight - 12;
      doc.setDrawColor(rule.r, rule.g, rule.b);
      doc.line(margin, footerY - 5, pageWidth - margin, footerY - 5);
      doc.setFontSize(8);
      doc.setTextColor(muted.r, muted.g, muted.b);
      const footerLeft = companyInfo?.name
        ? `${companyInfo.name}${companyInfo.phone ? ` · ${companyInfo.phone}` : ''}`
        : '';
      if (footerLeft) doc.text(footerLeft, margin, footerY);
      const pageCount = doc.getNumberOfPages();
      doc.text(`Generated ${new Date().toLocaleString()}   ·   Page 1 of ${pageCount}`, pageWidth - margin, footerY, { align: 'right' });

      return doc;
    } catch (error) {
      console.error('Error generating crew PDF:', error);
      toast({ title: "PDF Generation Failed", description: "Could not generate the crew work order.", variant: "destructive" });
      return null;
    }
  };

  const uploadToDocuments = async (blob: Blob, filename: string) => {
    if (!effectiveTenantId || !pipelineEntryId) return;
    try {
      const path = `${effectiveTenantId}/${pipelineEntryId}/labor-orders/${estimateId}.pdf`;
      const { error: upErr } = await supabase.storage
        .from('documents')
        .upload(path, blob, { contentType: 'application/pdf', upsert: true });
      if (upErr) {
        console.warn('Labor order upload failed:', upErr);
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      // Upsert-like: try to find existing doc for this estimate
      const { data: existing } = await (supabase as any)
        .from('documents')
        .select('id')
        .eq('tenant_id', effectiveTenantId)
        .eq('pipeline_entry_id', pipelineEntryId)
        .eq('document_type', 'labor_order')
        .eq('file_path', path)
        .maybeSingle();

      if (existing?.id) {
        await (supabase as any)
          .from('documents')
          .update({
            filename,
            file_size: blob.size,
            mime_type: 'application/pdf',
            description: `Crew work order for estimate ${estimateId.slice(-8).toUpperCase()}`,
          })
          .eq('id', existing.id);
      } else {
        await (supabase as any)
          .from('documents')
          .insert({
            tenant_id: effectiveTenantId,
            pipeline_entry_id: pipelineEntryId,
            document_type: 'labor_order',
            filename,
            file_path: path,
            file_size: blob.size,
            mime_type: 'application/pdf',
            uploaded_by: user?.id,
            description: `Crew work order for estimate ${estimateId.slice(-8).toUpperCase()}`,
          });
      }
    } catch (err) {
      console.warn('Labor order documents save failed:', err);
    }
  };

  const handleDownloadPDF = async () => {
    setDownloading(true);
    try {
      const doc = await buildCrewPDF();
      if (!doc) return;
      const filename = `Crew_Work_Order_${estimateId.slice(-8)}_${new Date().toISOString().split('T')[0]}.pdf`;
      const blob = doc.output('blob');
      await uploadToDocuments(blob, filename);
      doc.save(filename);
      toast({
        title: "Work order saved",
        description: pipelineEntryId
          ? "Downloaded and saved to the project's Documents tab."
          : "Downloaded (no pricing shown).",
      });
    } finally {
      setDownloading(false);
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
          disabled={laborItems.length === 0 || downloading}
        >
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {downloading ? 'Preparing…' : 'Export Labor Order'}
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

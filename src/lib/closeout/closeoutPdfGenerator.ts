import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { supabase } from '@/integrations/supabase/client';
import type { CompanyInfo } from '@/hooks/useCompanyInfo';
import { generateInvoicePdfBlob } from '@/lib/invoices/invoicePdfGenerator';
import { format } from 'date-fns';

const escape = (s: any) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(n || 0);

export const DEFAULT_WORKMANSHIP_WARRANTY = `WORKMANSHIP WARRANTY

The Contractor warrants to the Owner that all labor and workmanship performed under this contract shall be free from defects in installation for a period of FIVE (5) YEARS from the date of substantial completion noted above. This workmanship warranty covers the installation of all roofing, siding, gutters, and related components installed by the Contractor.

This warranty does NOT cover:
  • Damage caused by acts of God, including but not limited to wind events exceeding manufacturer wind ratings, hail, lightning, fire, or falling objects.
  • Damage resulting from alterations, repairs, or modifications to the work performed by parties other than the Contractor.
  • Normal wear and tear, fading, weathering, or natural aging of materials.
  • Damage caused by structural movement, settling, or failure of the underlying decking or framing not installed by the Contractor.
  • Manufacturer material defects — these are covered separately under the applicable manufacturer's product warranty.

To make a warranty claim, the Owner must notify the Contractor in writing within thirty (30) days of discovering the defect. The Contractor will inspect the reported condition and, if covered, repair or replace the defective workmanship at no cost to the Owner. This warranty is non-transferable and applies only to the original Owner at the property address listed above.`;

interface CompletionCertData {
  certificateNumber: string;
  completionDate: string; // formatted
  company: CompanyInfo | null | undefined;
  customer: {
    name?: string | null;
    address?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  scopeOfWork?: string;
  contractValue?: number;
  warrantyText: string;
}

function buildCompletionCertHtml(data: CompletionCertData): string {
  const company = data.company || {};
  const logo = company.logo_url
    ? `<img src="${escape(company.logo_url)}" crossorigin="anonymous" style="max-height:80px;max-width:240px;object-fit:contain"/>`
    : `<div style="font-size:24px;font-weight:700;color:#0a2540">${escape(company.name || 'CONTRACTOR')}</div>`;

  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2937;background:#ffffff;width:100%;box-sizing:border-box">
    <!-- HEADER -->
    <div style="background:#0a2540;color:#ffffff;padding:24px 32px;display:flex;justify-content:space-between;align-items:center">
      <div style="display:flex;flex-direction:column;gap:6px">
        <div style="background:#fff;padding:6px 10px;border-radius:6px;display:inline-block;width:fit-content">${logo}</div>
        <div style="font-size:11px;opacity:0.9;line-height:1.5">
          ${company.address ? escape(company.address) + '<br/>' : ''}
          ${company.phone ? 'Phone: ' + escape(company.phone) : ''}
          ${company.email ? ' &nbsp;•&nbsp; ' + escape(company.email) : ''}
          ${company.license_number ? '<br/>License #' + escape(company.license_number) : ''}
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:26px;font-weight:700;letter-spacing:2px">CERTIFICATE</div>
        <div style="font-size:13px;opacity:0.9;margin-top:4px">OF COMPLETION</div>
        <div style="font-size:11px;opacity:0.8;margin-top:6px">${escape(data.certificateNumber)}</div>
      </div>
    </div>

    <!-- DECORATIVE BAND -->
    <div style="background:linear-gradient(90deg,#0a2540,#1d4ed8);height:6px"></div>

    <!-- BODY -->
    <div style="padding:32px">
      <div style="text-align:center;margin-bottom:24px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#6b7280">This certifies that the work has been</div>
        <div style="font-size:34px;font-weight:700;color:#0a2540;margin-top:6px;letter-spacing:1px">SUBSTANTIALLY COMPLETED</div>
        <div style="font-size:12px;color:#6b7280;margin-top:8px">in accordance with the executed contract and approved scope of work</div>
      </div>

      <!-- PROJECT META -->
      <div style="display:flex;gap:16px;margin-bottom:20px">
        <div style="flex:1;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin-bottom:6px">Property Owner</div>
          <div style="font-size:14px;font-weight:600;color:#111827">${escape(data.customer.name || '—')}</div>
          ${data.customer.address ? `<div style="font-size:12px;color:#4b5563;margin-top:4px;white-space:pre-line">${escape(data.customer.address)}</div>` : ''}
        </div>
        <div style="flex:1;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin-bottom:6px">Completion Date</div>
          <div style="font-size:14px;font-weight:600;color:#111827">${escape(data.completionDate)}</div>
          ${typeof data.contractValue === 'number' && data.contractValue > 0 ? `
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin-top:10px">Contract Value</div>
            <div style="font-size:14px;font-weight:600;color:#111827">${fmt(data.contractValue)}</div>
          ` : ''}
        </div>
      </div>

      ${data.scopeOfWork ? `
      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin-bottom:20px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin-bottom:6px">Scope of Work</div>
        <div style="font-size:12px;color:#374151;line-height:1.6;white-space:pre-line">${escape(data.scopeOfWork)}</div>
      </div>` : ''}

      <!-- WARRANTY -->
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-left:4px solid #0a2540;border-radius:6px;padding:18px 20px;margin-bottom:24px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#0a2540;margin-bottom:10px">Workmanship Warranty</div>
        <div style="font-size:11.5px;color:#1f2937;line-height:1.65;white-space:pre-line">${escape(data.warrantyText)}</div>
      </div>

      <!-- SIGNATURES -->
      <div style="display:flex;gap:24px;margin-top:36px">
        <div style="flex:1">
          <div style="border-top:1.5px solid #1f2937;padding-top:6px;font-size:11px;color:#374151">
            <div style="font-weight:600">${escape(company.name || 'Contractor')}</div>
            <div style="font-size:10px;color:#6b7280;margin-top:2px">Authorized Representative</div>
            <div style="font-size:10px;color:#6b7280;margin-top:8px">Date: ${escape(data.completionDate)}</div>
          </div>
        </div>
        <div style="flex:1">
          <div style="border-top:1.5px solid #1f2937;padding-top:6px;font-size:11px;color:#374151">
            <div style="font-weight:600">${escape(data.customer.name || 'Property Owner')}</div>
            <div style="font-size:10px;color:#6b7280;margin-top:2px">Owner Acknowledgement</div>
            <div style="font-size:10px;color:#6b7280;margin-top:8px">Date: ____________________</div>
          </div>
        </div>
      </div>
    </div>

    <!-- FOOTER -->
    <div style="margin-top:24px;border-top:2px solid #0a2540;padding:12px 32px;display:flex;justify-content:space-between;font-size:10px;color:#6b7280">
      <div>${escape(company.name || '')}${company.phone ? ' • ' + escape(company.phone) : ''}${company.email ? ' • ' + escape(company.email) : ''}</div>
      <div>${escape(data.certificateNumber)}</div>
    </div>
  </div>`;
}

async function htmlToPdfBlob(html: string): Promise<Blob> {
  const container = document.createElement('div');
  container.innerHTML = html;
  container.style.cssText = `position:absolute;left:-9999px;top:0;width:780px;background:#fff;`;
  document.body.appendChild(container);
  try {
    const imgs = container.querySelectorAll('img');
    await Promise.all(
      Array.from(imgs).map(
        (img) =>
          new Promise<void>((resolve) => {
            if ((img as HTMLImageElement).complete) return resolve();
            img.onload = () => resolve();
            img.onerror = () => resolve();
          }),
      ),
    );
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: 780,
    });
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true });
    const pageWidth = 612;
    const pageHeight = 792;
    const imgData = canvas.toDataURL('image/jpeg', 0.85);
    const ratio = canvas.width / canvas.height;
    let renderWidth = pageWidth;
    let renderHeight = renderWidth / ratio;
    if (renderHeight > pageHeight) {
      renderHeight = pageHeight;
      renderWidth = renderHeight * ratio;
    }
    const offsetX = (pageWidth - renderWidth) / 2;
    const offsetY = (pageHeight - renderHeight) / 2;
    pdf.addImage(imgData, 'JPEG', offsetX, offsetY, renderWidth, renderHeight, undefined, 'FAST');
    return pdf.output('blob');
  } finally {
    document.body.removeChild(container);
  }
}

export interface CloseoutInput {
  tenantId: string;
  pipelineEntryId: string;
  userId: string;
  company: CompanyInfo | null | undefined;
  customer: {
    name?: string | null;
    address?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  contractTotal: number;
  totalPaid: number;
  paymentHistory: Array<{ date: string; amount: number; method?: string; reference?: string }>;
  scopeOfWork?: string;
  warrantyText?: string;
}

export interface CloseoutResult {
  invoiceDocumentId: string | null;
  certificateDocumentId: string | null;
  invoiceFilename: string;
  certificateFilename: string;
  invoicePath?: string;
  certificatePath?: string;
  error?: string;
}


export async function generateCloseoutDocuments(input: CloseoutInput): Promise<CloseoutResult> {
  const today = new Date();
  const dateStr = format(today, 'MMM d, yyyy');
  const stamp = format(today, 'yyyyMMdd-HHmmss');
  const invoiceNumber = `PIF-${stamp}`;
  const certificateNumber = `COC-${stamp}`;

  // ---------- PAID-IN-FULL INVOICE ----------
  const pifBlob = await generateInvoicePdfBlob({
    invoiceNumber,
    invoiceDate: dateStr,
    dueDate: dateStr,
    notes:
      'Final invoice — PAID IN FULL. Thank you for your business! This document confirms that all contract amounts have been received and the project is closed out.',
    lineItems: [
      {
        description: 'Contract — Paid in Full (Final Closeout)',
        qty: 1,
        unit: 'ea',
        unit_cost: input.contractTotal,
        line_total: input.contractTotal,
      },
    ],
    amount: 0, // balance due
    company: input.company,
    customer: input.customer,
    alreadyPaid: input.totalPaid || input.contractTotal,
    contractTotal: input.contractTotal,
    paymentHistory: input.paymentHistory,
  });

  const invoiceFilename = `Paid-In-Full-${invoiceNumber}.pdf`;
  const invoicePath = `${input.tenantId}/${input.pipelineEntryId}/closeout/${invoiceFilename}`;
  let invoiceDocumentId: string | null = null;
  {
    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(invoicePath, pifBlob, { contentType: 'application/pdf', upsert: true });
    if (upErr) {
      return {
        invoiceDocumentId: null,
        certificateDocumentId: null,
        invoiceFilename,
        certificateFilename: '',
        error: `Invoice upload failed: ${upErr.message}`,
      };
    }
    const { data: docRow, error: docErr } = await (supabase as any)
      .from('documents')
      .insert({
        tenant_id: input.tenantId,
        pipeline_entry_id: input.pipelineEntryId,
        document_type: 'invoice',
        filename: invoiceFilename,
        file_path: invoicePath,
        file_size: pifBlob.size,
        mime_type: 'application/pdf',
        description: `Paid-In-Full Invoice ${invoiceNumber}`,
        uploaded_by: input.userId,
      })
      .select('id')
      .single();
    if (docErr) {
      console.error('Invoice document insert failed', docErr);
    } else {
      invoiceDocumentId = docRow?.id || null;
    }
  }

  // ---------- COMPLETION CERTIFICATE ----------
  const certHtml = buildCompletionCertHtml({
    certificateNumber,
    completionDate: dateStr,
    company: input.company,
    customer: input.customer,
    scopeOfWork: input.scopeOfWork,
    contractValue: input.contractTotal,
    warrantyText: input.warrantyText || DEFAULT_WORKMANSHIP_WARRANTY,
  });
  const certBlob = await htmlToPdfBlob(certHtml);

  const certificateFilename = `Completion-Certificate-${certificateNumber}.pdf`;
  const certPath = `${input.tenantId}/${input.pipelineEntryId}/closeout/${certificateFilename}`;
  let certificateDocumentId: string | null = null;
  {
    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(certPath, certBlob, { contentType: 'application/pdf', upsert: true });
    if (upErr) {
      return {
        invoiceDocumentId,
        certificateDocumentId: null,
        invoiceFilename,
        certificateFilename,
        error: `Certificate upload failed: ${upErr.message}`,
      };
    }
    const { data: docRow, error: docErr } = await (supabase as any)
      .from('documents')
      .insert({
        tenant_id: input.tenantId,
        pipeline_entry_id: input.pipelineEntryId,
        document_type: 'completion_certificate',
        filename: certificateFilename,
        file_path: certPath,
        file_size: certBlob.size,
        mime_type: 'application/pdf',
        description: `Completion Certificate ${certificateNumber} — includes workmanship warranty`,
        uploaded_by: input.userId,
      })
      .select('id')
      .single();
    if (docErr) {
      console.error('Certificate document insert failed', docErr);
    } else {
      certificateDocumentId = docRow?.id || null;
    }
  }

  return {
    invoiceDocumentId,
    certificateDocumentId,
    invoiceFilename,
    certificateFilename,
    invoicePath,
    certificatePath: certPath,
  };
}


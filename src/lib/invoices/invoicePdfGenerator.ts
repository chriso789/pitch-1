import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { supabase } from '@/integrations/supabase/client';
import type { CompanyInfo } from '@/hooks/useCompanyInfo';

export interface InvoicePdfLineItem {
  description: string;
  qty: number;
  unit: string;
  unit_cost: number;
  line_total: number;
}

export interface InvoicePdfPayment {
  date: string;
  amount: number;
  method?: string;
  reference?: string;
}

export interface InvoicePdfData {
  invoiceNumber: string;
  invoiceDate: string; // formatted
  dueDate?: string | null; // formatted
  notes?: string | null;
  lineItems: InvoicePdfLineItem[];
  amount: number;
  company: CompanyInfo | null | undefined;
  customer: {
    name?: string | null;
    address?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  alreadyPaid?: number;
  contractTotal?: number;
  paymentHistory?: InvoicePdfPayment[];
}

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

function buildInvoiceHtml(data: InvoicePdfData): string {
  const company = data.company || {};
  const logo = company.logo_url
    ? `<img src="${escape(company.logo_url)}" crossorigin="anonymous" style="max-height:64px;max-width:200px;object-fit:contain"/>`
    : `<div style="font-size:22px;font-weight:700;color:#0a2540">${escape(company.name || 'INVOICE')}</div>`;

  const rows = data.lineItems
    .map(
      (item) => `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top">${escape(item.description)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap">${escape(item.qty)} ${escape(item.unit || '')}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap">${fmt(item.unit_cost)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap;font-weight:600">${fmt(item.line_total)}</td>
      </tr>`
    )
    .join('');

  // Derive original contract vs change orders from line items when possible.
  const changeOrderItems = data.lineItems.filter((li) => /change\s*order/i.test(li.description));
  const changeOrdersTotal = changeOrderItems.reduce((s, li) => s + (li.line_total || 0), 0);
  const contractTotal = typeof data.contractTotal === 'number' ? data.contractTotal : 0;
  const originalContract = contractTotal > 0 ? Math.max(0, contractTotal - changeOrdersTotal) : 0;
  const alreadyPaid = data.alreadyPaid || 0;
  const balanceDue = data.amount;

  // Pretty name for each change order (strip leading "Change Order —/-/:" prefix)
  const changeOrderName = (desc: string) =>
    desc.replace(/^\s*change\s*order\s*[—\-:]\s*/i, '').trim() || 'Change Order';


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
        <div style="font-size:32px;font-weight:700;letter-spacing:2px">INVOICE</div>
        <div style="font-size:13px;opacity:0.9;margin-top:4px">${escape(data.invoiceNumber)}</div>
      </div>
    </div>

    <!-- BALANCE SUMMARY (top, owner-facing) -->
    <div style="padding:24px 32px 8px">
      <div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <div style="background:#f9fafb;padding:12px 16px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;border-bottom:1px solid #e5e7eb">Balance Summary</div>
        <div style="padding:14px 16px">
          ${originalContract > 0 ? `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#374151"><span>Original Contract</span><span style="font-weight:600">${fmt(originalContract)}</span></div>` : ''}
          ${changeOrderItems.length > 0 ? `
            <div style="padding:6px 0 2px;font-size:13px;color:#374151;font-weight:600">+ Change Orders</div>
            ${changeOrderItems.map((li) => `
              <div style="display:flex;justify-content:space-between;padding:3px 0 3px 16px;font-size:12px;color:#4b5563">
                <span>${escape(changeOrderName(li.description))}</span>
                <span style="font-weight:600">${fmt(li.line_total)}</span>
              </div>`).join('')}
          ` : ''}
          ${contractTotal > 0 ? `<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:13px;color:#111827;border-top:1px solid #e5e7eb;margin-top:4px"><span style="font-weight:600">Total Contract</span><span style="font-weight:700">${fmt(contractTotal)}</span></div>` : ''}
          ${alreadyPaid > 0 ? `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#047857"><span>− Payments Received</span><span style="font-weight:600">${fmt(alreadyPaid)}</span></div>` : ''}

          <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;margin:10px -16px -14px;background:#0a2540;color:#ffffff;border-radius:0 0 8px 8px">
            <span style="font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase">Balance Due</span>
            <span style="font-size:24px;font-weight:700">${fmt(balanceDue)}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- META + BILL TO -->
    <div style="padding:16px 32px 8px;display:flex;justify-content:space-between;gap:24px">
      <div style="flex:1">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin-bottom:8px">Bill To</div>
        <div style="font-size:14px;font-weight:600;color:#111827">${escape(data.customer.name || '—')}</div>
        ${data.customer.address ? `<div style="font-size:12px;color:#4b5563;margin-top:2px;white-space:pre-line">${escape(data.customer.address)}</div>` : ''}
        ${data.customer.email ? `<div style="font-size:12px;color:#4b5563;margin-top:2px">${escape(data.customer.email)}</div>` : ''}
        ${data.customer.phone ? `<div style="font-size:12px;color:#4b5563;margin-top:2px">${escape(data.customer.phone)}</div>` : ''}
      </div>
      <div style="text-align:right;min-width:220px">
        <div style="display:flex;justify-content:space-between;gap:24px;font-size:12px;margin-bottom:6px"><span style="color:#6b7280">Invoice Date:</span><span style="font-weight:600">${escape(data.invoiceDate)}</span></div>
        ${data.dueDate ? `<div style="display:flex;justify-content:space-between;gap:24px;font-size:12px;margin-bottom:6px"><span style="color:#6b7280">Due Date:</span><span style="font-weight:600">${escape(data.dueDate)}</span></div>` : ''}
      </div>
    </div>

    <!-- LINE ITEMS -->
    <div style="padding:0 32px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin:8px 0">This Invoice</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#f9fafb">
            <th style="padding:10px 8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;border-bottom:2px solid #0a2540">Description</th>
            <th style="padding:10px 8px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;border-bottom:2px solid #0a2540;white-space:nowrap">Qty</th>
            <th style="padding:10px 8px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;border-bottom:2px solid #0a2540;white-space:nowrap">Unit Price</th>
            <th style="padding:10px 8px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;border-bottom:2px solid #0a2540;white-space:nowrap">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <!-- TOTALS -->
      <div style="display:flex;justify-content:flex-end;margin-top:12px">
        <div style="min-width:260px">
          <div style="display:flex;justify-content:space-between;padding:8px;font-size:13px;font-weight:700;color:#111827;border-top:2px solid #0a2540"><span>Invoice Total</span><span>${fmt(data.amount)}</span></div>
        </div>
      </div>


      ${data.paymentHistory && data.paymentHistory.length > 0 ? `
      <div style="margin-top:24px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin-bottom:8px">Payment History</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:#f9fafb">
              <th style="padding:8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;border-bottom:1px solid #e5e7eb">Date</th>
              <th style="padding:8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;border-bottom:1px solid #e5e7eb">Method</th>
              <th style="padding:8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;border-bottom:1px solid #e5e7eb">Reference</th>
              <th style="padding:8px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;border-bottom:1px solid #e5e7eb">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${data.paymentHistory.map(p => `
              <tr>
                <td style="padding:8px;border-bottom:1px solid #f3f4f6">${escape(p.date)}</td>
                <td style="padding:8px;border-bottom:1px solid #f3f4f6;text-transform:capitalize">${escape((p.method || '').replace(/_/g, ' '))}</td>
                <td style="padding:8px;border-bottom:1px solid #f3f4f6;color:#6b7280">${escape(p.reference || '')}</td>
                <td style="padding:8px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600;color:#047857">${fmt(p.amount)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>` : ''}

      ${data.notes ? `
      <div style="margin-top:24px;padding:14px 16px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:4px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#92400e;margin-bottom:4px">Notes</div>
        <div style="font-size:12px;color:#451a03;white-space:pre-line">${escape(data.notes)}</div>
      </div>` : ''}

      <div style="margin-top:32px;padding:18px;background:#f9fafb;border-radius:6px;text-align:center">
        <div style="font-size:13px;font-weight:600;color:#111827">Thank you for your business!</div>
        <div style="font-size:11px;color:#6b7280;margin-top:4px">Please remit payment by the due date noted above.</div>
      </div>
    </div>

    <!-- FOOTER -->
    <div style="margin-top:32px;border-top:2px solid #0a2540;padding:14px 32px;display:flex;justify-content:space-between;font-size:10px;color:#6b7280">
      <div>${escape(company.name || '')}${company.phone ? ' • ' + escape(company.phone) : ''}${company.email ? ' • ' + escape(company.email) : ''}</div>
      <div>Invoice ${escape(data.invoiceNumber)}</div>
    </div>
  </div>`;
}

export async function generateInvoicePdfBlob(data: InvoicePdfData): Promise<Blob> {
  const container = document.createElement('div');
  container.innerHTML = buildInvoiceHtml(data);
  container.style.cssText = `position:absolute;left:-9999px;top:0;width:780px;background:#fff;`;
  document.body.appendChild(container);

  try {
    // Wait for images
    const imgs = container.querySelectorAll('img');
    await Promise.all(
      Array.from(imgs).map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) return resolve();
            img.onload = () => resolve();
            img.onerror = () => resolve();
          })
      )
    );
    const canvas = await html2canvas(container, {
      scale: 3,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: 780,
    });

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true });
    const pageWidth = 612;
    const pageHeight = 792;
    // PNG keeps text crisp; jsPDF still compresses it.
    const imgData = canvas.toDataURL('image/png');
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 0;
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position -= pageHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
      heightLeft -= pageHeight;
    }



    return pdf.output('blob');
  } finally {
    document.body.removeChild(container);
  }
}

/**
 * Generates the invoice PDF, uploads to the documents bucket, and creates a documents row.
 * Storage path follows tenant-first RLS: {tenant_id}/{pipeline_entry_id}/invoices/{invoice_number}.pdf
 */
export async function generateAndSaveInvoicePdf(opts: {
  data: InvoicePdfData;
  tenantId: string;
  pipelineEntryId: string;
  userId: string;
}): Promise<{ filePath: string | null; error?: string }> {
  try {
    const blob = await generateInvoicePdfBlob(opts.data);
    const safeNumber = opts.data.invoiceNumber.replace(/[^A-Za-z0-9_-]/g, '_');
    const filePath = `${opts.tenantId}/${opts.pipelineEntryId}/invoices/${safeNumber}.pdf`;

    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(filePath, blob, { contentType: 'application/pdf', upsert: true });
    if (upErr) {
      console.error('Invoice PDF upload failed:', upErr);
      return { filePath: null, error: upErr.message };
    }

    const { error: docErr } = await (supabase as any).from('documents').insert({
      tenant_id: opts.tenantId,
      pipeline_entry_id: opts.pipelineEntryId,
      document_type: 'invoice',
      filename: `${safeNumber}.pdf`,
      file_path: filePath,
      file_size: blob.size,
      mime_type: 'application/pdf',
      description: `Invoice ${opts.data.invoiceNumber}`,
      uploaded_by: opts.userId,
    });
    if (docErr) {
      console.error('Invoice document record failed:', docErr);
      return { filePath, error: docErr.message };
    }

    return { filePath };
  } catch (err: any) {
    console.error('generateAndSaveInvoicePdf failed:', err);
    return { filePath: null, error: err?.message || 'Unknown error' };
  }
}

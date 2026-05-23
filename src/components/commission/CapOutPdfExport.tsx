import { supabase } from '@/integrations/supabase/client';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value);

export interface CapOutPdfData {
  projectName: string;
  customerName: string;
  address: string;
  repName: string;
  date: string;
  sellPrice: number;
  materialsCost: number;
  laborCost: number;
  overheadAmount: number;
  otherCharges: number;
  commissionAmount: number;
  miscCost: number;
  totalCost: number;
  profit: number;
  marginPct: number;
  commissionRate: number;
  commissionType: string;
  // Company branding
  companyName?: string | null;
  companyLogoUrl?: string | null;
  companyPhone?: string | null;
  companyAddress?: string | null;
  companyEmail?: string | null;
  companyWebsite?: string | null;
  companyLicense?: string | null;
  brandPrimaryColor?: string | null;
  // Location branding
  locationName?: string | null;
  locationAddress?: string | null;
  locationPhone?: string | null;
  locationEmail?: string | null;
  repEmail?: string | null;
}

export function buildCapOutHtml(data: CapOutPdfData): string {
  const brandColor = data.brandPrimaryColor || '#2563eb';
  const companyName = data.companyName || 'Company';
  const logoBlock = data.companyLogoUrl
    ? `<img src="${data.companyLogoUrl}" alt="${companyName} logo" style="height:auto;width:auto;max-height:64px;max-width:180px;object-fit:contain;display:block;" />`
    : `<div style="font-size:24px;font-weight:800;color:${brandColor};letter-spacing:-0.01em;">${companyName}</div>`;

  const companyTagParts = [data.companyLicense ? `Lic. ${data.companyLicense}` : null, data.companyWebsite].filter(Boolean);
  const companyTag = companyTagParts.length
    ? `<div style="font-size:10px;color:#64748b;margin-top:2px;">${companyTagParts.join(' · ')}</div>`
    : '';

  const locationLine = data.locationName
    ? `<div style="font-size:12px;font-weight:600;color:#1a1a1a;">${data.locationName}</div>`
    : '';
  const locationAddr = data.locationAddress
    ? `<div style="font-size:11px;color:#475569;line-height:1.4;">${data.locationAddress}</div>`
    : (data.companyAddress ? `<div style="font-size:11px;color:#475569;line-height:1.4;">${data.companyAddress}</div>` : '');
  const contactLine = [data.locationPhone || data.companyPhone, data.locationEmail || data.companyEmail].filter(Boolean).join(' · ');
  const contactBlock = contactLine
    ? `<div style="font-size:11px;color:#475569;line-height:1.4;">${contactLine}</div>`
    : '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Cap Out Sheet - ${data.projectName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; padding: 24px 32px; color: #1a1a1a; background: #fff; }
    .brand-bar { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 14px; border-bottom: 3px solid ${brandColor}; margin-bottom: 16px; }
    .brand-left { display: flex; flex-direction: column; gap: 4px; }
    .brand-right { text-align: right; }
    .header { text-align: center; padding-bottom: 8px; margin-bottom: 14px; }
    .header h1 { font-size: 22px; color: ${brandColor}; margin-bottom: 2px; letter-spacing: 0.05em; }
    .header p { color: #666; font-size: 11px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; margin-bottom: 12px; }
    .info-label { font-size: 9px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
    .info-value { font-size: 13px; font-weight: 600; margin-top: 1px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    th { background: #f1f5f9; text-align: left; padding: 5px 8px; font-size: 10px; text-transform: uppercase; color: #64748b; border-bottom: 2px solid #e2e8f0; }
    td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; font-size: 12px; }
    td.amount { text-align: right; font-family: 'Courier New', monospace; }
    tr.total { background: #f8fafc; font-weight: 700; }
    tr.total td { border-top: 2px solid ${brandColor}; border-bottom: 2px solid ${brandColor}; font-size: 13px; }
    .profit-section { background: #f0fdf4; border: 2px solid #22c55e; border-radius: 6px; padding: 10px 14px; margin-bottom: 10px; }
    .profit-section.negative { background: #fef2f2; border-color: #ef4444; }
    .profit-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
    .profit-row:last-child { margin-bottom: 0; }
    .profit-label { font-size: 12px; color: #555; }
    .profit-value { font-size: 16px; font-weight: 700; color: #16a34a; }
    .profit-value.negative { color: #dc2626; }
    .commission-section { background: #eff6ff; border: 2px solid #3b82f6; border-radius: 6px; padding: 10px 14px; margin-bottom: 10px; }
    .signature-section { margin-top: 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 48px; }
    .sig-line { border-top: 1px solid #333; padding-top: 4px; font-size: 10px; color: #666; }
    .footer { margin-top: 16px; text-align: center; color: #aaa; font-size: 9px; }
    @media print { body { padding: 16px 24px; } @page { size: letter; margin: 0.4in; } }
  </style>
</head>
<body>
  <div class="brand-bar">
    <div class="brand-left">
      ${logoBlock}
      ${companyTag}
    </div>
    <div class="brand-right">
      <div style="font-size:14px;font-weight:700;color:#1a1a1a;">${companyName}</div>
      ${locationLine}
      ${locationAddr}
      ${contactBlock}
    </div>
  </div>

  <div class="header">
    <h1>CAP OUT SHEET</h1>
    <p>Job Financial Summary</p>
  </div>

  <div class="info-grid">
    <div class="info-item">
      <div class="info-label">Project</div>
      <div class="info-value">${data.projectName}</div>
    </div>
    <div class="info-item">
      <div class="info-label">Date</div>
      <div class="info-value">${data.date}</div>
    </div>
    <div class="info-item">
      <div class="info-label">Customer</div>
      <div class="info-value">${data.customerName}</div>
    </div>
    <div class="info-item">
      <div class="info-label">Sales Rep</div>
      <div class="info-value">${data.repName}</div>
    </div>
    <div class="info-item" style="grid-column: span 2;">
      <div class="info-label">Property Address</div>
      <div class="info-value">${data.address}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th style="text-align: right;">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Contract / Selling Price</strong></td>
        <td class="amount"><strong>${formatCurrency(data.sellPrice)}</strong></td>
      </tr>
      <tr><td colspan="2" style="background:#f1f5f9; font-weight:600; font-size:12px; text-transform:uppercase; color:#64748b;">Costs</td></tr>
      <tr>
        <td>Materials</td>
        <td class="amount">${formatCurrency(data.materialsCost)}</td>
      </tr>
      <tr>
        <td>Labor</td>
        <td class="amount">${formatCurrency(data.laborCost)}</td>
      </tr>
      <tr>
        <td>Overhead</td>
        <td class="amount">${formatCurrency(data.overheadAmount)}</td>
      </tr>
      ${data.otherCharges > 0 ? `<tr><td>Other Charges</td><td class="amount">${formatCurrency(data.otherCharges)}</td></tr>` : ''}
      ${data.miscCost > 0 ? `<tr><td>Misc</td><td class="amount">${formatCurrency(data.miscCost)}</td></tr>` : ''}
      <tr class="total">
        <td>Total Cost</td>
        <td class="amount">${formatCurrency(data.totalCost)}</td>
      </tr>
    </tbody>
  </table>

  <div class="profit-section ${data.profit < 0 ? 'negative' : ''}">
    <div class="profit-row">
      <span class="profit-label">Gross Profit</span>
      <span class="profit-value ${data.profit < 0 ? 'negative' : ''}">${formatCurrency(data.profit)}</span>
    </div>
    <div class="profit-row">
      <span class="profit-label">Profit Margin</span>
      <span class="profit-value ${data.profit < 0 ? 'negative' : ''}">${data.marginPct.toFixed(1)}%</span>
    </div>
  </div>

  <div class="commission-section">
    <div class="profit-row">
      <span class="profit-label">Commission Plan</span>
      <span style="font-weight:600;">${data.commissionType === 'profit_split' ? 'Profit Split' : '% of Selling Price'} @ ${data.commissionRate}%</span>
    </div>
    <div class="profit-row">
      <span class="profit-label">Commission Amount</span>
      <span class="profit-value" style="color:${brandColor};">${formatCurrency(data.commissionAmount)}</span>
    </div>
  </div>

  <div class="signature-section">
    <div>
      <div class="sig-line">Manager Signature / Date</div>
    </div>
    <div>
      <div class="sig-line">Sales Rep Signature / Date</div>
    </div>
  </div>

  <div class="footer">
    Generated ${new Date().toLocaleDateString()} — ${data.companyName || 'Company'}
  </div>
</body>
</html>`;
}

export function generateCapOutPdf(data: CapOutPdfData) {
  const html = buildCapOutHtml(data);
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.print();
    };
  }
}

/**
 * Render the cap out sheet HTML into a PDF Blob using html2canvas + jsPDF.
 * Used for email attachments so the recipient gets the same visual output.
 */
export async function generateCapOutPdfBlob(data: CapOutPdfData): Promise<Blob> {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const html = buildCapOutHtml(data);
  const container = document.createElement('div');
  container.innerHTML = html;
  // Force a known render width so html2canvas produces consistent pages
  container.style.cssText = 'position:absolute;left:-10000px;top:0;width:816px;background:#ffffff;';
  document.body.appendChild(container);

  try {
    // Wait for images (e.g., company logo) to load
    const imgs = Array.from(container.querySelectorAll('img'));
    await Promise.all(
      imgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.onload = () => resolve();
              img.onerror = () => resolve();
            })
      )
    );

    const canvas = await html2canvas(container, {
      scale: 1.5,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    });

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    const pageWidth = 612;
    const pageHeight = 792;
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    const imgData = canvas.toDataURL('image/jpeg', 0.7);
    let heightLeft = imgHeight;
    let position = 0;
    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    return pdf.output('blob');
  } finally {
    document.body.removeChild(container);
  }
}

// Fetch only the branding/customer/rep context for a job. Financial numbers are
// passed in by the caller so the sheet matches the Commission Report row exactly
// (enhanced_estimates + invoiced actuals + change orders + sales-tax-excluded math).
async function fetchCapOutContext(pipelineEntryId: string) {
  const { data: entry } = await supabase
    .from('pipeline_entries')
    .select(`
      id, lead_name, estimated_value, assigned_to, tenant_id, location_id,
      contacts!pipeline_entries_contact_id_fkey(first_name, last_name, address_street, address_city, address_state, address_zip)
    `)
    .eq('id', pipelineEntryId)
    .single();

  if (!entry) throw new Error('Job not found');

  let repName = 'N/A';
  let repEmail: string | null = null;
  let commissionRate = 0;
  let commissionType = 'profit_split';
  if (entry.assigned_to) {
    const { data: rep } = await supabase
      .from('profiles')
      .select('first_name, last_name, email, commission_rate, commission_structure')
      .eq('id', entry.assigned_to)
      .single();
    if (rep) {
      repName = `${rep.first_name || ''} ${rep.last_name || ''}`.trim();
      repEmail = (rep as any).email || null;
      commissionRate = Number(rep.commission_rate || 0);
      commissionType = rep.commission_structure || 'profit_split';
    }
  }

  let companyName: string | null = null;
  let companyLogoUrl: string | null = null;
  let companyPhone: string | null = null;
  let companyAddress: string | null = null;
  let companyEmail: string | null = null;
  let companyWebsite: string | null = null;
  let companyLicense: string | null = null;
  let brandPrimaryColor: string | null = null;
  const tenantId = (entry as any).tenant_id;
  if (tenantId) {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('name, logo_url, phone, email, website, license_number, address_street, address_city, address_state, address_zip, brand_primary_color, primary_color')
      .eq('id', tenantId)
      .maybeSingle();
    if (tenant) {
      companyName = tenant.name;
      companyLogoUrl = tenant.logo_url;
      companyPhone = tenant.phone;
      companyEmail = tenant.email;
      companyWebsite = (tenant as any).website || null;
      companyLicense = (tenant as any).license_number || null;
      brandPrimaryColor = (tenant as any).brand_primary_color || (tenant as any).primary_color || null;
      const parts = [tenant.address_street, tenant.address_city, tenant.address_state, tenant.address_zip].filter(Boolean);
      companyAddress = parts.length ? parts.join(', ') : null;
    }
  }

  let locationName: string | null = null;
  let locationAddress: string | null = null;
  let locationPhone: string | null = null;
  let locationEmail: string | null = null;
  const locationId = (entry as any).location_id;
  if (locationId) {
    const { data: location } = await supabase
      .from('locations')
      .select('name, address_street, address_city, address_state, address_zip, phone, email, formatted_address')
      .eq('id', locationId)
      .maybeSingle();
    if (location) {
      locationName = location.name;
      locationPhone = location.phone;
      locationEmail = location.email;
      const parts = [location.address_street, location.address_city, location.address_state, location.address_zip].filter(Boolean);
      locationAddress = location.formatted_address || (parts.length ? parts.join(', ') : null);
    }
  }

  const contact = entry.contacts as any;
  const customerName = contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : '';
  const address = contact
    ? [contact.address_street, contact.address_city, contact.address_state, contact.address_zip].filter(Boolean).join(', ')
    : '';

  return {
    entry,
    projectName: entry.lead_name || customerName || 'N/A',
    customerName,
    address,
    repName,
    repEmail,
    commissionRate,
    commissionType,
    companyName, companyLogoUrl, companyPhone, companyAddress, companyEmail,
    companyWebsite, companyLicense, brandPrimaryColor,
    locationName, locationAddress, locationPhone, locationEmail,
  };
}

export interface CapOutFinancials {
  contractValue: number;
  materialCost: number;
  laborCost: number;
  overheadAmount: number;
  otherCharges?: number;
  grossProfit: number;
  commissionAmount: number;
  commissionRate?: number;
  commissionType?: string;
  repName?: string;
}

/**
 * Build cap out data using EXACT numbers from the Commission Report row, so the
 * printed/preview sheet shows the same materials/labor/overhead/profit/commission
 * the user sees in the table (no separate, divergent recomputation).
 */
export async function buildCapOutDataFromCommission(
  pipelineEntryId: string,
  fin: CapOutFinancials,
): Promise<CapOutPdfData> {
  const { entry: _e, ...ctx } = await fetchCapOutContext(pipelineEntryId);
  const otherCharges = Number(fin.otherCharges || 0);
  const totalCost = fin.materialCost + fin.laborCost + fin.overheadAmount + otherCharges;
  const marginPct = fin.contractValue > 0 ? (fin.grossProfit / fin.contractValue) * 100 : 0;
  return {
    ...ctx,
    repName: fin.repName || ctx.repName,
    date: new Date().toLocaleDateString(),
    sellPrice: fin.contractValue,
    materialsCost: fin.materialCost,
    laborCost: fin.laborCost,
    overheadAmount: fin.overheadAmount,
    otherCharges,
    commissionAmount: fin.commissionAmount,
    miscCost: 0,
    totalCost,
    profit: fin.grossProfit,
    marginPct,
    commissionRate: fin.commissionRate ?? ctx.commissionRate,
    commissionType: fin.commissionType ?? ctx.commissionType,
  };
}

/** Fallback path when no precomputed commission row is available. */
export async function buildCapOutDataForJob(pipelineEntryId: string): Promise<CapOutPdfData> {
  const ctx = await fetchCapOutContext(pipelineEntryId);
  const { entry } = ctx;

  const { data: estimate } = await supabase
    .from('enhanced_estimates')
    .select('selling_price, material_cost, labor_cost, overhead_amount')
    .eq('pipeline_entry_id', pipelineEntryId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const sellPrice = Number(estimate?.selling_price || (entry as any).estimated_value || 0);
  const materialsCost = Number(estimate?.material_cost || 0);
  const laborCost = Number(estimate?.labor_cost || 0);
  const overheadAmount = Number(estimate?.overhead_amount || 0);
  const totalCost = materialsCost + laborCost + overheadAmount;
  const profit = sellPrice - totalCost;
  const marginPct = sellPrice > 0 ? (profit / sellPrice) * 100 : 0;

  let commissionAmount = 0;
  if (ctx.commissionType === 'percentage_contract_price' || ctx.commissionType === 'percentage_selling_price') {
    commissionAmount = sellPrice * (ctx.commissionRate / 100);
  } else {
    commissionAmount = Math.max(0, profit * (ctx.commissionRate / 100));
  }

  const { entry: _drop, ...rest } = ctx;
  return {
    ...rest,
    date: new Date().toLocaleDateString(),
    sellPrice,
    materialsCost,
    laborCost,
    overheadAmount,
    otherCharges: 0,
    commissionAmount,
    miscCost: 0,
    totalCost,
    profit,
    marginPct,
  };
}

export async function exportCapOutForJob(pipelineEntryId: string, fin?: CapOutFinancials) {
  const data = fin
    ? await buildCapOutDataFromCommission(pipelineEntryId, fin)
    : await buildCapOutDataForJob(pipelineEntryId);
  generateCapOutPdf(data);
}


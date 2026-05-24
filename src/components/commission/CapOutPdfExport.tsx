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
    ? `<img src="${data.companyLogoUrl}" alt="${companyName} logo" crossorigin="anonymous" />`
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
    html, body { width: 816px; }
    body { font-family: Arial, Helvetica, sans-serif; padding: 24px 32px; color: #1a1a1a; background: #fff; overflow-wrap: anywhere; word-break: break-word; }
    .brand-bar { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 12px; border-bottom: 3px solid ${brandColor}; margin-bottom: 16px; width: 100%; }
    .brand-left { display: flex; flex-direction: column; gap: 4px; flex: 0 0 220px; max-width: 220px; min-width: 0; }
    .brand-left img { display: block; height: auto; width: auto; max-height: 64px; max-width: 100%; object-fit: contain; }
    .brand-right { text-align: right; flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
    .header { text-align: center; padding-bottom: 8px; margin-bottom: 14px; }
    .header h1 { font-size: 22px; color: ${brandColor}; margin-bottom: 2px; letter-spacing: 0.05em; }
    .header p { color: #666; font-size: 11px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; margin-bottom: 12px; }
    .info-label { font-size: 9px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
    .info-value { font-size: 13px; font-weight: 600; margin-top: 1px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; table-layout: fixed; }
    th { background: #f1f5f9; text-align: left; padding: 5px 8px; font-size: 10px; text-transform: uppercase; color: #64748b; border-bottom: 2px solid #e2e8f0; }
    td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; font-size: 12px; word-break: break-word; }
    td.amount { text-align: right; font-family: 'Courier New', monospace; white-space: nowrap; }
    tr.total { background: #f8fafc; font-weight: 700; }
    tr.total td { border-top: 2px solid ${brandColor}; border-bottom: 2px solid ${brandColor}; font-size: 13px; }
    .profit-section { background: #f0fdf4; border: 2px solid #22c55e; border-radius: 6px; padding: 10px 14px; margin-bottom: 10px; }
    .profit-section.negative { background: #fef2f2; border-color: #ef4444; }
    .profit-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; gap: 12px; }
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

const normalizeHexColor = (value?: string | null) => {
  const color = (value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    return `#${color.slice(1).split('').map((c) => c + c).join('')}`;
  }
  return '#2563eb';
};

const hexToRgb = (hex: string): [number, number, number] => {
  const normalized = normalizeHexColor(hex).slice(1);
  return [0, 2, 4].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16)) as [number, number, number];
};

const loadImageForPdf = (src?: string | null) => new Promise<{ dataUrl: string; width: number; height: number } | null>((resolve) => {
  if (!src) return resolve(null);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx || !canvas.width || !canvas.height) return resolve(null);
      ctx.drawImage(img, 0, 0);
      resolve({ dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height });
    } catch {
      resolve(null);
    }
  };
  img.onerror = () => resolve(null);
  img.src = src;
});

/**
 * Render the cap out sheet as a true PDF Blob for email attachments.
 * This avoids stretched/blurry html2canvas raster output in email clients.
 */
export async function generateCapOutPdfBlob(data: CapOutPdfData): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const pageWidth = 612;
  const margin = 42;
  const contentWidth = pageWidth - margin * 2;
  const brandColor = normalizeHexColor(data.brandPrimaryColor);
  const [brandR, brandG, brandB] = hexToRgb(brandColor);
  const logo = await loadImageForPdf(data.companyLogoUrl);
  let y = 36;

  if (logo) {
    const logoHeight = 54;
    const logoWidth = Math.min(150, (logo.width / logo.height) * logoHeight);
    pdf.addImage(logo.dataUrl, 'PNG', margin, y, logoWidth, logoHeight, undefined, 'FAST');
  } else {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(18);
    pdf.setTextColor(brandR, brandG, brandB);
    pdf.text(data.companyName || 'Company', margin, y + 26, { maxWidth: 180 });
  }

  pdf.setTextColor(26, 26, 26);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.text(data.companyName || 'Company', pageWidth - margin, y + 12, { align: 'right', maxWidth: 220 });
  if (data.locationName) {
    pdf.setFontSize(11);
    pdf.text(data.locationName, pageWidth - margin, y + 27, { align: 'right', maxWidth: 220 });
  }
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  pdf.setTextColor(71, 85, 105);
  const address = data.locationAddress || data.companyAddress || '';
  if (address) pdf.text(address, pageWidth - margin, y + 43, { align: 'right', maxWidth: 260 });
  const contact = [data.locationPhone || data.companyPhone, data.locationEmail || data.companyEmail].filter(Boolean).join(' · ');
  if (contact) pdf.text(contact, pageWidth - margin, y + 57, { align: 'right', maxWidth: 260 });

  const companyTag = [data.companyLicense ? `Lic. ${data.companyLicense}` : null, data.companyWebsite].filter(Boolean).join(' · ');
  if (companyTag) pdf.text(companyTag, margin, y + 78, { maxWidth: 220 });
  y += 90;
  pdf.setDrawColor(brandR, brandG, brandB);
  pdf.setLineWidth(2);
  pdf.line(margin, y, pageWidth - margin, y);

  y += 34;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(24);
  pdf.setTextColor(brandR, brandG, brandB);
  pdf.text('CAP OUT SHEET', pageWidth / 2, y, { align: 'center' });
  y += 15;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11);
  pdf.setTextColor(90, 90, 90);
  pdf.text('Job Financial Summary', pageWidth / 2, y, { align: 'center' });

  const drawLabelValue = (label: string, value: string, x: number, valueMaxWidth = 210) => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(136, 136, 136);
    pdf.text(label.toUpperCase(), x, y);
    pdf.setFontSize(12);
    pdf.setTextColor(26, 26, 26);
    const lines = pdf.splitTextToSize(value || 'N/A', valueMaxWidth);
    pdf.text(lines, x, y + 15);
    return lines.length;
  };

  y += 46;
  drawLabelValue('Project', data.projectName, margin);
  drawLabelValue('Date', data.date, margin + contentWidth / 2);
  y += 42;
  drawLabelValue('Customer', data.customerName, margin);
  drawLabelValue('Sales Rep', data.repName, margin + contentWidth / 2);
  y += 42;
  const addressLines = drawLabelValue('Property Address', data.address, margin, contentWidth);
  y += 24 + Math.max(1, addressLines - 1) * 12;

  const amountX = pageWidth - margin - 8;
  const row = (label: string, amount: string, options: { bold?: boolean; header?: boolean; total?: boolean } = {}) => {
    if (options.header) {
      pdf.setFillColor(241, 245, 249);
      pdf.rect(margin, y, contentWidth, 24, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10);
      pdf.setTextColor(100, 116, 139);
      pdf.text(label.toUpperCase(), margin + 8, y + 16);
      y += 24;
      return;
    }
    if (options.total) {
      pdf.setFillColor(248, 250, 252);
      pdf.rect(margin, y, contentWidth, 28, 'F');
      pdf.setDrawColor(brandR, brandG, brandB);
      pdf.line(margin, y, pageWidth - margin, y);
      pdf.line(margin, y + 28, pageWidth - margin, y + 28);
    } else {
      pdf.setDrawColor(226, 232, 240);
      pdf.line(margin, y + 26, pageWidth - margin, y + 26);
    }
    pdf.setFont('helvetica', options.bold || options.total ? 'bold' : 'normal');
    pdf.setFontSize(options.total ? 12 : 11);
    pdf.setTextColor(26, 26, 26);
    pdf.text(label, margin + 8, y + 17);
    pdf.setFont('courier', options.bold || options.total ? 'bold' : 'normal');
    pdf.text(amount, amountX, y + 17, { align: 'right' });
    y += options.total ? 28 : 26;
  };

  row('Description', 'Amount', { header: true });
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(100, 116, 139);
  pdf.text('AMOUNT', amountX, y - 8, { align: 'right' });
  row('Contract / Selling Price', formatCurrency(data.sellPrice), { bold: true });
  row('Costs', '', { header: true });
  row('Materials', formatCurrency(data.materialsCost));
  row('Labor', formatCurrency(data.laborCost));
  row('Overhead', formatCurrency(data.overheadAmount));
  if (data.otherCharges > 0) row('Other Charges', formatCurrency(data.otherCharges));
  if (data.miscCost > 0) row('Misc', formatCurrency(data.miscCost));
  row('Total Cost', formatCurrency(data.totalCost), { total: true });

  y += 18;
  const profitGreen = data.profit < 0 ? [239, 68, 68] : [34, 197, 94];
  pdf.setFillColor(data.profit < 0 ? 254 : 240, data.profit < 0 ? 242 : 253, data.profit < 0 ? 242 : 244);
  pdf.setDrawColor(profitGreen[0], profitGreen[1], profitGreen[2]);
  pdf.roundedRect(margin, y, contentWidth, 62, 4, 4, 'FD');
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(12);
  pdf.setTextColor(85, 85, 85);
  pdf.text('Gross Profit', margin + 14, y + 26);
  pdf.text('Profit Margin', margin + 14, y + 48);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(17);
  pdf.setTextColor(profitGreen[0], profitGreen[1], profitGreen[2]);
  pdf.text(formatCurrency(data.profit), amountX - 8, y + 26, { align: 'right' });
  pdf.text(`${data.marginPct.toFixed(1)}%`, amountX - 8, y + 48, { align: 'right' });

  y += 82;
  pdf.setFillColor(239, 246, 255);
  pdf.setDrawColor(59, 130, 246);
  pdf.roundedRect(margin, y, contentWidth, 62, 4, 4, 'FD');
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(12);
  pdf.setTextColor(85, 85, 85);
  pdf.text('Commission Plan', margin + 14, y + 26);
  pdf.text('Commission Amount', margin + 14, y + 48);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(26, 26, 26);
  pdf.text(`${data.commissionType === 'profit_split' ? 'Profit Split' : '% of Selling Price'} @ ${data.commissionRate}%`, amountX - 8, y + 26, { align: 'right', maxWidth: 260 });
  pdf.setFontSize(17);
  pdf.setTextColor(brandR, brandG, brandB);
  pdf.text(formatCurrency(data.commissionAmount), amountX - 8, y + 50, { align: 'right' });

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(160, 160, 160);
  pdf.text(`Generated ${new Date().toLocaleDateString()} — ${data.companyName || 'Company'}`, pageWidth / 2, 760, { align: 'center' });
  return pdf.output('blob');
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


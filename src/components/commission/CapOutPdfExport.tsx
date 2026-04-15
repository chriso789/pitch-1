import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value);

interface CapOutPdfData {
  projectName: string;
  customerName: string;
  address: string;
  repName: string;
  date: string;
  sellPrice: number;
  materialsCost: number;
  laborCost: number;
  overheadAmount: number;
  commissionAmount: number;
  miscCost: number;
  totalCost: number;
  profit: number;
  marginPct: number;
  commissionRate: number;
  commissionType: string;
}

export function generateCapOutPdf(data: CapOutPdfData) {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Cap Out Sheet - ${data.projectName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; padding: 24px 32px; color: #1a1a1a; }
    .header { text-align: center; border-bottom: 2px solid #2563eb; padding-bottom: 8px; margin-bottom: 12px; }
    .header h1 { font-size: 22px; color: #2563eb; margin-bottom: 2px; }
    .header p { color: #666; font-size: 11px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; margin-bottom: 12px; }
    .info-label { font-size: 9px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
    .info-value { font-size: 13px; font-weight: 600; margin-top: 1px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    th { background: #f1f5f9; text-align: left; padding: 5px 8px; font-size: 10px; text-transform: uppercase; color: #64748b; border-bottom: 2px solid #e2e8f0; }
    td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; font-size: 12px; }
    td.amount { text-align: right; font-family: 'Courier New', monospace; }
    tr.total { background: #f8fafc; font-weight: 700; }
    tr.total td { border-top: 2px solid #2563eb; border-bottom: 2px solid #2563eb; font-size: 13px; }
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
      <span class="profit-value" style="color:#2563eb;">${formatCurrency(data.commissionAmount)}</span>
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
    Generated ${new Date().toLocaleDateString()} — PITCH CRM
  </div>
</body>
</html>`;

  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.print();
    };
  }
}

export async function exportCapOutForJob(pipelineEntryId: string) {
  // Get pipeline entry with contact and rep info
  const { data: entry } = await supabase
    .from('pipeline_entries')
    .select(`
      id, lead_name, estimated_value, assigned_to, status,
      contacts!pipeline_entries_contact_id_fkey(first_name, last_name, address_street, address_city, address_state, address_zip)
    `)
    .eq('id', pipelineEntryId)
    .single();

  if (!entry) throw new Error('Job not found');

  // Get rep profile
  let repName = 'N/A';
  let commissionRate = 0;
  let commissionType = 'profit_split';
  if (entry.assigned_to) {
    const { data: rep } = await supabase
      .from('profiles')
      .select('first_name, last_name, commission_rate, commission_structure')
      .eq('id', entry.assigned_to)
      .single();
    if (rep) {
      repName = `${rep.first_name || ''} ${rep.last_name || ''}`.trim();
      commissionRate = Number(rep.commission_rate || 0);
      commissionType = rep.commission_structure || 'profit_split';
    }
  }

  // Get latest estimate
  const { data: estimate } = await supabase
    .from('estimates')
    .select('selling_price, material_cost, labor_cost, overhead_amount')
    .eq('pipeline_entry_id', pipelineEntryId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const contact = entry.contacts as any;
  const customerName = contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : '';
  const address = contact
    ? [contact.address_street, contact.address_city, contact.address_state, contact.address_zip].filter(Boolean).join(', ')
    : '';

  const sellPrice = Number(estimate?.selling_price || entry.estimated_value || 0);
  const materialsCost = Number(estimate?.material_cost || 0);
  const laborCost = Number(estimate?.labor_cost || 0);
  const overheadAmount = Number(estimate?.overhead_amount || 0);
  const totalCost = materialsCost + laborCost + overheadAmount;
  const profit = sellPrice - totalCost;
  const marginPct = sellPrice > 0 ? (profit / sellPrice) * 100 : 0;

  let commissionAmount = 0;
  if (commissionType === 'percentage_contract_price' || commissionType === 'percentage_selling_price') {
    commissionAmount = sellPrice * (commissionRate / 100);
  } else {
    commissionAmount = Math.max(0, profit * (commissionRate / 100));
  }

  generateCapOutPdf({
    projectName: entry.lead_name || customerName || 'N/A',
    customerName,
    address,
    repName,
    date: new Date().toLocaleDateString(),
    sellPrice,
    materialsCost,
    laborCost,
    overheadAmount,
    commissionAmount,
    miscCost: 0,
    totalCost,
    profit,
    marginPct,
    commissionRate,
    commissionType,
  });
}

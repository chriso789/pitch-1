// Shared helper: when a supplier (SRS/ABC/QXO) confirms an order with
// verified pricing, build a draft vendor invoice on the project so AP can
// reconcile baseline vs verified prices.
//
// Tenant scope: caller passes the tenant_id resolved from the order row.
// Never trust tenant_id from the supplier payload.

type SB = any;

export interface VerifiedLine {
  description: string;
  quantity: number;
  unit_price: number;
  line_total?: number;
  supplier_item_number?: string | null;
  unit_of_measure?: string | null;
  purchase_order_item_id?: string | null;
  baseline_unit_price?: number | null;
}

export interface BuildInvoiceInput {
  supabase: SB;
  tenant_id: string;          // resolved server-side, never from payload
  project_id: string | null;
  supplier: 'srs' | 'abc' | 'qxo';
  source_order_table: 'srs_orders' | 'purchase_orders';
  source_order_id: string;
  purchase_order_id?: string | null;
  supplier_order_id?: string | null;   // e.g. SRS orderID
  vendor_name?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null;        // YYYY-MM-DD
  lines: VerifiedLine[];
}

export async function buildSupplierVerifiedInvoice(input: BuildInvoiceInput) {
  const {
    supabase, tenant_id, project_id, supplier,
    source_order_table, source_order_id,
    purchase_order_id, supplier_order_id,
    vendor_name, invoice_number, invoice_date, lines,
  } = input;

  if (!tenant_id) throw new Error('tenant_id required');
  if (!lines?.length) return { skipped: true, reason: 'no_lines' };

  // Idempotency: skip if we already created an invoice for this supplier_order_id
  if (supplier_order_id) {
    const { data: existing } = await supabase
      .from('project_cost_invoices')
      .select('id')
      .eq('tenant_id', tenant_id)
      .eq('source', 'supplier_order_confirmation')
      .eq('invoice_number', supplier_order_id)
      .maybeSingle();
    if (existing?.id) {
      return { skipped: true, reason: 'already_exists', invoice_id: existing.id };
    }
  }

  const subtotal = lines.reduce(
    (s, l) => s + Number(l.line_total ?? (Number(l.quantity) * Number(l.unit_price)) ?? 0),
    0,
  );

  const { data: invoice, error: invErr } = await supabase
    .from('project_cost_invoices')
    .insert({
      tenant_id,
      project_id,
      invoice_type: 'material',
      vendor_name: vendor_name ?? supplier.toUpperCase(),
      supplier,
      invoice_number: invoice_number ?? supplier_order_id ?? `${supplier}-${source_order_id.slice(0, 8)}`,
      invoice_date: invoice_date ?? new Date().toISOString().slice(0, 10),
      invoice_amount: subtotal,
      subtotal,
      status: 'pending_approval',
      source: 'supplier_order_confirmation',
      purchase_order_id: purchase_order_id ?? null,
      notes: `Auto-built from ${supplier.toUpperCase()} order confirmation (${source_order_table}:${source_order_id}).`,
    })
    .select('id')
    .single();
  if (invErr) throw invErr;

  const lineRows = lines.map((l, i) => {
    const qty = Number(l.quantity) || 0;
    const unit = Number(l.unit_price) || 0;
    const total = Number(l.line_total ?? qty * unit) || 0;
    const baseline = l.baseline_unit_price != null ? Number(l.baseline_unit_price) : null;
    const variancePct =
      baseline && baseline !== 0 ? ((unit - baseline) / baseline) * 100 : null;
    return {
      tenant_id,
      invoice_id: invoice.id,
      project_id,
      vendor_name: vendor_name ?? supplier.toUpperCase(),
      line_number: i + 1,
      description: l.description,
      quantity: qty,
      unit_price: unit,
      line_total: total,
      unit_of_measure: l.unit_of_measure ?? null,
      supplier_item_number: l.supplier_item_number ?? null,
      purchase_order_item_id: l.purchase_order_item_id ?? null,
      baseline_unit_price: baseline,
      price_variance_pct: variancePct,
      match_status: l.purchase_order_item_id ? 'matched' : 'unmatched',
    };
  });

  const { error: liErr } = await supabase
    .from('project_cost_invoice_line_items')
    .insert(lineRows);
  if (liErr) throw liErr;

  return { skipped: false, invoice_id: invoice.id, line_count: lineRows.length };
}

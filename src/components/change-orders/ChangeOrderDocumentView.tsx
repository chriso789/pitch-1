import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';

export interface ChangeOrderRecord {
  id: string;
  co_number: string;
  title: string;
  description: string | null;
  reason: string | null;
  original_scope?: string | null;
  new_scope?: string | null;
  cost_impact: number | null;
  time_impact_days?: number | null;
  status: string;
  created_at: string;
  project_id: string | null;
  line_items?: any[] | null;
  material_total?: number | null;
  labor_total?: number | null;
}

interface CompanyBrand {
  name?: string | null;
  logo_url?: string | null;
  phone?: string | null;
  email?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
  license_number?: string | null;
}

interface CustomerInfo {
  name?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
  phone?: string | null;
  email?: string | null;
}

interface Props {
  changeOrder: ChangeOrderRecord;
  pipelineEntryId: string;
  /** DOM id used by the html2canvas PDF helper */
  domId?: string;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);

export const ChangeOrderDocumentView: React.FC<Props> = ({
  changeOrder,
  pipelineEntryId,
  domId = 'change-order-doc',
}) => {
  const [company, setCompany] = useState<CompanyBrand | null>(null);
  const [customer, setCustomer] = useState<CustomerInfo | null>(null);

  useEffect(() => {
    (async () => {
      // Load tenant brand from the project's tenant
      const { data: project } = await supabase
        .from('projects')
        .select('tenant_id')
        .eq('id', changeOrder.project_id || '')
        .maybeSingle();
      const tenantId = project?.tenant_id;
      if (tenantId) {
        const { data: tenant } = await supabase
          .from('tenants')
          .select(
            'name, logo_url, phone, email, address_street, address_city, address_state, address_zip, license_number'
          )
          .eq('id', tenantId)
          .maybeSingle();
        if (tenant) setCompany(tenant as CompanyBrand);
      }

      // Load customer from the pipeline entry → contact
      const { data: pe } = await supabase
        .from('pipeline_entries')
        .select(
          'lead_name, contacts!pipeline_entries_contact_id_fkey(first_name, last_name, address_street, address_city, address_state, address_zip, phone, email)'
        )
        .eq('id', pipelineEntryId)
        .maybeSingle();
      const c: any = (pe as any)?.contacts;
      if (c) {
        setCustomer({
          name:
            (pe as any)?.lead_name ||
            [c.first_name, c.last_name].filter(Boolean).join(' '),
          address_street: c.address_street,
          address_city: c.address_city,
          address_state: c.address_state,
          address_zip: c.address_zip,
          phone: c.phone,
          email: c.email,
        });
      }
    })();
  }, [changeOrder.project_id, pipelineEntryId]);

  const items = useMemo(
    () => (Array.isArray(changeOrder.line_items) ? changeOrder.line_items : []),
    [changeOrder.line_items]
  );
  const materials = items.filter((i: any) => i.kind === 'material');
  const labor = items.filter((i: any) => i.kind === 'labor');
  const lineTotal = (i: any) =>
    (Number(i.quantity) || 0) * (Number(i.unit_price) || 0);
  const materialTotal =
    Number(changeOrder.material_total ?? 0) ||
    materials.reduce((s, i) => s + lineTotal(i), 0);
  const laborTotal =
    Number(changeOrder.labor_total ?? 0) ||
    labor.reduce((s, i) => s + lineTotal(i), 0);
  const subtotal = materialTotal + laborTotal;
  const grandTotal = Number(changeOrder.cost_impact ?? subtotal);

  const companyAddress = [
    company?.address_street,
    [company?.address_city, company?.address_state].filter(Boolean).join(', '),
    company?.address_zip,
  ]
    .filter(Boolean)
    .join(' ');

  const customerAddress = [
    customer?.address_street,
    [customer?.address_city, customer?.address_state].filter(Boolean).join(', '),
    customer?.address_zip,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      id={domId}
      className="bg-white text-gray-900 mx-auto"
      style={{ width: '8.5in', minHeight: '11in', padding: '0.5in', fontFamily: 'Inter, sans-serif' }}
    >
      {/* Header */}
      <div className="flex items-start justify-between border-b-2 border-gray-900 pb-4">
        <div className="flex items-center gap-4">
          {company?.logo_url && (
            <img
              src={company.logo_url}
              alt={company?.name || 'Logo'}
              crossOrigin="anonymous"
              style={{ maxHeight: 64, maxWidth: 180, objectFit: 'contain' }}
            />
          )}
          <div>
            <div className="text-xl font-bold leading-tight">
              {company?.name || 'Company'}
            </div>
            {companyAddress && (
              <div className="text-xs text-gray-600">{companyAddress}</div>
            )}
            <div className="text-xs text-gray-600">
              {company?.phone && <span>{company.phone}</span>}
              {company?.phone && company?.email && <span> • </span>}
              {company?.email && <span>{company.email}</span>}
            </div>
            {company?.license_number && (
              <div className="text-[10px] text-gray-500 mt-0.5">
                License #{company.license_number}
              </div>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tracking-wide">CHANGE ORDER</div>
          <div className="text-sm text-gray-700 mt-1">{changeOrder.co_number}</div>
          <div className="text-xs text-gray-500">
            {format(new Date(changeOrder.created_at), 'MMM d, yyyy')}
          </div>
          <Badge variant="outline" className="mt-2 capitalize">
            {changeOrder.status}
          </Badge>
        </div>
      </div>

      {/* Customer block */}
      <div className="grid grid-cols-2 gap-6 mt-6">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
            Customer
          </div>
          <div className="text-sm font-semibold">{customer?.name || '—'}</div>
          {customerAddress && (
            <div className="text-xs text-gray-600">{customerAddress}</div>
          )}
          <div className="text-xs text-gray-600">
            {customer?.phone}
            {customer?.phone && customer?.email && ' • '}
            {customer?.email}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
            Project
          </div>
          <div className="text-sm font-semibold">{changeOrder.title}</div>
          {changeOrder.time_impact_days != null && (
            <div className="text-xs text-gray-600">
              Time impact: {changeOrder.time_impact_days} day
              {changeOrder.time_impact_days === 1 ? '' : 's'}
            </div>
          )}
        </div>
      </div>

      {/* Reason / Scope */}
      {(changeOrder.reason || changeOrder.description) && (
        <section className="mt-6">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
            Reason for Change
          </div>
          <p className="text-sm whitespace-pre-wrap">
            {changeOrder.reason || changeOrder.description}
          </p>
        </section>
      )}

      {(changeOrder.original_scope || changeOrder.new_scope) && (
        <section className="mt-4 grid grid-cols-2 gap-6">
          {changeOrder.original_scope && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
                Original Scope
              </div>
              <p className="text-sm whitespace-pre-wrap">
                {changeOrder.original_scope}
              </p>
            </div>
          )}
          {changeOrder.new_scope && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
                New Scope
              </div>
              <p className="text-sm whitespace-pre-wrap">
                {changeOrder.new_scope}
              </p>
            </div>
          )}
        </section>
      )}

      {/* Line items */}
      {(materials.length > 0 || labor.length > 0) && (
        <section className="mt-6">
          {materials.length > 0 && (
            <LineItemsTable
              title="Materials"
              items={materials}
              total={materialTotal}
            />
          )}
          {labor.length > 0 && (
            <LineItemsTable
              title="Labor"
              items={labor}
              total={laborTotal}
              className="mt-4"
            />
          )}
        </section>
      )}

      {/* Totals */}
      <section className="mt-6 flex justify-end">
        <div className="w-72 border-t-2 border-gray-900 pt-2 text-sm">
          {(materialTotal > 0 || laborTotal > 0) && (
            <>
              <Row label="Materials" value={fmt(materialTotal)} />
              <Row label="Labor" value={fmt(laborTotal)} />
              <Row label="Subtotal" value={fmt(subtotal)} />
            </>
          )}
          <Row
            label="Cost Impact (this CO)"
            value={fmt(grandTotal)}
            bold
          />
        </div>
      </section>

      {/* Signature */}
      <section className="mt-12 grid grid-cols-2 gap-8 text-xs">
        <SignatureLine label="Customer Signature" />
        <SignatureLine label="Company Representative" />
      </section>

      <div className="mt-10 text-[10px] text-gray-400 text-center">
        {company?.name} — Change Order {changeOrder.co_number}
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string; bold?: boolean }> = ({
  label,
  value,
  bold,
}) => (
  <div
    className={`flex justify-between py-1 ${
      bold ? 'border-t border-gray-300 mt-1 pt-2 font-bold text-base' : ''
    }`}
  >
    <span>{label}</span>
    <span>{value}</span>
  </div>
);

const LineItemsTable: React.FC<{
  title: string;
  items: any[];
  total: number;
  className?: string;
}> = ({ title, items, total, className = '' }) => (
  <div className={className}>
    <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
      {title}
    </div>
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="bg-gray-100 text-left text-[11px] uppercase tracking-wide text-gray-600">
          <th className="py-1.5 px-2">Description</th>
          <th className="py-1.5 px-2 text-right w-16">Qty</th>
          <th className="py-1.5 px-2 text-right w-16">UoM</th>
          <th className="py-1.5 px-2 text-right w-24">Rate</th>
          <th className="py-1.5 px-2 text-right w-28">Amount</th>
        </tr>
      </thead>
      <tbody>
        {items.map((i: any, idx: number) => (
          <tr key={i.id || idx} className="border-b border-gray-100">
            <td className="py-1.5 px-2">{i.description || '—'}</td>
            <td className="py-1.5 px-2 text-right">{Number(i.quantity) || 0}</td>
            <td className="py-1.5 px-2 text-right">{i.unit_of_measure || ''}</td>
            <td className="py-1.5 px-2 text-right">{fmt(Number(i.unit_price) || 0)}</td>
            <td className="py-1.5 px-2 text-right font-medium">
              {fmt((Number(i.quantity) || 0) * (Number(i.unit_price) || 0))}
            </td>
          </tr>
        ))}
        <tr>
          <td colSpan={4} className="py-1.5 px-2 text-right font-semibold">
            {title} Total
          </td>
          <td className="py-1.5 px-2 text-right font-semibold">{fmt(total)}</td>
        </tr>
      </tbody>
    </table>
  </div>
);

const SignatureLine: React.FC<{ label: string }> = ({ label }) => (
  <div>
    <div className="border-b border-gray-400 h-10" />
    <div className="text-gray-600 mt-1">{label}</div>
    <div className="border-b border-gray-400 h-6 w-32 mt-3" />
    <div className="text-gray-600 mt-1">Date</div>
  </div>
);

export default ChangeOrderDocumentView;

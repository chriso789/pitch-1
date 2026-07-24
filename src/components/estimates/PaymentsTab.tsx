import { safeText } from '@/lib/safeText';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger 
} from '@/components/ui/dialog';
import { 
  DollarSign, Plus, CreditCard, FileText, Loader2, Receipt, ChevronDown, Trash2, Copy, Link2, CheckCircle2, Camera, Building2, AlertCircle, Pencil, ExternalLink

} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { 
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { useCompanyInfo } from '@/hooks/useCompanyInfo';
import { generateAndSaveInvoicePdf } from '@/lib/invoices/invoicePdfGenerator';
import { useSearchParams } from 'react-router-dom';
import { InvoiceEmailActions } from '@/components/invoices/InvoiceEmailActions';
import {
  computeRemainingInvoiceBalance,
  scaleGroupsToInvoiceBalance as scaleGroupsToInvoiceBalanceShared,
  validateInvoiceAgainstRemaining,
} from '@/lib/invoices/invoiceBalance';

interface PaymentsTabProps {
  pipelineEntryId: string;
  sellingPrice: number;
}

interface InvoiceLineItem {
  description: string;
  qty: number;
  unit: string;
  unit_cost: number;
  line_total: number;
  trade_type?: string;
  trade_label?: string;
}

interface InvoiceGroup {
  key: string;
  kind: 'trade' | 'change_order' | 'custom';
  label: string;
  selected: boolean;
  expanded: boolean;
  children: (InvoiceLineItem & { selected: boolean })[];
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

const statusConfig: Record<string, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-muted text-muted-foreground' },
  sent: { label: 'Sent', className: 'bg-blue-500/10 text-blue-600 border-blue-500/30' },
  partial: { label: 'Partial', className: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30' },
  paid: { label: 'Paid', className: 'bg-green-500/10 text-green-600 border-green-500/30' },
  void: { label: 'Void', className: 'bg-red-500/10 text-red-600 border-red-500/30' },
};

export const PaymentsTab: React.FC<PaymentsTabProps> = ({ pipelineEntryId, sellingPrice }) => {
  const queryClient = useQueryClient();
  const { activeTenantId } = useActiveTenantId();
  const { data: companyInfo } = useCompanyInfo();
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('check');
  const [paymentRef, setPaymentRef] = useState('');
  const [paymentDate, setPaymentDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [paymentNotes, setPaymentNotes] = useState('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [generatingLinkForInvoice, setGeneratingLinkForInvoice] = useState<string | null>(null);
  const [scanningPayment, setScanningPayment] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

  // Invoice builder state — grouped per trade / per change order.
  const [invoiceGroups, setInvoiceGroups] = useState<InvoiceGroup[]>([]);
  const [invoiceDueDate, setInvoiceDueDate] = useState('');
  const [invoiceNotes, setInvoiceNotes] = useState('');
  // QuickBooks / delivery options (UI state — wired for future QBO submission)
  const [qboAllowCreditCard, setQboAllowCreditCard] = useState(true);
  const [qboAllowAch, setQboAllowAch] = useState(true);
  const [qboRequireDeposit, setQboRequireDeposit] = useState(false);
  const [qboEmailViaQbo, setQboEmailViaQbo] = useState(false);
  const [sendFromPitchEmail, setSendFromPitchEmail] = useState(false);
  const [createPitchPortalLink, setCreatePitchPortalLink] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceTerms, setInvoiceTerms] = useState<'due_on_receipt' | 'net_15' | 'net_30' | 'custom'>('due_on_receipt');
  const [invoiceCustomTerms, setInvoiceCustomTerms] = useState('');
  const [customerMemo, setCustomerMemo] = useState('');
  const [showLineDetails, setShowLineDetails] = useState(false);
  // Pass-through credit-card processing fee (added on top of the invoice
  // total; collected from the homeowner so it does not deduct from the
  // contract balance owed).
  const [addCcFee, setAddCcFee] = useState(false);
  const [ccFeePercent, setCcFeePercent] = useState<number>(3.5);
  // Override gate: a new invoice may not exceed the remaining unpaid balance
  // unless the user explicitly toggles this on.
  const [overrideRemaining, setOverrideRemaining] = useState(false);
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());

  // Edit invoice state
  const [editingInvoice, setEditingInvoice] = useState<any | null>(null);
  const [editLineItems, setEditLineItems] = useState<InvoiceLineItem[]>([]);
  const [editDueDate, setEditDueDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null);

  // Fetch latest estimate from enhanced_estimates (any status except void/cancelled)
  const { data: enhancedEstimates } = useQuery({
    queryKey: ['enhanced-estimate-line-items', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('enhanced_estimates')
        .select('id, line_items, selling_price, status')
        .eq('pipeline_entry_id', pipelineEntryId)
        .not('status', 'in', '(rejected,expired)')
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      return data || [];
    },
  });

  // Fallback: fetch from legacy estimates table if enhanced_estimates is empty
  const { data: legacyEstimates } = useQuery({
    queryKey: ['legacy-estimate-line-items', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('estimates')
        .select('id, line_items, status')
        .eq('pipeline_entry_id', pipelineEntryId)
        .not('status', 'in', '(rejected,expired)')
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      return data || [];
    },
    enabled: (enhancedEstimates || []).length === 0,
  });

  // Fetch approved change orders for this pipeline entry so their line items
  // can be added to the invoice builder.
  const { data: approvedChangeOrders } = useQuery({
    queryKey: ['invoice-builder-change-orders', pipelineEntryId],
    queryFn: async () => {
      const { data: projects } = await supabase
        .from('projects')
        .select('id')
        .eq('pipeline_entry_id', pipelineEntryId);
      const projectIds = (projects || []).map((p: any) => p.id);
      if (projectIds.length === 0) return [];
      const { data, error } = await (supabase as any)
        .from('change_orders')
        .select('id, co_number, title, status, cost_impact, customer_approved, line_items')
        .in('project_id', projectIds);
      if (error) throw error;
      const APPROVED = new Set(['approved', 'invoiced', 'completed']);
      return (data || []).filter((co: any) =>
        APPROVED.has(String(co.status || '').toLowerCase()) || co.customer_approved === true
      );
    },
  });

  // Build invoice-ready line items from an approved CO. Mirrors the selling-price
  // rollup used in TotalsTab/ChangeOrdersTab: cost / (1 - overhead% - profit%).
  const parseChangeOrderLineItems = (
    co: any
  ): (InvoiceLineItem & { selected: boolean })[] => {
    const container: any = co?.line_items || {};
    const items: any[] = Array.isArray(container.items) ? container.items : [];
    if (items.length === 0) return [];
    const overheadPct = Number(container.overhead_pct ?? 10);
    const profitPct = Number(container.profit_pct ?? 25);
    const denom = Math.max(0.01, 1 - overheadPct / 100 - profitPct / 100);
    return items.map((it: any) => {
      const qty = Number(it.quantity ?? it.qty ?? 1) || 1;
      const unitCost = Number(it.unit_price ?? it.price ?? it.rate ?? 0) || 0;
      const costTotal = Number(it.line_total ?? it.total ?? qty * unitCost) || 0;
      const sellingTotal = Math.round((costTotal / denom) * 100) / 100;
      const sellingUnit = qty > 0 ? Math.round((sellingTotal / qty) * 100) / 100 : sellingTotal;
      const desc = it.item_name || it.description || it.name || 'Change order item';
      return {
        selected: true,
        description: desc,
        qty,
        unit: it.unit || 'ea',
        unit_cost: sellingUnit,
        line_total: sellingTotal,
      };
    });
  };

  // Fetch QBO connection status
  const { data: qboConnection } = useQuery({
    queryKey: ['qbo-connection', activeTenantId],
    queryFn: async () => {
      if (!activeTenantId) return null;
      const { data, error } = await supabase
        .from('qbo_connections')
        .select('id, realm_id')
        .eq('tenant_id', activeTenantId)
        .eq('is_active', true)
        .maybeSingle();
      if (error) return null;
      return data;
    },
    enabled: !!activeTenantId,
  });

  // Parse line items from either source
  const parseLineItems = (estimate: any, source: 'enhanced' | 'legacy'): (InvoiceLineItem & { selected: boolean })[] => {
    if (!estimate?.line_items) return [];
    const items: (InvoiceLineItem & { selected: boolean })[] = [];
    const lineItems = estimate.line_items as any;

    const pushItem = (raw: any, fallbackDesc: string) => {
      items.push({
        selected: true,
        description: raw.item_name || raw.description || raw.name || fallbackDesc,
        qty: Number(raw.qty || raw.quantity) || 1,
        unit: raw.unit || 'ea',
        unit_cost: Number(raw.unit_cost || raw.price || raw.rate) || 0,
        line_total:
          Number(raw.line_total || raw.total || raw.amount) ||
          (Number(raw.qty || raw.quantity || 1) * Number(raw.unit_cost || raw.price || raw.rate || 0)),
        trade_type: raw.trade_type || undefined,
        trade_label: raw.trade_label || undefined,
      });
    };

    if (source === 'enhanced') {
      if (Array.isArray(lineItems.materials)) lineItems.materials.forEach((m: any) => pushItem(m, 'Material'));
      if (Array.isArray(lineItems.labor)) lineItems.labor.forEach((l: any) => pushItem(l, 'Labor'));
      if (Array.isArray(lineItems.turnkey)) lineItems.turnkey.forEach((t: any) => pushItem(t, 'Turnkey'));
    } else {
      if (Array.isArray(lineItems)) {
        lineItems.forEach((it: any) => pushItem(it, 'Item'));
      } else if (typeof lineItems === 'object') {
        ['materials', 'labor', 'turnkey', 'items'].forEach((key) => {
          if (Array.isArray(lineItems[key])) lineItems[key].forEach((it: any) => pushItem(it, key));
        });
      }
    }
    return items;
  };


  // (Auto-populate effect moved below `payments`/`invoices` declarations.)


  // Scan payment handler
  const handleScanPayment = async (file: File) => {
    setScanningPayment(true);
    try {
      // Upload to temp storage
      const fileName = `scan_${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(`temp/${fileName}`, file);
      
      if (uploadError) throw new Error('Failed to upload image');

      const { data: urlData } = supabase.storage
        .from('documents')
        .getPublicUrl(`temp/${fileName}`);

      // Call parse-invoice-document edge function
      const { data, error } = await supabase.functions.invoke('parse-invoice-document', {
        body: { document_url: urlData.publicUrl },
      });

      if (error) throw error;

      const parsed = data?.parsed;
      if (parsed) {
        if (parsed.total_amount || parsed.amount) {
          setPaymentAmount(String(parsed.total_amount || parsed.amount));
        }
        if (parsed.invoice_date || parsed.date || parsed.payment_date) {
          const dateStr = parsed.invoice_date || parsed.date || parsed.payment_date;
          try {
            const d = new Date(dateStr);
            if (!isNaN(d.getTime())) setPaymentDate(format(d, 'yyyy-MM-dd'));
          } catch {}
        }
        if (parsed.invoice_number || parsed.reference_number || parsed.check_number) {
          setPaymentRef(parsed.invoice_number || parsed.reference_number || parsed.check_number || '');
        }
        toast.success('Payment details extracted from scan');
      } else {
        toast.info('Could not extract payment details. Please enter manually.');
      }

      // Clean up temp file
      await supabase.storage.from('documents').remove([`temp/${fileName}`]);
    } catch (err: any) {
      console.error('Scan error:', err);
      toast.error(err.message || 'Failed to scan payment');
    } finally {
      setScanningPayment(false);
    }
  };

  const groupTotal = (g: InvoiceGroup) =>
    g.children.filter((c) => c.selected).reduce((s, c) => s + (Number(c.line_total) || 0), 0);

  const scaleGroupsToInvoiceBalance = (groups: InvoiceGroup[], targetBalance: number) =>
    scaleGroupsToInvoiceBalanceShared(groups, targetBalance);

  const invoiceSubtotal = useMemo(
    () => invoiceGroups.filter((g) => g.selected).reduce((sum, g) => sum + groupTotal(g), 0),
    [invoiceGroups]
  );
  const ccFeeAmount = useMemo(
    () => (addCcFee ? Math.round(invoiceSubtotal * (ccFeePercent / 100) * 100) / 100 : 0),
    [addCcFee, ccFeePercent, invoiceSubtotal]
  );
  const invoiceGrandTotal = useMemo(
    () => Math.round((invoiceSubtotal + ccFeeAmount) * 100) / 100,
    [invoiceSubtotal, ccFeeAmount]
  );

  const { data: invoices, isLoading: loadingInvoices } = useQuery({
    queryKey: ['project-ar-invoices', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_invoices')
        .select('*')
        .eq('pipeline_entry_id', pipelineEntryId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: payments, isLoading: loadingPayments } = useQuery({
    queryKey: ['project-ar-payments', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_payments')
        .select('*')
        .eq('pipeline_entry_id', pipelineEntryId)
        .order('payment_date', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch Zelle payment links for this pipeline entry
  const { data: zelleLinks } = useQuery({
    queryKey: ['zelle-payment-links', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payment_links')
        .select('*')
        .eq('pipeline_entry_id', pipelineEntryId)
        .eq('payment_type', 'zelle')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch tenant Zelle settings
  const { data: zelleSettings } = useQuery({
    queryKey: ['tenant-zelle-enabled', activeTenantId],
    queryFn: async () => {
      if (!activeTenantId) return null;
      const { data, error } = await supabase
        .from('tenant_settings')
        .select('zelle_enabled')
        .eq('tenant_id', activeTenantId)
        .single();
      if (error) return null;
      return data;
    },
    enabled: !!activeTenantId,
  });

  const zelleEnabled = zelleSettings?.zelle_enabled || false;

  // Contract-paid totals exclude pass-through CC processing fees: the
  // homeowner pays the fee on top of the invoice and it is not applied to
  // the contract balance owed to the company.
  const totalPaid = (payments || []).reduce(
    (sum, p) => sum + (Number(p.amount) - Number((p as any).cc_fee_amount || 0)),
    0
  );
  const contractBalance = sellingPrice - totalPaid;

  // True remaining-billable balance: contract − recorded payments −
  // outstanding (non-void) invoice balances. This is what a new invoice
  // is allowed to total, unless the user explicitly overrides.
  const remainingInvoiceBalance = useMemo(
    () =>
      computeRemainingInvoiceBalance({
        sellingPrice,
        payments,
        outstandingInvoices: invoices,
      }),
    [sellingPrice, payments, invoices],
  );

  const remainingValidation = useMemo(
    () =>
      validateInvoiceAgainstRemaining({
        proposedTotal: invoiceGrandTotal,
        remainingBalance: remainingInvoiceBalance,
        overrideRemaining,
      }),
    [invoiceGrandTotal, remainingInvoiceBalance, overrideRemaining],
  );

  // Allow Accounts Receivable to deep-link straight into the Create Invoice
  // dialog with the remaining-balance default already applied. The dialog's
  // own effect (below) handles the scaling once it opens.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('action') === 'create-invoice' && !showInvoiceDialog) {
      setShowInvoiceDialog(true);
      const next = new URLSearchParams(searchParams);
      next.delete('action');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, showInvoiceDialog, setSearchParams]);

  useEffect(() => {
    if (!showInvoiceDialog) return;
    // Wait for payments and outstanding invoices to load so the default
    // truly reflects the remaining balance. Otherwise the first pass would
    // treat this project as unpaid and default the invoice to the full
    // contract amount.
    if (loadingPayments || loadingInvoices) return;

    const enhancedEst = (enhancedEstimates || [])[0];
    const legacyEst = (legacyEstimates || [])[0];
    const baseItems = enhancedEst?.line_items
      ? parseLineItems(enhancedEst, 'enhanced')
      : legacyEst?.line_items
        ? parseLineItems(legacyEst, 'legacy')
        : [];

    // Build trade groups from base estimate items (selling-price scaled).
    const tradeGroups: InvoiceGroup[] = [];
    if (baseItems.length > 0) {
      // Step 1: scale costs → selling price.
      const costTotal = baseItems.reduce((s, i) => s + i.line_total, 0);
      const targetSellingPrice = enhancedEst?.selling_price
        ? Number(enhancedEst.selling_price)
        : sellingPrice;
      const markupScale =
        costTotal > 0 && targetSellingPrice > 0 ? targetSellingPrice / costTotal : 1;
      const sellingPriceItems = baseItems.map((item) => {
        if (markupScale === 1) return item;
        const newTotal = Math.round(item.line_total * markupScale * 100) / 100;
        const qty = Number(item.qty) || 1;
        const newUnitCost = qty > 0 ? Math.round((newTotal / qty) * 100) / 100 : item.unit_cost;
        return { ...item, unit_cost: newUnitCost, line_total: newTotal };
      });

      // Group by trade_type, preserving order of first appearance.
      const order: string[] = [];
      const byTrade = new Map<string, { label: string; items: (InvoiceLineItem & { selected: boolean })[] }>();
      sellingPriceItems.forEach((it) => {
        const tradeType = (it.trade_type || 'roofing').toString();
        const tradeLabel =
          it.trade_label ||
          tradeType.charAt(0).toUpperCase() + tradeType.slice(1);
        if (!byTrade.has(tradeType)) {
          order.push(tradeType);
          byTrade.set(tradeType, { label: tradeLabel, items: [] });
        }
        byTrade.get(tradeType)!.items.push(it);
      });
      order.forEach((tradeType) => {
        const g = byTrade.get(tradeType)!;
        tradeGroups.push({
          key: `trade:${tradeType}`,
          kind: 'trade',
          label: `${g.label} — Labor & Materials`,
          selected: true,
          expanded: false,
          children: g.items,
        });
      });
    }

    // One group per approved change order.
    const coGroups: InvoiceGroup[] = (approvedChangeOrders || []).map((co: any) => {
      const children = parseChangeOrderLineItems(co);
      const title = co.title ? co.title : 'Untitled';
      return {
        key: `co:${co.id}`,
        kind: 'change_order' as const,
        label: `Change Order — ${title}`,
        selected: true,
        expanded: false,
        children,
      };
    });

    const invoiceReadyGroups = [...tradeGroups, ...coGroups];

    // Default the invoice to the remaining contract balance after recorded
    // payments and outstanding invoice balances. Apply this across the full
    // invoice set, including change orders, so the Create Invoice dialog never
    // re-bills the full contract by default.
    const remaining = computeRemainingInvoiceBalance({
      sellingPrice,
      payments,
      outstandingInvoices: invoices,
    });

    setInvoiceGroups(scaleGroupsToInvoiceBalance(invoiceReadyGroups, remaining));
    // Re-opening the dialog should always reset the override gate.
    setOverrideRemaining(false);
  }, [showInvoiceDialog, loadingPayments, loadingInvoices, enhancedEstimates, legacyEstimates, payments, invoices, sellingPrice, approvedChangeOrders]);

  const createInvoiceMutation = useMutation({
    mutationFn: async () => {
      const selectedGroups = invoiceGroups
        .map((g) => ({ g, total: groupTotal(g) }))
        .filter(({ g, total }) => g.selected && total > 0);
      if (selectedGroups.length === 0) throw new Error('Select at least one line item');

      const subtotal = Math.round(selectedGroups.reduce((s, { total }) => s + total, 0) * 100) / 100;
      if (subtotal <= 0) throw new Error('Invoice total must be greater than zero');
      const feeAmount = addCcFee ? Math.round(subtotal * (ccFeePercent / 100) * 100) / 100 : 0;
      const amount = Math.round((subtotal + feeAmount) * 100) / 100;

      // Enforce remaining-balance guard at submit time too, in case the
      // override checkbox was bypassed by state manipulation or a stale UI.
      const guard = validateInvoiceAgainstRemaining({
        proposedTotal: amount,
        remainingBalance: remainingInvoiceBalance,
        overrideRemaining,
      });
      if (!guard.ok) {
        throw new Error(
          `Invoice total ${formatCurrency(amount)} exceeds the remaining unpaid balance ` +
            `${formatCurrency(remainingInvoiceBalance)}. Toggle the override to bill above the contract balance.`,
        );
      }

      // Get auth user directly to avoid profile mismatch
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const lineItemsPayload: InvoiceLineItem[] = selectedGroups.map(({ g, total }) => ({
        description: g.label,
        qty: 1,
        unit: 'lot',
        unit_cost: total,
        line_total: total,
      }));
      if (feeAmount > 0) {
        lineItemsPayload.push({
          description: `Credit Card Processing Fee (${ccFeePercent}%) — pass-through, not applied to contract balance`,
          qty: 1,
          unit: 'fee',
          unit_cost: feeAmount,
          line_total: feeAmount,
        });
      }

      // Server-authoritative invoice creation. The browser must NEVER submit
      // tenant_id / company_id / realm_id — the edge function resolves those
      // from the project (pipeline_entry) and validates access.
      const { data: fnResult, error: fnErr } = await supabase.functions.invoke('invoice-create', {
        body: {
          project_id: pipelineEntryId,
          invoice_type: 'standard',
          due_date: invoiceDueDate || null,
          notes: invoiceNotes || null,
          line_items: lineItemsPayload,
          cc_fee_amount: feeAmount,
          cc_fee_percent: addCcFee ? ccFeePercent : 0,
          payment_options: {
            allowCreditCard: qboAllowCreditCard,
            allowAch: qboAllowAch,
            requireDeposit: qboRequireDeposit,
            autoEmailViaQbo: qboEmailViaQbo,
            sendFromPitchEmail,
            createPortalLink: createPitchPortalLink,
            terms: invoiceTerms,
            customTerms: invoiceCustomTerms || undefined,
            customerMemo: customerMemo || undefined,
            invoiceNumberOverride: invoiceNumber || undefined,
          },
        },
      });
      if (fnErr || !fnResult?.ok) {
        const msg = (fnResult as any)?.error || fnErr?.message || 'Failed to create invoice';
        console.error('Invoice creation error:', fnErr, fnResult);
        throw new Error(msg);
      }
      const createdInvoice: any = (fnResult as any).invoice;
      const invoiceNumberOut: string = createdInvoice?.invoice_number || '';
      // Preserve the resolved invoice number for the downstream PDF step.
      const invoiceNumberForPdf = invoiceNumberOut;


      // Fetch customer for the PDF (contact via pipeline_entry)
      let customer = { name: '', address: '', email: '', phone: '' } as Record<string, string>;
      try {
        const { data: pe } = await supabase
          .from('pipeline_entries')
          .select('contact_id, contacts!pipeline_entries_contact_id_fkey(first_name,last_name,email,phone,address_street,address_city,address_state,address_zip)')
          .eq('id', pipelineEntryId)
          .maybeSingle();
        const c: any = (pe as any)?.contacts;
        if (c) {
          customer.name = [c.first_name, c.last_name].filter(Boolean).join(' ');
          customer.email = c.email || '';
          customer.phone = c.phone || '';
          customer.address = [
            c.address_street,
            [c.address_city, c.address_state, c.address_zip].filter(Boolean).join(', '),
          ]
            .filter(Boolean)
            .join('\n');
        }
      } catch (e) {
        console.warn('Could not load contact for invoice PDF', e);
      }

      // Generate + upload PDF (non-blocking failure — invoice is already saved)
      try {
        const today = new Date();
        const due = invoiceDueDate ? new Date(invoiceDueDate + 'T00:00:00') : null;
        const result = await generateAndSaveInvoicePdf({
          tenantId: activeTenantId!,
          pipelineEntryId,
          userId: user.id,
          data: {
            invoiceNumber: invoiceNumberForPdf,
            invoiceDate: format(today, 'MMM d, yyyy'),
            dueDate: due ? format(due, 'MMM d, yyyy') : null,
            notes: invoiceNotes || null,
            lineItems: lineItemsPayload,
            amount,
            company: companyInfo,
            customer,
            alreadyPaid: totalPaid || 0,
            paymentHistory: (payments || []).map((p: any) => ({
              date: format(new Date(p.payment_date), 'MMM d, yyyy'),
              amount: Number(p.amount) || 0,
              method: p.payment_method || '',
              reference: p.reference_number || '',
            })),
            contractTotal: Number(sellingPrice) || 0,
          },
        });
        if (result.error) {
          console.warn('Invoice PDF saved with warning:', result.error);
        }
      } catch (pdfErr: any) {
        console.error('Failed to generate invoice PDF:', pdfErr);
        toast.warning('Invoice created, but PDF generation failed');
      }

      // Auto-send from Pitch email after the PDF is uploaded so the recipient
      // gets a working link. The server resolves tenant + contact and delivers
      // via the tenant's verified domain (or platform fallback).
      if (sendFromPitchEmail && createdInvoice?.id && customer.email) {
        try {
          const { data: shareRes, error: shareErr } = await supabase.functions.invoke('invoice-share', {
            body: {
              invoice_id: createdInvoice.id,
              channel: 'email',
              recipient: customer.email,
              include_qbo_link: true,
            },
          });
          if (shareErr || !(shareRes as any)?.ok) {
            const reason = (shareRes as any)?.reason || (shareRes as any)?.error || shareErr?.message || 'unknown';
            toast.warning(`Invoice created, but auto-email failed: ${reason}`);
          } else {
            toast.success(`Invoice emailed to ${customer.email}`);
          }
        } catch (e: any) {
          toast.warning(`Invoice created, but auto-email failed: ${e?.message ?? 'unknown'}`);
        }
      } else if (sendFromPitchEmail && !customer.email) {
        toast.warning('Send from Pitch Email selected, but the contact has no email on file');
      }
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-ar-invoices', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['documents', pipelineEntryId] });
      setShowInvoiceDialog(false);
      setInvoiceNotes('');
      setInvoiceDueDate('');
      setAddCcFee(false);
      toast.success('Invoice created and PDF saved to Documents');
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create invoice'),
  });

  // Open edit dialog
  const openEditInvoice = (inv: any) => {
    const items: InvoiceLineItem[] = Array.isArray(inv.line_items)
      ? (inv.line_items as any[]).map((li) => ({
          description: li.description || '',
          qty: Number(li.qty) || 0,
          unit: li.unit || 'ea',
          unit_cost: Number(li.unit_cost) || 0,
          line_total: Number(li.line_total) || 0,
        }))
      : [];
    setEditingInvoice(inv);
    setEditLineItems(items);
    setEditDueDate(inv.due_date ? format(new Date(inv.due_date + 'T00:00:00'), 'yyyy-MM-dd') : '');
    setEditNotes(inv.notes || '');
  };

  const updateEditItem = (idx: number, patch: Partial<InvoiceLineItem>) => {
    setEditLineItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const merged = { ...it, ...patch } as InvoiceLineItem;
        const qty = Number(merged.qty) || 0;
        const unitCost = Number(merged.unit_cost) || 0;
        merged.line_total = Math.round(qty * unitCost * 100) / 100;
        return merged;
      })
    );
  };

  const removeEditItem = (idx: number) => {
    setEditLineItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const editInvoiceTotal = useMemo(
    () => editLineItems.reduce((s, i) => s + (Number(i.line_total) || 0), 0),
    [editLineItems]
  );

  const updateInvoiceMutation = useMutation({
    mutationFn: async () => {
      if (!editingInvoice) throw new Error('No invoice');
      if (editLineItems.length === 0) throw new Error('Invoice must have at least one line item');
      const newAmount = Math.round(editInvoiceTotal * 100) / 100;
      if (newAmount <= 0) throw new Error('Invoice total must be greater than zero');

      // Preserve already-paid amount: balance = newAmount - paidSoFar
      const paidSoFar = Math.max(0, Number(editingInvoice.amount) - Number(editingInvoice.balance));
      const newBalance = Math.max(0, Math.round((newAmount - paidSoFar) * 100) / 100);
      let newStatus = editingInvoice.status;
      if (newStatus !== 'void') {
        if (newBalance === 0 && paidSoFar > 0) newStatus = 'paid';
        else if (paidSoFar > 0 && newBalance > 0) newStatus = 'partial';
        else if (paidSoFar === 0) newStatus = editingInvoice.status === 'sent' ? 'sent' : 'draft';
      }

      const { error } = await supabase
        .from('project_invoices')
        .update({
          amount: newAmount,
          balance: newBalance,
          status: newStatus,
          due_date: editDueDate || null,
          notes: editNotes || null,
          line_items: editLineItems as any,
        })
        .eq('id', editingInvoice.id);
      if (error) throw new Error(error.message || 'Failed to update invoice');

      // Regenerate the PDF so updated totals + contract total are reflected
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        let customer = { name: '', address: '', email: '', phone: '' } as Record<string, string>;
        try {
          const { data: pe } = await supabase
            .from('pipeline_entries')
            .select('contact_id, contacts!pipeline_entries_contact_id_fkey(first_name,last_name,email,phone,address_street,address_city,address_state,address_zip)')
            .eq('id', pipelineEntryId)
            .maybeSingle();
          const c: any = (pe as any)?.contacts;
          if (c) {
            customer.name = [c.first_name, c.last_name].filter(Boolean).join(' ');
            customer.email = c.email || '';
            customer.phone = c.phone || '';
            customer.address = [
              c.address_street,
              [c.address_city, c.address_state, c.address_zip].filter(Boolean).join(', '),
            ].filter(Boolean).join('\n');
          }
        } catch {}

        const createdAt = editingInvoice.created_at ? new Date(editingInvoice.created_at) : new Date();
        const due = editDueDate ? new Date(editDueDate + 'T00:00:00') : null;
        await generateAndSaveInvoicePdf({
          tenantId: activeTenantId!,
          pipelineEntryId,
          userId: user.id,
          data: {
            invoiceNumber: editingInvoice.invoice_number,
            invoiceDate: format(createdAt, 'MMM d, yyyy'),
            dueDate: due ? format(due, 'MMM d, yyyy') : null,
            notes: editNotes || null,
            lineItems: editLineItems,
            amount: newAmount,
            company: companyInfo,
            customer,
            alreadyPaid: totalPaid || 0,
            paymentHistory: (payments || []).map((p: any) => ({
              date: format(new Date(p.payment_date), 'MMM d, yyyy'),
              amount: Number(p.amount) || 0,
              method: p.payment_method || '',
              reference: p.reference_number || '',
            })),
            contractTotal: Number(sellingPrice) || 0,
          },
        });
      } catch (pdfErr) {
        console.warn('Invoice PDF regen failed on edit:', pdfErr);
      }

    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-ar-invoices', pipelineEntryId] });
      toast.success('Invoice updated');
      setEditingInvoice(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteInvoiceMutation = useMutation({
    mutationFn: async (inv: any) => {
      const paidSoFar = Number(inv.amount) - Number(inv.balance);
      if (paidSoFar > 0) {
        throw new Error('Cannot delete an invoice with payments applied. Void it instead.');
      }
      const { error } = await supabase.from('project_invoices').delete().eq('id', inv.id);
      if (error) throw new Error(error.message || 'Failed to delete invoice');

      // Best-effort cleanup of generated PDF + document record
      try {
        const safeNumber = String(inv.invoice_number).replace(/[^A-Za-z0-9_-]/g, '_');
        const filePath = `${activeTenantId}/${pipelineEntryId}/invoices/${safeNumber}.pdf`;
        await supabase.storage.from('documents').remove([filePath]);
        await (supabase as any).from('documents').delete().eq('file_path', filePath);
      } catch (e) {
        console.warn('Invoice PDF cleanup warning:', e);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-ar-invoices', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['documents', pipelineEntryId] });
      toast.success('Invoice deleted');
      setDeletingInvoiceId(null);
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setDeletingInvoiceId(null);
    },
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(paymentAmount);
      if (isNaN(amount) || amount <= 0) throw new Error('Invalid amount');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // If the payment is applied to an invoice that has a pass-through CC
      // fee, allocate the fee portion of this payment so it is excluded
      // from contract-paid totals.
      let allocatedFee = 0;
      if (selectedInvoiceId) {
        const inv = (invoices || []).find((i: any) => i.id === selectedInvoiceId) as any;
        const invFee = Number(inv?.cc_fee_amount || 0);
        const invAmount = Number(inv?.amount || 0);
        if (invFee > 0 && invAmount > 0) {
          allocatedFee = Math.min(invFee, Math.round(amount * (invFee / invAmount) * 100) / 100);
        }
      }

      const { error } = await supabase.from('project_payments').insert({
        tenant_id: activeTenantId!,
        pipeline_entry_id: pipelineEntryId,
        invoice_id: selectedInvoiceId || null,
        amount,
        payment_method: paymentMethod,
        reference_number: paymentRef || null,
        payment_date: paymentDate,
        notes: paymentNotes || null,
        created_by: user.id,
        cc_fee_amount: allocatedFee,
      } as any);
      if (error) {
        console.error('Payment creation error:', error);
        throw new Error(error.message || 'Failed to record payment');
      }

      if (selectedInvoiceId) {
        const invoice = (invoices || []).find(i => i.id === selectedInvoiceId);
        if (invoice) {
          const newBalance = Math.max(0, Number(invoice.balance) - amount);
          const newStatus = newBalance === 0 ? 'paid' : 'partial';
          await supabase.from('project_invoices')
            .update({ balance: newBalance, status: newStatus })
            .eq('id', selectedInvoiceId);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-ar-invoices', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['project-ar-payments', pipelineEntryId] });
      // Notify the AR dashboard (and any other live listeners) to refresh immediately
      queryClient.invalidateQueries({ queryKey: ['ar-payments'] });
      queryClient.invalidateQueries({ queryKey: ['ar-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['ar-projects'] });
      window.dispatchEvent(new CustomEvent('project-payment-recorded', { detail: { pipelineEntryId } }));
      setShowPaymentDialog(false);
      setPaymentAmount('');
      setPaymentRef('');
      setPaymentNotes('');
      setSelectedInvoiceId(null);
      toast.success('Payment recorded');
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to record payment'),
  });

  const toggleGroupSelected = (gIdx: number) => {
    setInvoiceGroups((prev) =>
      prev.map((g, i) => (i === gIdx ? { ...g, selected: !g.selected } : g))
    );
  };

  const toggleGroupExpanded = (gIdx: number) => {
    setInvoiceGroups((prev) =>
      prev.map((g, i) => (i === gIdx ? { ...g, expanded: !g.expanded } : g))
    );
  };

  const updateGroupLabel = (gIdx: number, label: string) => {
    setInvoiceGroups((prev) => prev.map((g, i) => (i === gIdx ? { ...g, label } : g)));
  };

  const removeGroup = (gIdx: number) => {
    setInvoiceGroups((prev) => prev.filter((_, i) => i !== gIdx));
  };

  const toggleChildSelected = (gIdx: number, cIdx: number) => {
    setInvoiceGroups((prev) =>
      prev.map((g, i) => {
        if (i !== gIdx) return g;
        const children = g.children.map((c, j) =>
          j === cIdx ? { ...c, selected: !c.selected } : c
        );
        return { ...g, children };
      })
    );
  };

  const updateChild = (
    gIdx: number,
    cIdx: number,
    field: keyof InvoiceLineItem,
    value: any
  ) => {
    setInvoiceGroups((prev) =>
      prev.map((g, i) => {
        if (i !== gIdx) return g;
        const children = g.children.map((c, j) => {
          if (j !== cIdx) return c;
          const merged: any = { ...c, [field]: value };
          if (field === 'qty' || field === 'unit_cost') {
            merged.line_total =
              Math.round((Number(merged.qty) || 0) * (Number(merged.unit_cost) || 0) * 100) / 100;
          }
          return merged;
        });
        return { ...g, children };
      })
    );
  };

  const removeChild = (gIdx: number, cIdx: number) => {
    setInvoiceGroups((prev) =>
      prev.map((g, i) =>
        i === gIdx ? { ...g, children: g.children.filter((_, j) => j !== cIdx) } : g
      )
    );
  };

  const addCustomGroup = () => {
    setInvoiceGroups((prev) => [
      ...prev,
      {
        key: `custom:${Date.now()}`,
        kind: 'custom',
        label: 'Custom line',
        selected: true,
        expanded: true,
        children: [
          { selected: true, description: '', qty: 1, unit: 'ea', unit_cost: 0, line_total: 0 },
        ],
      },
    ]);
  };

  // When "Show item details" is toggled, expand/collapse all groups.
  useEffect(() => {
    setInvoiceGroups((prev) => prev.map((g) => ({ ...g, expanded: showLineDetails })));
  }, [showLineDetails]);


  const handleSendPaymentLink = async (invoice: any) => {
    setGeneratingLinkForInvoice(invoice.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase.functions.invoke('stripe-create-payment-link', {
        body: {
          amount: Number(invoice.balance),
          currency: 'usd',
          description: `Invoice ${invoice.invoice_number}`,
          contactId: null,
          projectId: null,
          paymentId: null,
          metadata: {
            invoice_id: invoice.id,
            pipeline_entry_id: pipelineEntryId,
            invoice_number: invoice.invoice_number,
            created_by: user.id,
          },
        },
      });

      if (error) throw error;

      if (data?.paymentLink?.url) {
        await supabase
          .from('project_invoices')
          .update({ stripe_payment_link_url: data.paymentLink.url, status: invoice.status === 'draft' ? 'sent' : invoice.status })
          .eq('id', invoice.id);

        await navigator.clipboard.writeText(data.paymentLink.url);
        
        queryClient.invalidateQueries({ queryKey: ['project-ar-invoices', pipelineEntryId] });
        toast.success('Stripe payment link copied to clipboard!', {
          action: {
            label: 'Open',
            onClick: () => window.open(data.paymentLink.url, '_blank'),
          },
        });
      }
    } catch (error: any) {
      console.error('Error generating payment link:', error);
      toast.error(error.message || 'Failed to generate payment link');
    } finally {
      setGeneratingLinkForInvoice(null);
    }
  };

  const handleSendZelleLink = async (invoice: any) => {
    setGeneratingLinkForInvoice(invoice.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Generate a unique shareable token
      const shareableToken = crypto.randomUUID().replace(/-/g, '').slice(0, 16);

      // Create payment link record for Zelle
      const { error } = await supabase.from('payment_links').insert({
        tenant_id: activeTenantId!,
        invoice_id: invoice.id,
        pipeline_entry_id: pipelineEntryId,
        amount: Number(invoice.balance),
        currency: 'usd',
        description: `Invoice ${invoice.invoice_number}`,
        payment_type: 'zelle',
        shareable_token: shareableToken,
        zelle_confirmation_status: 'pending',
        status: 'active',
        created_by: user.id,
      });

      if (error) throw error;

      const paymentUrl = `${window.location.origin}/pay/${shareableToken}`;

      // Update invoice status
      if (invoice.status === 'draft') {
        await supabase.from('project_invoices')
          .update({ status: 'sent' })
          .eq('id', invoice.id);
      }

      await navigator.clipboard.writeText(paymentUrl);
      
      queryClient.invalidateQueries({ queryKey: ['project-ar-invoices', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['zelle-payment-links', pipelineEntryId] });
      toast.success('Zelle payment link copied to clipboard!', {
        action: {
          label: 'Open',
          onClick: () => window.open(paymentUrl, '_blank'),
        },
      });
    } catch (error: any) {
      console.error('Error generating Zelle link:', error);
      toast.error(error.message || 'Failed to generate Zelle link');
    } finally {
      setGeneratingLinkForInvoice(null);
    }
  };

  const handleConfirmZellePayment = async (paymentLink: any, invoice: any) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Record payment
      await supabase.from('project_payments').insert({
        tenant_id: activeTenantId!,
        pipeline_entry_id: pipelineEntryId,
        invoice_id: invoice.id,
        amount: Number(paymentLink.amount),
        payment_method: 'zelle',
        reference_number: `ZELLE-${paymentLink.shareable_token}`,
        payment_date: format(new Date(), 'yyyy-MM-dd'),
        notes: 'Zelle payment confirmed',
        created_by: user.id,
      });

      // Update invoice balance
      const newBalance = Math.max(0, Number(invoice.balance) - Number(paymentLink.amount));
      const newStatus = newBalance === 0 ? 'paid' : 'partial';
      await supabase.from('project_invoices')
        .update({ balance: newBalance, status: newStatus })
        .eq('id', invoice.id);

      // Mark Zelle link as confirmed
      await supabase.from('payment_links')
        .update({ zelle_confirmation_status: 'confirmed', status: 'completed' })
        .eq('id', paymentLink.id);

      queryClient.invalidateQueries({ queryKey: ['project-ar-invoices', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['project-ar-payments', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['zelle-payment-links', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['ar-payments'] });
      queryClient.invalidateQueries({ queryKey: ['ar-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['ar-projects'] });
      window.dispatchEvent(new CustomEvent('project-payment-recorded', { detail: { pipelineEntryId } }));
      toast.success('Zelle payment confirmed!');
    } catch (error: any) {
      toast.error(error.message || 'Failed to confirm payment');
    }
  };

  const toggleInvoiceExpand = (id: string) => {
    setExpandedInvoices(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (loadingInvoices || loadingPayments) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const openInvoices = (invoices || []).filter(i => i.status !== 'paid' && i.status !== 'void');

  return (
    <div className="space-y-6">
      {/* Balance Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-muted/50 rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Contract Value</p>
          <p className="text-sm font-bold">{formatCurrency(sellingPrice)}</p>
        </div>
        <div className="bg-green-500/10 rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Total Paid</p>
          <p className="text-sm font-bold text-green-600">{formatCurrency(totalPaid)}</p>
        </div>
        <div className={cn("rounded-lg p-3", contractBalance > 0 ? "bg-yellow-500/10" : "bg-green-500/10")}>
          <p className="text-xs text-muted-foreground">Balance Due</p>
          <p className={cn("text-sm font-bold", contractBalance > 0 ? "text-yellow-600" : "text-green-600")}>
            {formatCurrency(contractBalance)}
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <Dialog open={showInvoiceDialog} onOpenChange={setShowInvoiceDialog}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="flex-1">
              <FileText className="h-4 w-4 mr-1" />
              Create Invoice
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Invoice</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Previous payments context */}
              {totalPaid > 0 && (
                <div className="grid grid-cols-3 gap-2 p-3 bg-muted/50 rounded-lg">
                  <div>
                    <p className="text-[10px] text-muted-foreground">Contract</p>
                    <p className="text-xs font-bold">{formatCurrency(sellingPrice)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Already Paid</p>
                    <p className="text-xs font-bold text-green-600">{formatCurrency(totalPaid)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Remaining</p>
                    <p className={cn("text-xs font-bold", contractBalance > 0 ? "text-yellow-600" : "text-green-600")}>
                      {formatCurrency(contractBalance)}
                    </p>
                  </div>
                </div>
              )}

              {/* Grouped Line Items */}
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Line Items</Label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <Checkbox
                      checked={showLineDetails}
                      onCheckedChange={(v) => setShowLineDetails(!!v)}
                    />
                    Show item details
                  </label>
                </div>
                {invoiceGroups.length === 0 && (
                  <p className="text-sm text-muted-foreground py-3">No estimate or change orders found. Add a line manually.</p>
                )}
                <div className="mt-2 space-y-1">
                  {invoiceGroups.map((group, gIdx) => {
                    const total = groupTotal(group);
                    return (
                      <div
                        key={group.key}
                        className={cn(
                          'rounded border bg-muted/30',
                          !group.selected && 'opacity-50'
                        )}
                      >
                        {/* Group header row */}
                        <div className="grid grid-cols-[28px_20px_1fr_110px_28px] gap-1 items-center px-2 py-2">
                          <Checkbox
                            checked={group.selected}
                            onCheckedChange={() => toggleGroupSelected(gIdx)}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => toggleGroupExpanded(gIdx)}
                            aria-label={group.expanded ? 'Collapse' : 'Expand'}
                          >
                            <ChevronDown
                              className={cn(
                                'h-4 w-4 transition-transform',
                                !group.expanded && '-rotate-90'
                              )}
                            />
                          </Button>
                          <Input
                            value={group.label}
                            onChange={(e) => updateGroupLabel(gIdx, e.target.value)}
                            className="h-8 text-xs font-medium"
                          />
                          <p className="text-sm text-right font-semibold">
                            {formatCurrency(total)}
                          </p>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => removeGroup(gIdx)}
                          >
                            <Trash2 className="h-3 w-3 text-muted-foreground" />
                          </Button>
                        </div>

                        {/* Children (expanded) */}
                        {group.expanded && group.children.length > 0 && (
                          <div className="border-t bg-background px-2 py-2 space-y-1">
                            <div className="grid grid-cols-[28px_1fr_60px_60px_80px_90px_28px] gap-1 text-[10px] uppercase font-medium text-muted-foreground px-1">
                              <div></div>
                              <div>Description</div>
                              <div className="text-right">Qty</div>
                              <div>Unit</div>
                              <div className="text-right">Price</div>
                              <div className="text-right">Total</div>
                              <div></div>
                            </div>
                            {group.children.map((item, cIdx) => (
                              <div
                                key={cIdx}
                                className={cn(
                                  'grid grid-cols-[28px_1fr_60px_60px_80px_90px_28px] gap-1 items-center px-1 py-1 rounded',
                                  !item.selected && 'opacity-50'
                                )}
                              >
                                <Checkbox
                                  checked={item.selected}
                                  onCheckedChange={() => toggleChildSelected(gIdx, cIdx)}
                                />
                                <Input
                                  value={item.description}
                                  onChange={(e) => updateChild(gIdx, cIdx, 'description', e.target.value)}
                                  className="h-7 text-xs"
                                />
                                <Input
                                  type="number"
                                  value={item.qty}
                                  onChange={(e) => updateChild(gIdx, cIdx, 'qty', parseFloat(e.target.value) || 0)}
                                  className="h-7 text-xs text-right"
                                />
                                <Input
                                  value={item.unit}
                                  onChange={(e) => updateChild(gIdx, cIdx, 'unit', e.target.value)}
                                  className="h-7 text-xs"
                                />
                                <Input
                                  type="number"
                                  value={item.unit_cost}
                                  onChange={(e) => updateChild(gIdx, cIdx, 'unit_cost', parseFloat(e.target.value) || 0)}
                                  className="h-7 text-xs text-right"
                                  step="0.01"
                                />
                                <p className="text-xs text-right font-medium">
                                  {formatCurrency(item.line_total)}
                                </p>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => removeChild(gIdx, cIdx)}
                                >
                                  <Trash2 className="h-3 w-3 text-muted-foreground" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <Button variant="ghost" size="sm" className="mt-2 text-xs" onClick={addCustomGroup}>
                  <Plus className="h-3 w-3 mr-1" /> Add Line Item
                </Button>
              </div>


              <Separator />

              {/* Credit-card processing fee toggle (pass-through to homeowner) */}
              <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <Label htmlFor="cc-fee-toggle" className="text-sm font-medium flex items-center gap-2 cursor-pointer">
                      <CreditCard className="h-4 w-4" />
                      Add credit card processing fee
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Adds the fee on top of the invoice. Collected from the homeowner and not deducted from the contract balance.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max="20"
                      value={ccFeePercent}
                      onChange={(e) => setCcFeePercent(Math.max(0, parseFloat(e.target.value) || 0))}
                      disabled={!addCcFee}
                      className="h-8 w-20 text-right"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                    <input
                      id="cc-fee-toggle"
                      type="checkbox"
                      checked={addCcFee}
                      onChange={(e) => setAddCcFee(e.target.checked)}
                      className="h-4 w-4 ml-1 cursor-pointer"
                    />
                  </div>
                </div>
              </div>

              {/* Subtotal */}
              <div className="flex justify-end">
                <div className="text-right space-y-0.5">
                  <div className="flex justify-between gap-8 text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-medium">{formatCurrency(invoiceSubtotal)}</span>
                  </div>
                  {addCcFee && ccFeeAmount > 0 && (
                    <div className="flex justify-between gap-8 text-sm">
                      <span className="text-muted-foreground">CC processing fee ({ccFeePercent}%)</span>
                      <span className="font-medium">{formatCurrency(ccFeeAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-8 pt-1 border-t mt-1">
                    <span className="text-xs text-muted-foreground self-end">Invoice Total</span>
                    <span className="text-lg font-bold">{formatCurrency(invoiceGrandTotal)}</span>
                  </div>
                </div>
              </div>

              <Separator />

              {/* QuickBooks Payment Options */}
              <div className="rounded-md border bg-muted/20 p-3 space-y-3">
                <Label className="text-sm font-semibold flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  QuickBooks Payment Options
                </Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    { id: 'qbo-cc', checked: qboAllowCreditCard, set: setQboAllowCreditCard, label: 'Allow Credit Card Payments' },
                    { id: 'qbo-ach', checked: qboAllowAch, set: setQboAllowAch, label: 'Allow ACH / Bank Transfer' },
                    { id: 'qbo-deposit', checked: qboRequireDeposit, set: setQboRequireDeposit, label: 'Require Deposit Before Work Begins' },
                    { id: 'qbo-email', checked: qboEmailViaQbo, set: setQboEmailViaQbo, label: 'Automatically Email Invoice via QuickBooks' },
                    { id: 'pitch-email', checked: sendFromPitchEmail, set: setSendFromPitchEmail, label: 'Send from Pitch Email' },
                    { id: 'pitch-portal', checked: createPitchPortalLink, set: setCreatePitchPortalLink, label: 'Create Secure Pitch Portal Link' },
                  ].map(opt => (
                    <label key={opt.id} htmlFor={opt.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        id={opt.id}
                        checked={opt.checked}
                        onCheckedChange={(v) => opt.set(!!v)}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Invoice Number + Terms */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Invoice Number</Label>
                  <Input
                    value={invoiceNumber}
                    onChange={e => setInvoiceNumber(e.target.value)}
                    placeholder="(QBO Auto Numbering)"
                  />
                </div>
                <div>
                  <Label>Terms</Label>
                  <RadioGroup
                    value={invoiceTerms}
                    onValueChange={(v) => setInvoiceTerms(v as typeof invoiceTerms)}
                    className="grid grid-cols-2 gap-1 mt-1"
                  >
                    {[
                      { v: 'due_on_receipt', l: 'Due on Receipt' },
                      { v: 'net_15', l: 'Net 15' },
                      { v: 'net_30', l: 'Net 30' },
                      { v: 'custom', l: 'Custom' },
                    ].map(t => (
                      <label key={t.v} className="flex items-center gap-2 text-sm cursor-pointer">
                        <RadioGroupItem value={t.v} id={`terms-${t.v}`} />
                        {t.l}
                      </label>
                    ))}
                  </RadioGroup>
                  {invoiceTerms === 'custom' && (
                    <Input
                      className="mt-2"
                      value={invoiceCustomTerms}
                      onChange={e => setInvoiceCustomTerms(e.target.value)}
                      placeholder="e.g. Net 45, 50% deposit due at signing"
                    />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Due Date</Label>
                  <Input type="date" value={invoiceDueDate} onChange={e => setInvoiceDueDate(e.target.value)} />
                </div>
                <div>
                  <Label>Internal Notes</Label>
                  <Input value={invoiceNotes} onChange={e => setInvoiceNotes(e.target.value)} placeholder="Optional internal notes" />
                </div>
              </div>

              <div>
                <Label>Customer Memo</Label>
                <Textarea
                  value={customerMemo}
                  onChange={e => setCustomerMemo(e.target.value)}
                  placeholder="Message shown to the customer on the invoice"
                  rows={4}
                />
              </div>
            </div>


            {/* Remaining-balance override gate */}
            {!remainingValidation.ok && (
              <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-yellow-700 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 text-xs">
                    <p className="font-medium text-yellow-800">
                      Invoice total exceeds the remaining unpaid balance
                      ({formatCurrency(remainingInvoiceBalance)}) by{' '}
                      {formatCurrency((remainingValidation as { overBy: number }).overBy)}.
                    </p>
                    <p className="text-yellow-700 mt-0.5">
                      Toggle the override below to confirm you intentionally
                      want to bill above the contract's remaining balance.
                    </p>
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-yellow-800">
                  <input
                    type="checkbox"
                    checked={overrideRemaining}
                    onChange={(e) => setOverrideRemaining(e.target.checked)}
                    className="h-4 w-4 cursor-pointer"
                  />
                  Override remaining balance limit
                </label>
              </div>
            )}

            <DialogFooter>
              <Button
                onClick={() => createInvoiceMutation.mutate()}
                disabled={
                  createInvoiceMutation.isPending ||
                  invoiceSubtotal <= 0 ||
                  !remainingValidation.ok
                }
              >
                {createInvoiceMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                Create Invoice — {formatCurrency(invoiceGrandTotal)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
          <DialogTrigger asChild>
            <Button size="sm" className="flex-1">
              <DollarSign className="h-4 w-4 mr-1" />
              Record Payment
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Record Payment</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Payment context summary */}
              <div className="grid grid-cols-3 gap-2 p-3 bg-muted/50 rounded-lg">
                <div>
                  <p className="text-[10px] text-muted-foreground">Contract</p>
                  <p className="text-xs font-bold">{formatCurrency(sellingPrice)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Paid</p>
                  <p className="text-xs font-bold text-green-600">{formatCurrency(totalPaid)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Remaining</p>
                  <p className={cn("text-xs font-bold", contractBalance > 0 ? "text-yellow-600" : "text-green-600")}>
                    {formatCurrency(contractBalance)}
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <Label>Amount</Label>
                  <Input type="number" step="0.01" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} placeholder="0.00" />
                </div>
                {contractBalance > 0 && (
                  <div className="flex items-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 text-xs whitespace-nowrap"
                      onClick={() => setPaymentAmount(String(contractBalance.toFixed(2)))}
                    >
                      Bill Remaining
                    </Button>
                  </div>
                )}
              </div>

              {/* Scan button */}
              <div>
                <input
                  ref={scanInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleScanPayment(file);
                    e.target.value = '';
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={scanningPayment}
                  onClick={() => scanInputRef.current?.click()}
                >
                  {scanningPayment ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Camera className="h-4 w-4 mr-2" />
                  )}
                  {scanningPayment ? 'Scanning...' : 'Scan Check / Receipt'}
                </Button>
              </div>

              <div>
                <Label>Payment Method</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="ach">ACH</SelectItem>
                    <SelectItem value="zelle">Zelle</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="financing">Financing</SelectItem>
                    <SelectItem value="quickbooks">QuickBooks</SelectItem>
                    <SelectItem value="bank_account">Bank Account</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* QuickBooks connection hint */}
              {paymentMethod === 'quickbooks' && !qboConnection && (
                <div className="flex items-center gap-2 p-2 bg-yellow-500/10 rounded text-xs text-yellow-700">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>Connected to QuickBooks (Realm: {qboConnection.realm_id})</span>

                  <span>Connected to QuickBooks (Realm: {qboConnection.realm_id})</span>
                </div>
              )}

              <div>
                <Label>Date</Label>
                <Input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} />
              </div>
              <div>
                <Label>Reference #</Label>
                <Input value={paymentRef} onChange={e => setPaymentRef(e.target.value)} placeholder="Check #, confirmation, etc." />
              </div>
              {openInvoices.length > 0 && (
                <div>
                  <Label>Apply to Invoice</Label>
                  <Select value={selectedInvoiceId || 'none'} onValueChange={v => setSelectedInvoiceId(v === 'none' ? null : v)}>
                    <SelectTrigger><SelectValue placeholder="None (general payment)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None (general payment)</SelectItem>
                      {openInvoices.map(inv => (
                        <SelectItem key={inv.id} value={inv.id}>
                          {inv.invoice_number} — {formatCurrency(Number(inv.balance))} due
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label>Notes</Label>
                <Input value={paymentNotes} onChange={e => setPaymentNotes(e.target.value)} placeholder="Optional notes" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => recordPaymentMutation.mutate()} disabled={recordPaymentMutation.isPending}>
                {recordPaymentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CreditCard className="h-4 w-4 mr-1" />}
                Record
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Separator />

      {/* Invoices List */}
      <div>
        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Receipt className="h-4 w-4" />
          Invoices ({(invoices || []).length})
        </h4>

        {/* Contract context bar — always visible so totals are clear next to invoices */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 p-3 rounded-lg border bg-muted/30 text-xs">
          <div>
            <p className="text-muted-foreground">Contract Total</p>
            <p className="font-semibold text-sm">{formatCurrency(Number(sellingPrice) || 0)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Invoiced</p>
            <p className="font-semibold text-sm">
              {formatCurrency((invoices || []).reduce((s: number, i: any) => s + Number(i.amount || 0), 0))}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Already Paid</p>
            <p className="font-semibold text-sm text-green-600">{formatCurrency(totalPaid)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Contract Balance</p>
            <p className={cn("font-semibold text-sm", contractBalance > 0 ? "text-red-600" : "text-green-600")}>
              {formatCurrency(contractBalance)}
            </p>
          </div>
        </div>

        {(invoices || []).length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No invoices yet</p>
        ) : (
          <div className="space-y-2">
            {(invoices || []).map(inv => {
              const lineItems = Array.isArray((inv as any).line_items) ? (inv as any).line_items as InvoiceLineItem[] : [];
              const hasLineItems = lineItems.length > 0;
              const isExpanded = expandedInvoices.has(inv.id);
              const pendingZelleLink = (zelleLinks || []).find(
                (zl: any) => zl.invoice_id === inv.id && ['pending', 'pending_verification'].includes(zl.zelle_confirmation_status)
              );
              const customerNotified = pendingZelleLink?.zelle_confirmation_status === 'pending_verification';

              return (
                <div key={inv.id} className="bg-muted/30 rounded-lg overflow-hidden">
                  <div
                    className={cn("flex items-center justify-between p-3", hasLineItems && "cursor-pointer")}
                    onClick={() => hasLineItems && toggleInvoiceExpand(inv.id)}
                  >
                    <div className="flex items-center gap-2">
                      {hasLineItems && (
                        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                      )}
                      <div>
                        <p className="text-sm font-medium">{inv.invoice_number}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(inv.created_at), 'MMM d, yyyy')}
                          {inv.due_date && ` · Due ${format(new Date(inv.due_date), 'MMM d')}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Payment link actions */}
                      {inv.status !== 'paid' && inv.status !== 'void' && Number(inv.balance) > 0 && (
                        <>
                          {/* Confirm Zelle payment */}
                          {pendingZelleLink && (
                            <Button
                              variant={customerNotified ? "default" : "outline"}
                              size="sm"
                              className={cn("h-7 text-xs", customerNotified && "animate-pulse")}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleConfirmZellePayment(pendingZelleLink, inv);
                              }}
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              {customerNotified ? '⚡ Customer Paid — Confirm' : 'Confirm Zelle'}
                            </Button>
                          )}
                          {/* Payment link dropdown */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={generatingLinkForInvoice === inv.id}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {generatingLinkForInvoice === inv.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (inv as any).stripe_payment_link_url ? (
                                  <Copy className="h-3.5 w-3.5 text-primary" />
                                ) : (
                                  <Link2 className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                              {(inv as any).stripe_payment_link_url ? (
                                <>
                                  <DropdownMenuItem onClick={() => {
                                    window.open((inv as any).stripe_payment_link_url, '_blank', 'noopener,noreferrer');
                                  }}>
                                    <ExternalLink className="h-4 w-4 mr-2" />
                                    Open Stripe Link
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => {
                                    navigator.clipboard.writeText((inv as any).stripe_payment_link_url);
                                    toast.success('Stripe link copied!');
                                  }}>
                                    <Copy className="h-4 w-4 mr-2" />
                                    Copy Stripe Link
                                  </DropdownMenuItem>
                                </>
                              ) : (
                                <DropdownMenuItem onClick={() => handleSendPaymentLink(inv)}>
                                  <CreditCard className="h-4 w-4 mr-2" />
                                  Create Stripe Payment Link
                                </DropdownMenuItem>
                              )}
                              {zelleEnabled && (
                                <DropdownMenuItem onClick={() => {
                                  if (pendingZelleLink) {
                                    const url = `${window.location.origin}/pay/${pendingZelleLink.shareable_token}`;
                                    navigator.clipboard.writeText(url);
                                    toast.success('Zelle link copied!');
                                  } else {
                                    handleSendZelleLink(inv);
                                  }
                                }}>
                                  <DollarSign className="h-4 w-4 mr-2" />
                                  {pendingZelleLink ? 'Copy Zelle Link' : 'Zelle Payment Link'}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>

                          </DropdownMenu>
                        </>
                      )}
                      <div className="text-right">
                        <p className="text-sm font-medium">{formatCurrency(Number(inv.amount))}</p>
                        {Number(inv.balance) !== Number(inv.amount) && (
                          <p className="text-xs text-muted-foreground">Bal: {formatCurrency(Number(inv.balance))}</p>
                        )}
                      </div>
                      <Badge variant="outline" className={cn("text-xs", statusConfig[inv.status]?.className)}>
                        {statusConfig[inv.status]?.label || inv.status}
                      </Badge>
                      <div onClick={(e) => e.stopPropagation()}>
                        <InvoiceEmailActions
                          invoiceId={inv.id}
                          tenantId={activeTenantId!}
                          projectId={(inv as any).project_id ?? null}
                          invoiceLabel={inv.invoice_number}
                          isVoid={inv.status === 'void'}
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => { e.stopPropagation(); openEditInvoice(inv); }}
                        title="Edit invoice"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        disabled={deletingInvoiceId === inv.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          const paid = Number(inv.amount) - Number(inv.balance);
                          if (paid > 0) {
                            toast.error('Cannot delete an invoice with payments applied. Void it instead.');
                            return;
                          }
                          if (confirm(`Delete invoice ${inv.invoice_number}? This cannot be undone.`)) {
                            setDeletingInvoiceId(inv.id);
                            deleteInvoiceMutation.mutate(inv);
                          }
                        }}
                        title="Delete invoice"
                      >
                        {deletingInvoiceId === inv.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                  {hasLineItems && isExpanded && (
                    <div className="px-3 pb-3 border-t border-border/50">
                      <div className="mt-2 space-y-1">
                        {lineItems.map((li: any, idx) => {
                          const q = Number(li.qty ?? li.quantity) || 0;
                          const u = Number(li.unit_cost ?? li.unit_price ?? li.price ?? li.rate) || 0;
                          const lt = Number(li.line_total ?? li.total ?? li.amount) || (q * u);
                          return (
                            <div key={idx} className="flex justify-between text-xs py-0.5">
                              <span className="text-muted-foreground truncate mr-2">{safeText(li.description)}</span>
                              <span className="font-medium whitespace-nowrap">
                                {q} {li.unit || 'ea'} × {formatCurrency(u)} = {formatCurrency(lt)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Separator />

      {/* Payment History */}
      <div>
        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <CreditCard className="h-4 w-4" />
          Payment History ({(payments || []).length})
        </h4>
        {(payments || []).length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No payments recorded</p>
        ) : (
          <div className="space-y-2">
            {(payments || []).map(pmt => (
              <div key={pmt.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-green-600">+{formatCurrency(Number(pmt.amount))}</p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(pmt.payment_date), 'MMM d, yyyy')}
                    {pmt.payment_method && ` · ${pmt.payment_method}`}
                    {pmt.reference_number && ` · Ref: ${pmt.reference_number}`}
                  </p>
                </div>
                {pmt.notes && (
                  <p className="text-xs text-muted-foreground max-w-[150px] truncate">{pmt.notes}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {/* Edit Invoice Dialog */}
      <Dialog open={!!editingInvoice} onOpenChange={(open) => !open && setEditingInvoice(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Invoice {editingInvoice?.invoice_number}</DialogTitle>
          </DialogHeader>
          {editingInvoice && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Due Date</Label>
                  <Input
                    type="date"
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Notes</Label>
                  <Input
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Optional notes"
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs mb-2 block">Line Items</Label>
                <div className="space-y-2">
                  {editLineItems.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center p-2 border rounded-md">
                      <Input
                        className="col-span-5 h-8 text-xs"
                        value={item.description}
                        onChange={(e) => updateEditItem(idx, { description: e.target.value })}
                        placeholder="Description"
                      />
                      <Input
                        type="number"
                        step="0.01"
                        className="col-span-2 h-8 text-xs"
                        value={item.qty}
                        onChange={(e) => updateEditItem(idx, { qty: parseFloat(e.target.value) || 0 })}
                        placeholder="Qty"
                      />
                      <Input
                        className="col-span-1 h-8 text-xs"
                        value={item.unit}
                        onChange={(e) => updateEditItem(idx, { unit: e.target.value })}
                        placeholder="Unit"
                      />
                      <Input
                        type="number"
                        step="0.01"
                        className="col-span-2 h-8 text-xs"
                        value={item.unit_cost}
                        onChange={(e) => updateEditItem(idx, { unit_cost: parseFloat(e.target.value) || 0 })}
                        placeholder="Price"
                      />
                      <div className="col-span-1 text-xs text-right font-medium">
                        {formatCurrency(item.line_total)}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="col-span-1 h-7 w-7 text-destructive"
                        onClick={() => removeEditItem(idx)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() =>
                      setEditLineItems((prev) => [
                        ...prev,
                        { description: '', qty: 1, unit: 'ea', unit_cost: 0, line_total: 0 },
                      ])
                    }
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Line Item
                  </Button>
                </div>
              </div>

              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">New Total</span>
                <span className="text-lg font-bold">{formatCurrency(editInvoiceTotal)}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingInvoice(null)}>Cancel</Button>
            <Button
              onClick={() => updateInvoiceMutation.mutate()}
              disabled={updateInvoiceMutation.isPending || editInvoiceTotal <= 0}
            >
              {updateInvoiceMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

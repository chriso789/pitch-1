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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger 
} from '@/components/ui/dialog';
import { 
  DollarSign, Plus, CreditCard, FileText, Loader2, Receipt, ChevronDown, Trash2, Copy, Link2, CheckCircle2, Camera, Building2, AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { 
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';

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

  // Invoice builder state
  const [invoiceLineItems, setInvoiceLineItems] = useState<(InvoiceLineItem & { selected: boolean })[]>([]);
  const [invoiceDueDate, setInvoiceDueDate] = useState('');
  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());

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

    if (source === 'enhanced') {
      // enhanced_estimates: { materials: [...], labor: [...] }
      if (Array.isArray(lineItems.materials)) {
        lineItems.materials.forEach((mat: any) => {
          items.push({
            selected: true,
            description: mat.item_name || mat.description || 'Material',
            qty: Number(mat.qty) || 1,
            unit: mat.unit || 'ea',
            unit_cost: Number(mat.unit_cost) || 0,
            line_total: Number(mat.line_total) || 0,
          });
        });
      }
      if (Array.isArray(lineItems.labor)) {
        lineItems.labor.forEach((lab: any) => {
          items.push({
            selected: true,
            description: lab.item_name || lab.description || 'Labor',
            qty: Number(lab.qty) || 1,
            unit: lab.unit || 'ea',
            unit_cost: Number(lab.unit_cost) || 0,
            line_total: Number(lab.line_total) || 0,
          });
        });
      }
    } else {
      // legacy estimates: could be array of items or { materials, labor }
      if (Array.isArray(lineItems)) {
        lineItems.forEach((item: any) => {
          items.push({
            selected: true,
            description: item.item_name || item.description || item.name || 'Item',
            qty: Number(item.qty || item.quantity) || 1,
            unit: item.unit || 'ea',
            unit_cost: Number(item.unit_cost || item.price || item.rate) || 0,
            line_total: Number(item.line_total || item.total || item.amount) || (Number(item.qty || item.quantity || 1) * Number(item.unit_cost || item.price || item.rate || 0)),
          });
        });
      } else if (typeof lineItems === 'object') {
        // Same nested format as enhanced
        ['materials', 'labor', 'items'].forEach(key => {
          if (Array.isArray(lineItems[key])) {
            lineItems[key].forEach((item: any) => {
              items.push({
                selected: true,
                description: item.item_name || item.description || item.name || key,
                qty: Number(item.qty || item.quantity) || 1,
                unit: item.unit || 'ea',
                unit_cost: Number(item.unit_cost || item.price || item.rate) || 0,
                line_total: Number(item.line_total || item.total || item.amount) || (Number(item.qty || item.quantity || 1) * Number(item.unit_cost || item.price || item.rate || 0)),
              });
            });
          }
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

  const invoiceSubtotal = useMemo(() => 
    invoiceLineItems.filter(i => i.selected).reduce((sum, i) => sum + i.line_total, 0),
    [invoiceLineItems]
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

  const totalPaid = (payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
  const contractBalance = sellingPrice - totalPaid;

  // Auto-populate invoice from latest estimate when dialog opens.
  // First invoice (no payments / no prior invoices) = full estimate.
  // Otherwise scale lines so invoice = contract − payments − outstanding invoiced.
  useEffect(() => {
    if (!showInvoiceDialog) return;

    const enhancedEst = (enhancedEstimates || [])[0];
    const legacyEst = (legacyEstimates || [])[0];
    const baseItems = enhancedEst?.line_items
      ? parseLineItems(enhancedEst, 'enhanced')
      : legacyEst?.line_items
        ? parseLineItems(legacyEst, 'legacy')
        : [];

    if (baseItems.length === 0) {
      setInvoiceLineItems([]);
      return;
    }

    const estimateTotal = baseItems.reduce((s, i) => s + i.line_total, 0);
    const paidSoFar = (payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
    const outstandingInvoiced = (invoices || [])
      .filter((inv: any) => inv.status !== 'void')
      .reduce((s: number, inv: any) => s + Number(inv.balance ?? inv.amount ?? 0), 0);

    const remaining = Math.max(0, sellingPrice - paidSoFar - outstandingInvoiced);
    const scale =
      remaining > 0 && estimateTotal > 0 && remaining < estimateTotal
        ? remaining / estimateTotal
        : 1;

    const scaled = baseItems.map((item) => {
      if (scale === 1) return item;
      const newTotal = Math.round(item.line_total * scale * 100) / 100;
      const qty = Number(item.qty) || 1;
      const newUnitCost = qty > 0 ? Math.round((newTotal / qty) * 100) / 100 : item.unit_cost;
      return { ...item, unit_cost: newUnitCost, line_total: newTotal };
    });

    setInvoiceLineItems(scaled);
  }, [showInvoiceDialog, enhancedEstimates, legacyEstimates, payments, invoices, sellingPrice]);

  const createInvoiceMutation = useMutation({
    mutationFn: async () => {
      const selectedItems = invoiceLineItems.filter(i => i.selected);
      if (selectedItems.length === 0) throw new Error('Select at least one line item');
      
      const amount = selectedItems.reduce((sum, i) => sum + i.line_total, 0);
      if (amount <= 0) throw new Error('Invoice total must be greater than zero');

      // Get auth user directly to avoid profile mismatch
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const invoiceCount = (invoices || []).length + 1;
      const invoiceNumber = `INV-${pipelineEntryId.slice(0, 6).toUpperCase()}-${String(invoiceCount).padStart(3, '0')}`;
      
      const lineItemsPayload: InvoiceLineItem[] = selectedItems.map(({ selected: _selected, ...item }) => item);

      const { error } = await supabase.from('project_invoices').insert({
        tenant_id: activeTenantId!,
        pipeline_entry_id: pipelineEntryId,
        invoice_number: invoiceNumber,
        amount,
        balance: amount,
        status: 'draft',
        due_date: invoiceDueDate || null,
        notes: invoiceNotes || null,
        created_by: user.id,
        line_items: lineItemsPayload as any,
      });
      if (error) {
        console.error('Invoice creation error:', error);
        throw new Error(error.message || 'Failed to create invoice');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-ar-invoices', pipelineEntryId] });
      setShowInvoiceDialog(false);
      setInvoiceNotes('');
      setInvoiceDueDate('');
      toast.success('Invoice created');
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create invoice'),
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(paymentAmount);
      if (isNaN(amount) || amount <= 0) throw new Error('Invalid amount');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

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
      });
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
      setShowPaymentDialog(false);
      setPaymentAmount('');
      setPaymentRef('');
      setPaymentNotes('');
      setSelectedInvoiceId(null);
      toast.success('Payment recorded');
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to record payment'),
  });

  const updateLineItem = (index: number, field: keyof InvoiceLineItem, value: any) => {
    setInvoiceLineItems(prev => {
      const updated = [...prev];
      (updated[index] as any)[field] = value;
      if (field === 'qty' || field === 'unit_cost') {
        updated[index].line_total = Number(updated[index].qty) * Number(updated[index].unit_cost);
      }
      return updated;
    });
  };

  const toggleLineItem = (index: number) => {
    setInvoiceLineItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], selected: !updated[index].selected };
      return updated;
    });
  };

  const addCustomLineItem = () => {
    setInvoiceLineItems(prev => [...prev, {
      selected: true,
      description: '',
      qty: 1,
      unit: 'ea',
      unit_cost: 0,
      line_total: 0,
    }]);
  };

  const removeLineItem = (index: number) => {
    setInvoiceLineItems(prev => prev.filter((_, i) => i !== index));
  };

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

              {/* Line Items Table */}
              <div>
                <Label className="text-sm font-semibold">Line Items</Label>
                {invoiceLineItems.length === 0 && (
                  <p className="text-sm text-muted-foreground py-3">No estimate found. Add line items manually.</p>
                )}
                <div className="mt-2 space-y-1">
                  {/* Header */}
                  {invoiceLineItems.length > 0 && (
                    <div className="grid grid-cols-[28px_1fr_60px_60px_80px_90px_28px] gap-1 text-xs font-medium text-muted-foreground px-1">
                      <div></div>
                      <div>Description</div>
                      <div className="text-right">Qty</div>
                      <div>Unit</div>
                      <div className="text-right">Cost</div>
                      <div className="text-right">Total</div>
                      <div></div>
                    </div>
                  )}
                  {invoiceLineItems.map((item, idx) => (
                    <div key={idx} className={cn(
                      "grid grid-cols-[28px_1fr_60px_60px_80px_90px_28px] gap-1 items-center px-1 py-1 rounded",
                      !item.selected && "opacity-50"
                    )}>
                      <Checkbox
                        checked={item.selected}
                        onCheckedChange={() => toggleLineItem(idx)}
                      />
                      <Input
                        value={item.description}
                        onChange={e => updateLineItem(idx, 'description', e.target.value)}
                        className="h-8 text-xs"
                        placeholder="Description"
                      />
                      <Input
                        type="number"
                        value={item.qty}
                        onChange={e => updateLineItem(idx, 'qty', parseFloat(e.target.value) || 0)}
                        className="h-8 text-xs text-right"
                      />
                      <Input
                        value={item.unit}
                        onChange={e => updateLineItem(idx, 'unit', e.target.value)}
                        className="h-8 text-xs"
                      />
                      <Input
                        type="number"
                        value={item.unit_cost}
                        onChange={e => updateLineItem(idx, 'unit_cost', parseFloat(e.target.value) || 0)}
                        className="h-8 text-xs text-right"
                        step="0.01"
                      />
                      <p className="text-xs text-right font-medium">{formatCurrency(item.line_total)}</p>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeLineItem(idx)}>
                        <Trash2 className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button variant="ghost" size="sm" className="mt-2 text-xs" onClick={addCustomLineItem}>
                  <Plus className="h-3 w-3 mr-1" /> Add Line Item
                </Button>
              </div>

              <Separator />

              {/* Subtotal */}
              <div className="flex justify-end">
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Invoice Total</p>
                  <p className="text-lg font-bold">{formatCurrency(invoiceSubtotal)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Due Date</Label>
                  <Input type="date" value={invoiceDueDate} onChange={e => setInvoiceDueDate(e.target.value)} />
                </div>
                <div>
                  <Label>Notes</Label>
                  <Input value={invoiceNotes} onChange={e => setInvoiceNotes(e.target.value)} placeholder="Optional notes" />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button 
                onClick={() => createInvoiceMutation.mutate()} 
                disabled={createInvoiceMutation.isPending || invoiceSubtotal <= 0}
              >
                {createInvoiceMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                Create Invoice — {formatCurrency(invoiceSubtotal)}
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
                  <span>
                    QuickBooks not connected.{' '}
                    <a href="/settings" className="underline font-medium">Connect in Settings</a>
                  </span>
                </div>
              )}

              {paymentMethod === 'quickbooks' && qboConnection && (
                <div className="flex items-center gap-2 p-2 bg-green-500/10 rounded text-xs text-green-700">
                  <Building2 className="h-4 w-4 flex-shrink-0" />
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
                              <DropdownMenuItem onClick={() => {
                                if ((inv as any).stripe_payment_link_url) {
                                  navigator.clipboard.writeText((inv as any).stripe_payment_link_url);
                                  toast.success('Stripe link copied!');
                                } else {
                                  handleSendPaymentLink(inv);
                                }
                              }}>
                                <CreditCard className="h-4 w-4 mr-2" />
                                {(inv as any).stripe_payment_link_url ? 'Copy Stripe Link' : 'Stripe Payment Link'}
                              </DropdownMenuItem>
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
                    </div>
                  </div>
                  {hasLineItems && isExpanded && (
                    <div className="px-3 pb-3 border-t border-border/50">
                      <div className="mt-2 space-y-1">
                        {lineItems.map((li, idx) => (
                          <div key={idx} className="flex justify-between text-xs py-0.5">
                            <span className="text-muted-foreground truncate mr-2">{li.description}</span>
                            <span className="font-medium whitespace-nowrap">
                              {li.qty} {li.unit} × {formatCurrency(li.unit_cost)} = {formatCurrency(li.line_total)}
                            </span>
                          </div>
                        ))}
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
    </div>
  );
};

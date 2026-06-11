import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Loader2, DollarSign, Package, Hammer, Receipt, TrendingUp, FilePlus2,
  ShieldCheck, FileCheck2, Share2, CheckCircle2, FileText,
} from 'lucide-react';
import { PaymentsTab } from './PaymentsTab';
import { useCompanyInfo } from '@/hooks/useCompanyInfo';
import { generateCloseoutDocuments } from '@/lib/closeout/closeoutPdfGenerator';
import { ShareDocumentDialog } from '@/components/documents/ShareDocumentDialog';
import { toast } from 'sonner';
import { format } from 'date-fns';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

interface TotalsTabProps {
  pipelineEntryId: string;
}

function computeCoBudget(co: any): number {
  const container: any = co?.line_items || {};
  const items: any[] = Array.isArray(container.items) ? container.items : [];
  let material = 0;
  let labor = 0;
  for (const it of items) {
    const qty = Number(it.quantity ?? it.qty ?? 1);
    const price = Number(it.unit_price ?? it.price ?? it.rate ?? 0);
    const total = Number(it.line_total ?? it.total ?? qty * price) || 0;
    const cat = String(it.category ?? it.type ?? it.kind ?? 'material').toLowerCase();
    if (cat.startsWith('lab')) labor += total;
    else if (cat.startsWith('over')) {/* overhead handled via pct */}
    else material += total;
  }
  const overheadPct = Number(container.overhead_pct ?? 10);
  const profitPct = Number(container.profit_pct ?? 25);
  const cost = material + labor;
  const denom = Math.max(0.01, 1 - (overheadPct / 100) - (profitPct / 100));
  const selling = cost > 0 ? cost / denom : 0;
  return Math.max(Number(co?.cost_impact || 0), selling);
}

const APPROVED_STATUSES = new Set(['approved', 'invoiced', 'completed']);

interface CloseoutDoc {
  documentId: string;
  filename: string;
  label: string;
  filePath?: string;
}


export const TotalsTab: React.FC<TotalsTabProps> = ({ pipelineEntryId }) => {
  const { activeTenantId } = useActiveTenantId();
  const { data: companyInfo } = useCompanyInfo();
  const queryClient = useQueryClient();

  const [closeoutOpen, setCloseoutOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [closeoutDocs, setCloseoutDocs] = useState<CloseoutDoc[]>([]);
  const [customerInfo, setCustomerInfo] = useState<{ name: string; email: string; contactId: string | null }>({
    name: '', email: '', contactId: null,
  });
  const [shareDoc, setShareDoc] = useState<CloseoutDoc | null>(null);

  const { data: barData, isLoading: barLoading } = useQuery({
    queryKey: ['totals-bar-data', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('api_estimate_hyperlink_bar', {
        p_pipeline_entry_id: pipelineEntryId,
      });
      if (error) throw error;
      return data as {
        materials: number;
        labor: number;
        sale_price: number;
        base_sale_price?: number;
        change_orders_total?: number;
        sales_tax_amount: number;
      } | null;
    },
    enabled: !!pipelineEntryId,
  });

  const { data: payments } = useQuery({
    queryKey: ['project-ar-payments', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_payments')
        .select('amount, payment_date, payment_method, reference_number')
        .eq('pipeline_entry_id', pipelineEntryId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!pipelineEntryId,
  });

  const { data: changeOrders } = useQuery({
    queryKey: ['totals-change-orders', pipelineEntryId, activeTenantId],
    queryFn: async () => {
      const { data: projects } = await supabase
        .from('projects')
        .select('id')
        .eq('pipeline_entry_id', pipelineEntryId);
      const projectIds = (projects || []).map((p: any) => p.id);
      if (projectIds.length === 0) return [];
      const { data, error } = await (supabase as any)
        .from('change_orders')
        .select('id, co_number, title, status, cost_impact, customer_approved, line_items, project_id')
        .in('project_id', projectIds);
      if (error) throw error;
      return data || [];
    },
    enabled: !!pipelineEntryId && !!activeTenantId,
  });

  const approvedCOs = (changeOrders || []).filter(
    (co: any) => APPROVED_STATUSES.has(String(co.status || '').toLowerCase()) || co.customer_approved === true
  );
  const approvedCoLocalTotal = approvedCOs.reduce((s: number, co: any) => s + computeCoBudget(co), 0);

  const contractValue = barData?.sale_price ?? 0;
  const baseSellingPrice = barData?.base_sale_price ?? (contractValue - (barData?.change_orders_total ?? 0));
  const coBudgetTotal = barData?.change_orders_total ?? approvedCoLocalTotal;
  const materialCost = barData?.materials ?? 0;
  const laborCost = barData?.labor ?? 0;
  const totalPaid = (payments || []).reduce((s, p) => s + Number(p.amount), 0);
  const balance = contractValue - totalPaid;

  const handleGenerateCloseout = async () => {
    if (!activeTenantId) {
      toast.error('No active tenant');
      return;
    }
    setGenerating(true);
    setCloseoutDocs([]);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      // Load contact/customer for project
      let customer = { name: '', address: '', email: '', phone: '' };
      let contactId: string | null = null;
      try {
        const { data: pe } = await supabase
          .from('pipeline_entries')
          .select('contact_id, contacts!pipeline_entries_contact_id_fkey(first_name,last_name,email,phone,address_street,address_city,address_state,address_zip)')
          .eq('id', pipelineEntryId)
          .maybeSingle();
        contactId = (pe as any)?.contact_id || null;
        const c: any = (pe as any)?.contacts;
        if (c) {
          customer = {
            name: [c.first_name, c.last_name].filter(Boolean).join(' '),
            email: c.email || '',
            phone: c.phone || '',
            address: [
              c.address_street,
              [c.address_city, c.address_state, c.address_zip].filter(Boolean).join(', '),
            ].filter(Boolean).join('\n'),
          };
        }
      } catch (e) {
        console.warn('Could not load contact for closeout', e);
      }
      setCustomerInfo({ name: customer.name, email: customer.email, contactId });

      const result = await generateCloseoutDocuments({
        tenantId: activeTenantId,
        pipelineEntryId,
        userId: user.id,
        company: companyInfo,
        customer,
        contractTotal: contractValue,
        totalPaid: totalPaid || contractValue,
        paymentHistory: (payments || []).map((p: any) => ({
          date: format(new Date(p.payment_date), 'MMM d, yyyy'),
          amount: Number(p.amount) || 0,
          method: p.payment_method || '',
          reference: p.reference_number || '',
        })),
      });

      if (result.error) throw new Error(result.error);

      const docs: CloseoutDoc[] = [];
      if (result.invoiceDocumentId) {
        docs.push({
          documentId: result.invoiceDocumentId,
          filename: result.invoiceFilename,
          label: 'Paid-In-Full Invoice',
          filePath: result.invoicePath,
        });
      }
      if (result.certificateDocumentId) {
        docs.push({
          documentId: result.certificateDocumentId,
          filename: result.certificateFilename,
          label: 'Completion Certificate & Warranty',
          filePath: result.certificatePath,
        });
      }
      setCloseoutDocs(docs);

      queryClient.invalidateQueries({ queryKey: ['documents', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['project-ar-invoices', pipelineEntryId] });
      toast.success('Closeout documents created and saved to Documents');
    } catch (err: any) {
      console.error('Closeout generation failed', err);
      toast.error(err?.message || 'Failed to generate closeout documents');
    } finally {
      setGenerating(false);
    }
  };

  if (barLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-4 w-4 text-primary" />
              <p className="text-xs text-muted-foreground">Contract Value</p>
            </div>
            <p className="text-lg font-bold">{fmt(contractValue)}</p>
            {coBudgetTotal > 0 && (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Base {fmt(baseSellingPrice)} + COs {fmt(coBudgetTotal)}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <FilePlus2 className="h-4 w-4 text-indigo-500" />
              <p className="text-xs text-muted-foreground">Approved COs</p>
            </div>
            <p className="text-lg font-bold">{fmt(coBudgetTotal)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {approvedCOs.length} approved
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-4 w-4 text-blue-500" />
              <p className="text-xs text-muted-foreground">Material Cost</p>
            </div>
            <p className="text-lg font-bold">{fmt(materialCost)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Hammer className="h-4 w-4 text-orange-500" />
              <p className="text-xs text-muted-foreground">Labor Cost</p>
            </div>
            <p className="text-lg font-bold">{fmt(laborCost)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Receipt className="h-4 w-4 text-green-500" />
              <p className="text-xs text-muted-foreground">Total Paid</p>
            </div>
            <p className="text-lg font-bold text-green-600">{fmt(totalPaid)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-red-500" />
              <p className="text-xs text-muted-foreground">Balance Due</p>
            </div>
            <p className={`text-lg font-bold ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {fmt(balance)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Project Closeout */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <ShieldCheck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">Project Closeout</p>
              <p className="text-xs text-muted-foreground">
                Generate a Paid-In-Full Invoice and a Completion Certificate with your workmanship warranty. Both PDFs save to Documents and can be shared with the client.
              </p>
            </div>
          </div>
          <Button
            onClick={() => { setCloseoutOpen(true); setCloseoutDocs([]); }}
            className="whitespace-nowrap"
          >
            <FileCheck2 className="h-4 w-4 mr-2" />
            Generate Closeout Docs
          </Button>
        </CardContent>
      </Card>

      {/* Payments & Invoices */}
      <PaymentsTab pipelineEntryId={pipelineEntryId} sellingPrice={contractValue} />

      {/* Closeout Dialog */}
      <Dialog open={closeoutOpen} onOpenChange={setCloseoutOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Project Closeout Documents
            </DialogTitle>
            <DialogDescription>
              This creates two PDFs and saves them to the project's Documents:
              <span className="block mt-1">• <strong>Paid-In-Full Invoice</strong> — confirms the contract is fully paid.</span>
              <span className="block">• <strong>Completion Certificate</strong> — includes your workmanship warranty.</span>
            </DialogDescription>
          </DialogHeader>

          {closeoutDocs.length === 0 ? (
            <div className="py-4 space-y-3">
              <div className="rounded-md border p-3 bg-muted/30 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Contract Total</span><span className="font-semibold">{fmt(contractValue)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Total Paid</span><span className="font-semibold text-green-600">{fmt(totalPaid)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Balance</span><span className={`font-semibold ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>{fmt(balance)}</span></div>
              </div>
              {balance > 0.01 && (
                <p className="text-xs text-amber-600">
                  Heads up: there is still an outstanding balance of {fmt(balance)}. The documents will still mark the project complete.
                </p>
              )}
            </div>
          ) : (
            <div className="py-2 space-y-2">
              <div className="flex items-center gap-2 text-sm text-green-700">
                <CheckCircle2 className="h-4 w-4" />
                Documents created and saved to Documents.
              </div>
              {closeoutDocs.map((d) => (
                <div key={d.documentId} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 text-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{d.label}</p>
                      <p className="text-xs text-muted-foreground truncate">{d.filename}</p>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setShareDoc(d)}>
                    <Share2 className="h-3.5 w-3.5 mr-1.5" />
                    Share
                  </Button>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            {closeoutDocs.length === 0 ? (
              <>
                <Button variant="outline" onClick={() => setCloseoutOpen(false)} disabled={generating}>Cancel</Button>
                <Button onClick={handleGenerateCloseout} disabled={generating}>
                  {generating ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating...</>
                  ) : (
                    <><FileCheck2 className="h-4 w-4 mr-2" />Generate Documents</>
                  )}
                </Button>
              </>
            ) : (
              <Button onClick={() => setCloseoutOpen(false)}>Done</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share dialog for closeout PDFs */}
      {shareDoc && (
        <ShareDocumentDialog
          open={!!shareDoc}
          onOpenChange={(o) => { if (!o) setShareDoc(null); }}
          documentId={shareDoc.documentId}
          filename={shareDoc.filename}
          defaultRecipientEmail={customerInfo.email}
          defaultRecipientName={customerInfo.name}
          contactId={customerInfo.contactId}
        />
      )}
    </div>
  );
};

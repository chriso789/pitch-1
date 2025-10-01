import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, RefreshCw, FileText } from "lucide-react";
import { toast } from "sonner";

interface QuickBooksInvoiceCardProps {
  projectId: string;
  tenantId: string;
}

interface QBOConnection {
  id: string;
  tenant_id: string;
  realm_id: string;
  is_active: boolean;
}

interface InvoiceMirror {
  id: string;
  tenant_id: string;
  project_id: string;
  qbo_invoice_id: string;
  doc_number: string;
  total_amount: number;
  balance: number;
  qbo_status: string;
  last_qbo_pull_at: string;
}

export function QuickBooksInvoiceCard({ projectId, tenantId }: QuickBooksInvoiceCardProps) {
  const queryClient = useQueryClient();

  // Check if QBO is connected
  const { data: connection } = useQuery<QBOConnection | null>({
    queryKey: ['qbo-connection', tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('qbo_connections')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .maybeSingle();

      if (error) throw error;
      return data as QBOConnection | null;
    },
  });

  // Get invoice AR mirror
  const { data: invoiceMirror, isLoading } = useQuery<InvoiceMirror | null>({
    queryKey: ['invoice-ar-mirror', projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('invoice_ar_mirror')
        .select('*')
        .eq('project_id', projectId)
        .maybeSingle();

      if (error) throw error;
      return data as InvoiceMirror | null;
    },
    enabled: !!connection,
  });

  // Create invoice mutation
  const createInvoice = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('qbo-invoice-create', {
        body: { project_id: projectId, tenant_id: tenantId },
      });

      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: () => {
      toast.success('Invoice created in QuickBooks');
      queryClient.invalidateQueries({ queryKey: ['invoice-ar-mirror', projectId] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to create invoice: ${error.message}`);
    },
  });

  if (!connection) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">QuickBooks Invoice</h3>
            <p className="text-sm text-muted-foreground">
              Connect QuickBooks to create invoices
            </p>
          </div>
          <Button variant="outline" onClick={() => window.location.href = '/settings'}>
            Connect QuickBooks
          </Button>
        </div>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </Card>
    );
  }

  if (!invoiceMirror) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <FileText className="h-5 w-5" />
              QuickBooks Invoice
            </h3>
            <p className="text-sm text-muted-foreground">
              No invoice created yet
            </p>
          </div>
          <Button 
            onClick={() => createInvoice.mutate()}
            disabled={createInvoice.isPending}
          >
            {createInvoice.isPending ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Invoice'
            )}
          </Button>
        </div>
      </Card>
    );
  }

  const qboUrl = `https://app.qbo.intuit.com/app/invoice?txnId=${invoiceMirror.qbo_invoice_id}`;

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <FileText className="h-5 w-5" />
            QuickBooks Invoice
          </h3>
          <Badge variant={invoiceMirror.balance > 0 ? "default" : "secondary"}>
            {invoiceMirror.qbo_status}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Invoice Number</p>
            <p className="text-lg font-semibold">{invoiceMirror.doc_number}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Total Amount</p>
            <p className="text-lg font-semibold">
              ${invoiceMirror.total_amount?.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Balance Due</p>
            <p className={`text-lg font-semibold ${
              invoiceMirror.balance > 0 ? 'text-destructive' : 'text-success'
            }`}>
              ${invoiceMirror.balance?.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Last Synced</p>
            <p className="text-sm">
              {new Date(invoiceMirror.last_qbo_pull_at).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => window.open(qboUrl, '_blank')}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            View & Pay Online in QuickBooks
          </Button>
        </div>
        
        <p className="text-xs text-muted-foreground">
          QBO Payments enabled • Customer can pay via credit card or ACH
        </p>
      </div>
    </Card>
  );
}

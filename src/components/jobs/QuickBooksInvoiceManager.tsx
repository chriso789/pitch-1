import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ExternalLink, DollarSign, CreditCard, Building2 } from "lucide-react";

interface QuickBooksInvoiceManagerProps {
  jobId: string;
  tenantId: string;
  contactId: string;
}

interface InvoiceARMirror {
  id: string;
  qbo_invoice_id: string;
  doc_number: string;
  total_amount: number;
  balance: number;
  qbo_status: string;
  last_qbo_pull_at: string;
}

interface QBOConnection {
  realm_id: string;
  is_active: boolean;
  qbo_company_name: string;
}

export function QuickBooksInvoiceManager({ jobId, tenantId, contactId }: QuickBooksInvoiceManagerProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceARMirror[]>([]);
  const [qboConnection, setQboConnection] = useState<QBOConnection | null>(null);
  const [customerRef, setCustomerRef] = useState<string>("");

  useEffect(() => {
    loadData();
  }, [jobId]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load QBO connection
      const { data: conn } = await supabase
        .from("qbo_connections")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .single();

      if (conn) {
        setQboConnection(conn);

        // Load invoices
        const { data: invs } = await supabase
          .from("invoice_ar_mirror")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("realm_id", conn.realm_id)
          .order("created_at", { ascending: false });

        if (invs) setInvoices(invs);

        // Get customer QBO ID from contact
        const { data: mapping } = await supabase
          .from("qbo_entity_mapping")
          .select("qbo_entity_id")
          .eq("tenant_id", tenantId)
          .eq("entity_type", "contact")
          .eq("entity_id", contactId)
          .single();

        if (mapping) setCustomerRef(mapping.qbo_entity_id);
      }
    } catch (error) {
      console.error("Error loading QBO data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateInvoice = async () => {
    if (!qboConnection || !customerRef) {
      toast({
        title: "Missing Requirements",
        description: "Contact must be synced to QuickBooks first",
        variant: "destructive",
      });
      return;
    }

    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("qbo-worker", {
        body: {
          op: "createInvoiceFromEstimates",
          args: {
            tenant_id: tenantId,
            realm_id: qboConnection.realm_id,
            job_id: jobId,
            customer_ref: customerRef,
          },
        },
      });

      if (error) throw error;

      if (data?.success) {
        toast({
          title: "Invoice Created",
          description: `Invoice ${data.doc_number} created in QuickBooks`,
        });
        loadData();
      } else {
        throw new Error(data?.message || "Failed to create invoice");
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleTogglePayments = async (invoiceId: string, allowCC: boolean, allowACH: boolean, sendEmail: boolean = false) => {
    if (!qboConnection) return;

    try {
      const { data, error } = await supabase.functions.invoke("qbo-worker", {
        body: {
          op: "toggleOnlinePayments",
          args: {
            tenant_id: tenantId,
            realm_id: qboConnection.realm_id,
            qbo_invoice_id: invoiceId,
            allow_credit_card: allowCC,
            allow_ach: allowACH,
            send_email: sendEmail,
          },
        },
      });

      if (error) throw error;

      if (data?.success) {
        toast({
          title: "Updated",
          description: sendEmail ? "Settings saved and email sent" : "Payment settings updated",
        });
        loadData();
      } else {
        throw new Error(data?.message || "Failed to update");
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  if (!qboConnection) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>QuickBooks Integration</CardTitle>
          <CardDescription>Connect to QuickBooks to create invoices</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Go to Settings → QuickBooks to connect your account
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>QuickBooks Invoices</span>
            <Button onClick={handleCreateInvoice} disabled={creating || !customerRef}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <DollarSign className="h-4 w-4 mr-2" />}
              Create Invoice from Estimates
            </Button>
          </CardTitle>
          <CardDescription>
            Connected to {qboConnection.qbo_company_name}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No invoices created yet
            </p>
          ) : (
            invoices.map((invoice) => (
              <Card key={invoice.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">Invoice #{invoice.doc_number}</CardTitle>
                      <CardDescription className="flex items-center gap-2 mt-1">
                        <Badge variant={invoice.balance === 0 ? "default" : "secondary"}>
                          {invoice.qbo_status}
                        </Badge>
                        <span className="text-xs">
                          Last synced: {new Date(invoice.last_qbo_pull_at).toLocaleDateString()}
                        </span>
                      </CardDescription>
                    </div>
                    <a
                      href={`https://app.qbo.intuit.com/app/invoice?txnId=${invoice.qbo_invoice_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline flex items-center gap-1"
                    >
                      View in QBO <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Total</p>
                      <p className="font-semibold">${invoice.total_amount.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Balance</p>
                      <p className="font-semibold">${invoice.balance.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Paid</p>
                      <p className="font-semibold">${(invoice.total_amount - invoice.balance).toFixed(2)}</p>
                    </div>
                  </div>

                  <div className="border-t pt-4">
                    <p className="text-sm font-medium mb-3">Online Payment Options</p>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label htmlFor={`cc-${invoice.id}`} className="flex items-center gap-2">
                          <CreditCard className="h-4 w-4" />
                          Allow Credit Card Payments
                        </Label>
                        <Switch
                          id={`cc-${invoice.id}`}
                          defaultChecked={false}
                          onCheckedChange={(checked) => handleTogglePayments(invoice.qbo_invoice_id, checked, false)}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor={`ach-${invoice.id}`} className="flex items-center gap-2">
                          <Building2 className="h-4 w-4" />
                          Allow ACH (Bank) Payments
                        </Label>
                        <Switch
                          id={`ach-${invoice.id}`}
                          defaultChecked={false}
                          onCheckedChange={(checked) => handleTogglePayments(invoice.qbo_invoice_id, false, checked)}
                        />
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-4"
                      onClick={() => handleTogglePayments(invoice.qbo_invoice_id, true, true, true)}
                    >
                      Enable Payments & Send Email
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

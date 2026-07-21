import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, ExternalLink, DollarSign, RefreshCcw, Copy, CheckCircle2, AlertTriangle, CreditCard,
} from "lucide-react";

interface QuickBooksInvoiceManagerProps {
  projectId: string;
  tenantId: string;
}

interface InvoiceRow {
  id: string;
  qbo_invoice_id: string;
  doc_number: string | null;
  total_amount: number;
  balance: number;
  tax_amount: number | null;
  qbo_status: string | null;
  email_status: string | null;
  invoice_link: string | null;
  invoice_link_status: string | null;
  invoice_link_source: string | null;
  invoice_link_verified_at: string | null;
  online_card_enabled: boolean | null;
  online_ach_enabled: boolean | null;
  invoice_type: string | null;
  txn_date: string | null;
  due_date: string | null;
  paid_at: string | null;
  last_synced_at: string | null;
  last_qbo_pull_at: string | null;
  last_sync_error: string | null;
}

interface QBOConnection {
  realm_id: string;
  is_active: boolean;
  qbo_company_name: string | null;
  is_sandbox: boolean;
}

const INVOICE_TYPE_OPTIONS = [
  { value: "deposit", label: "Deposit" },
  { value: "progress", label: "Progress Draw" },
  { value: "change_order", label: "Change Order" },
  { value: "supplement", label: "Supplement" },
  { value: "final", label: "Final Invoice" },
  { value: "other", label: "Other" },
];

const money = (n: number) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function QuickBooksInvoiceManager({ projectId, tenantId }: QuickBooksInvoiceManagerProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [invoiceType, setInvoiceType] = useState<string>("progress");
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [connection, setConnection] = useState<QBOConnection | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: conn } = await supabase
        .from("qbo_connections")
        .select("realm_id, is_active, qbo_company_name, is_sandbox")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .maybeSingle();
      setConnection(conn as QBOConnection | null);

      if (conn) {
        const { data, error } = await (supabase as any)
          .from("invoice_ar_mirror")
          .select("id, qbo_invoice_id, doc_number, total_amount, balance, tax_amount, qbo_status, email_status, invoice_link, invoice_link_status, invoice_link_source, invoice_link_verified_at, online_card_enabled, online_ach_enabled, invoice_type, txn_date, due_date, paid_at, last_synced_at, last_qbo_pull_at, last_sync_error")
          .eq("tenant_id", tenantId)
          .eq("project_id", projectId)
          .eq("realm_id", conn.realm_id)
          .order("created_at", { ascending: false });
        if (error) throw error;
        setInvoices((data ?? []) as InvoiceRow[]);
      } else {
        setInvoices([]);
      }
    } catch (e: any) {
      console.error("[QBO invoices] load failed", e);
      toast({ title: "Failed to load invoices", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [projectId, tenantId, toast]);

  useEffect(() => { void load(); }, [load]);

  const projectTotals = useMemo(() => {
    const total = invoices.reduce((s, i) => s + Number(i.total_amount || 0), 0);
    const balance = invoices.reduce((s, i) => s + Number(i.balance || 0), 0);
    const paid = Math.max(0, total - balance);
    const allPaid = invoices.length > 0 && balance === 0 && total > 0;
    return { total, balance, paid, allPaid };
  }, [invoices]);

  // Phase 1B gate: Ready for Accounting Review requires ALL of these to be true.
  // "Accounting Complete" itself remains a separate MANUAL action performed by
  // an accounting role — this banner only signals the project is eligible.
  const reviewGate = useMemo(() => {
    const hasInvoices = invoices.length > 0;
    const allZeroBalance = hasInvoices && invoices.every(i => Number(i.balance) === 0 && Number(i.total_amount) > 0);
    const noSyncErrors = invoices.every(i => !i.last_sync_error);
    const paidRecorded = invoices.every(i => !!i.paid_at);
    const allRecentlySynced = invoices.every(i => !!i.last_qbo_pull_at);
    const ready = hasInvoices && allZeroBalance && noSyncErrors && paidRecorded && allRecentlySynced;
    return { hasInvoices, allZeroBalance, noSyncErrors, paidRecorded, allRecentlySynced, ready };
  }, [invoices]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      // Note: qbo-worker derives tenant_id + realm_id from JWT + active connection.
      // Do not send them from the client per Phase 1 tenant boundary rules.
      const { data, error } = await supabase.functions.invoke("qbo-worker", {
        body: {
          op: "createInvoiceFromEstimates",
          args: { project_id: projectId, invoice_type: invoiceType },
        },
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data?.message ?? data?.error ?? "QBO invoice create failed");

      toast({
        title: "Invoice created in QuickBooks",
        description: data?.doc_number ? `Invoice #${data.doc_number} • ${money(Number(data.total ?? 0))}` : "Ready to send",
      });
      await load();
    } catch (e: any) {
      toast({ title: "Create failed", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleSync = async (qboInvoiceId: string) => {
    setSyncingId(qboInvoiceId);
    try {
      const { data, error } = await supabase.functions.invoke("qbo-worker", {
        body: { op: "syncPaymentStatus", args: { qbo_invoice_id: qboInvoiceId } },
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data?.message ?? data?.error ?? "Sync failed");
      toast({ title: "Synced", description: data?.paid ? "Paid in full" : `Balance ${money(Number(data?.balance ?? 0))}` });
      await load();
    } catch (e: any) {
      toast({ title: "Sync failed", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSyncingId(null);
    }
  };

  const copyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: "Payment link copied" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  if (loading) {
    return (
      <Card><CardContent className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></CardContent></Card>
    );
  }

  if (!connection) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>QuickBooks not connected</CardTitle>
          <CardDescription>Connect QuickBooks in Settings → QuickBooks to invoice from this project.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Project payment summary */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                Invoices
                {connection.is_sandbox && <Badge variant="outline" className="text-xs">Sandbox</Badge>}
              </CardTitle>
              <CardDescription>
                {connection.qbo_company_name ? `QuickBooks: ${connection.qbo_company_name}` : "Connected to QuickBooks"}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={invoiceType} onValueChange={setInvoiceType}>
                <SelectTrigger className="w-[170px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INVOICE_TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button onClick={handleCreate} disabled={creating}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <DollarSign className="h-4 w-4 mr-2" />}
                Create Invoice
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div><p className="text-muted-foreground">Invoiced</p><p className="font-semibold text-base">{money(projectTotals.total)}</p></div>
            <div><p className="text-muted-foreground">Paid</p><p className="font-semibold text-base">{money(projectTotals.paid)}</p></div>
            <div><p className="text-muted-foreground">Outstanding</p><p className={`font-semibold text-base ${projectTotals.balance > 0 ? "text-orange-600" : ""}`}>{money(projectTotals.balance)}</p></div>
          </div>
          {invoices.length > 0 && (
            <div className={`mt-4 rounded-md border p-3 text-sm ${reviewGate.ready ? "border-green-500/40 bg-green-500/10" : "border-muted bg-muted/30"}`}>
              <div className="flex items-start gap-2">
                {reviewGate.ready
                  ? <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-600" />
                  : <AlertTriangle className="h-4 w-4 mt-0.5 text-muted-foreground" />}
                <div className="flex-1">
                  <p className="font-medium">
                    {reviewGate.ready ? "Ready for Accounting Review" : "Not ready for accounting review"}
                  </p>
                  <ul className="mt-2 space-y-1 text-xs">
                    <li className={reviewGate.hasInvoices ? "text-green-700" : "text-muted-foreground"}>
                      {reviewGate.hasInvoices ? "✓" : "•"} At least one QuickBooks invoice exists
                    </li>
                    <li className={reviewGate.allZeroBalance ? "text-green-700" : "text-muted-foreground"}>
                      {reviewGate.allZeroBalance ? "✓" : "•"} Every invoice balance is $0 in QuickBooks
                    </li>
                    <li className={reviewGate.paidRecorded ? "text-green-700" : "text-muted-foreground"}>
                      {reviewGate.paidRecorded ? "✓" : "•"} A paid-on date is recorded for every invoice
                    </li>
                    <li className={reviewGate.noSyncErrors ? "text-green-700" : "text-destructive"}>
                      {reviewGate.noSyncErrors ? "✓" : "✗"} No unresolved sync errors
                    </li>
                    <li className={reviewGate.allRecentlySynced ? "text-green-700" : "text-muted-foreground"}>
                      {reviewGate.allRecentlySynced ? "✓" : "•"} Each invoice has been re-read from QuickBooks
                    </li>
                  </ul>
                  <p className="text-muted-foreground text-xs mt-2">
                    Accounting Complete, warranty generation, and project closeout remain manual actions. An accounting-role user must confirm them from the project header.
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {invoices.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No invoices for this project yet.</CardContent></Card>
      ) : invoices.map((inv) => {
        const paid = Math.max(0, Number(inv.total_amount) - Number(inv.balance));
        const isPaid = Number(inv.balance) === 0 && Number(inv.total_amount) > 0;
        return (
          <Card key={inv.id}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    Invoice {inv.doc_number ? `#${inv.doc_number}` : `(${inv.qbo_invoice_id})`}
                    <Badge variant="outline" className="capitalize text-xs">{inv.invoice_type ?? "other"}</Badge>
                    <Badge variant={isPaid ? "default" : "secondary"} className="text-xs">
                      {isPaid ? "Paid" : (inv.qbo_status ?? "Open")}
                    </Badge>
                  </CardTitle>
                  <CardDescription className="text-xs mt-1">
                    {inv.txn_date && <>Issued {new Date(inv.txn_date).toLocaleDateString()} • </>}
                    {inv.due_date && <>Due {new Date(inv.due_date).toLocaleDateString()} • </>}
                    {inv.last_synced_at && <>Last synced {new Date(inv.last_synced_at).toLocaleString()}</>}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleSync(inv.qbo_invoice_id)} disabled={syncingId === inv.qbo_invoice_id}>
                    {syncingId === inv.qbo_invoice_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                    <span className="ml-1.5">Sync</span>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <a href={`https://app.qbo.intuit.com/app/invoice?txnId=${inv.qbo_invoice_id}`} target="_blank" rel="noopener noreferrer">
                      Open in QuickBooks <ExternalLink className="h-3 w-3 ml-1" />
                    </a>
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><p className="text-muted-foreground">Total</p><p className="font-semibold">{money(inv.total_amount)}</p></div>
                <div><p className="text-muted-foreground">Paid</p><p className="font-semibold">{money(paid)}</p></div>
                <div><p className="text-muted-foreground">Balance</p><p className={`font-semibold ${Number(inv.balance) > 0 ? "text-orange-600" : ""}`}>{money(inv.balance)}</p></div>
                <div><p className="text-muted-foreground">Paid on</p><p className="font-semibold">{inv.paid_at ? new Date(inv.paid_at).toLocaleDateString() : "—"}</p></div>
              </div>

              {inv.last_sync_error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">
                  <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive" />
                  <span>{inv.last_sync_error}</span>
                </div>
              )}

              {!isPaid && (() => {
                // Phase 1B: strictly capability-driven. Pay Invoice only renders when
                // the server-side reconciler validated the hosted link AND persisted
                // invoice_link_status='available'. Presence of a URL alone is not enough.
                const linkAvailable =
                  inv.invoice_link_status === "available" &&
                  !!inv.invoice_link &&
                  inv.invoice_link.startsWith("https://");
                if (linkAvailable) {
                  return (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button asChild size="lg" className="flex-1 h-12 text-base">
                        <a href={inv.invoice_link!} target="_blank" rel="noopener noreferrer">
                          <CreditCard className="h-5 w-5 mr-2" /> Pay Invoice
                        </a>
                      </Button>
                      <Button variant="outline" size="lg" onClick={() => copyLink(inv.invoice_link!)}>
                        <Copy className="h-4 w-4 mr-2" /> Copy Payment Link
                      </Button>
                    </div>
                  );
                }
                // Explain WHY the link is not usable, sourced from reconciler state.
                const reasonByStatus: Record<string, string> = {
                  pending: "Hosted payment link is pending — QuickBooks has not returned an InvoiceLink yet. Click Sync to re-read.",
                  unavailable: "Online payments are not enabled on this invoice in QuickBooks (no card or ACH capability). Enable QuickBooks Payments, then click Sync.",
                  expired: "The hosted link expired. Click Sync to have QuickBooks issue a new one.",
                  invalid: "The hosted link failed server-side validation and was rejected. Click Sync after fixing the invoice in QuickBooks.",
                  access_denied: "QuickBooks blocked access to the hosted link for this invoice. Verify online payments are enabled and click Sync.",
                  unknown: "Link status is unknown. Click Sync to have QuickBooks re-issue the hosted link.",
                };
                const reason = reasonByStatus[inv.invoice_link_status ?? "unknown"] ?? reasonByStatus.unknown;
                return (
                  <div className="text-xs text-muted-foreground rounded-md border border-dashed p-3 space-y-1">
                    <p>{reason}</p>
                    <p className="text-[11px]">
                      Link status: <span className="font-mono">{inv.invoice_link_status ?? "unknown"}</span>
                      {inv.online_card_enabled === false && inv.online_ach_enabled === false ? " • No online payment methods enabled in QBO" : ""}
                      {inv.invoice_link_verified_at ? ` • Last verified ${new Date(inv.invoice_link_verified_at).toLocaleString()}` : ""}
                    </p>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

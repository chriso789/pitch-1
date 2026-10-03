import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, Download, FileText, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

interface InvoiceViewPayload {
  ok: true;
  invoice: {
    number: string;
    amount: number;
    balance: number;
    due_date: string | null;
    status: string | null;
    pdf_url: string;
  };
  tenant: {
    name: string;
    logo_url: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
  };
}

const money = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });

const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

export default function PublicInvoiceView() {
  const { deliveryId } = useParams<{ deliveryId: string }>();
  const [data, setData] = useState<InvoiceViewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const loadInvoice = useCallback(async () => {
    if (!deliveryId) {
      setError(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(false);
    try {
      const endpoint = new URL(`${SUPABASE_URL}/functions/v1/email-api/invoice/view`);
      endpoint.searchParams.set("d", deliveryId);
      endpoint.searchParams.set("k", "view");
      const response = await fetch(endpoint.toString(), {
        headers: {
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${SUPABASE_ANON}`,
        },
      });
      const body = (await response.json().catch(() => null)) as InvoiceViewPayload | null;
      if (!response.ok || !body?.ok) throw new Error("Invoice unavailable");
      setData(body);
      document.title = `Invoice ${body.invoice.number} — ${body.tenant.name}`;
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [deliveryId]);

  useEffect(() => {
    void loadInvoice();
  }, [loadInvoice]);

  const downloadInvoice = async () => {
    if (!data) return;
    setDownloading(true);
    try {
      const response = await fetch(data.invoice.pdf_url);
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `${data.invoice.number}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      await loadInvoice();
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-6">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading your invoice…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-6">
        <div className="w-full max-w-md border border-border bg-card p-8 text-center shadow-sm">
          <AlertTriangle className="mx-auto h-9 w-9 text-destructive" />
          <h1 className="mt-4 text-xl font-semibold text-card-foreground">Invoice unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            This link may no longer be active. Please contact the contractor for a new invoice link.
          </p>
          <Button className="mt-6" variant="outline" onClick={loadInvoice}>
            <RefreshCw className="mr-2 h-4 w-4" /> Try again
          </Button>
        </div>
      </div>
    );
  }

  const { invoice, tenant } = data;
  const contact = [tenant.phone, tenant.email].filter(Boolean).join(" · ");

  return (
    <div className="min-h-screen bg-muted/30 text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {tenant.logo_url ? (
              <img src={tenant.logo_url} alt={tenant.name} className="h-11 w-11 object-contain" />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center bg-primary text-primary-foreground">
                <FileText className="h-5 w-5" />
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate font-semibold">{tenant.name}</p>
              {contact && <p className="truncate text-xs text-muted-foreground">{contact}</p>}
            </div>
          </div>
          <Button onClick={downloadInvoice} disabled={downloading}>
            {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Download PDF
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <section className="mb-5 grid gap-4 border border-border bg-card p-5 shadow-sm sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-success" /> Secure invoice
            </div>
            <h1 className="mt-2 text-2xl font-semibold">Invoice {invoice.number}</h1>
            {date(invoice.due_date) && (
              <p className="mt-1 text-sm text-muted-foreground">Due {date(invoice.due_date)}</p>
            )}
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-medium uppercase text-muted-foreground">Balance due</p>
            <p className="mt-1 text-3xl font-semibold text-primary">{money(invoice.balance)}</p>
            {invoice.amount !== invoice.balance && (
              <p className="mt-1 text-xs text-muted-foreground">Invoice total {money(invoice.amount)}</p>
            )}
          </div>
        </section>

        <section className="h-[calc(100vh-230px)] min-h-[520px] overflow-hidden border border-border bg-card shadow-sm">
          <iframe
            src={`${invoice.pdf_url}#toolbar=1&navpanes=0`}
            title={`Invoice ${invoice.number}`}
            className="h-full w-full border-0"
          />
        </section>

        <footer className="py-5 text-center text-xs text-muted-foreground">
          Securely delivered by Pitch CRM
        </footer>
      </main>
    </div>
  );
}
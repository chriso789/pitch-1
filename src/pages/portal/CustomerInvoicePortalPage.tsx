import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ExternalLink, CheckCircle2, Mail, Phone } from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

type Capability = "pay_available" | "link_unavailable" | "paid" | "void";

interface PortalPayload {
  ok: true;
  tenant: {
    id: string;
    name: string;
    logo_url?: string | null;
    primary_color?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    license_number?: string | null;
    address_street?: string | null;
    address_city?: string | null;
    address_state?: string | null;
    address_zip?: string | null;
  };
  project?: {
    id: string;
    name?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  } | null;
  contact?: {
    first_name?: string | null;
    last_name?: string | null;
    address_street?: string | null;
    address_city?: string | null;
    address_state?: string | null;
    address_zip?: string | null;
  } | null;
  invoice: {
    id: string;
    doc_number?: string | null;
    invoice_type?: string | null;
    txn_date?: string | null;
    due_date?: string | null;
    total_amount: number | null;
    balance: number | null;
    amount_paid: number | null;
    qbo_status?: string | null;
    paid_at?: string | null;
    last_synced_at?: string | null;
    payment_capability: Capability;
    payment_capability_message?: string | null;
  };
  token: { id: string; expires_at: string; open_count: number };
}

const fmtMoney = (n: number | null | undefined) =>
  typeof n === "number"
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "—";

const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—";

const fmtDateTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—";

async function callPortal(token: string, init?: RequestInit) {
  const url = new URL(`${SUPABASE_URL}/functions/v1/portal-invoice`);
  if (!init || (init.method ?? "GET") === "GET") url.searchParams.set("token", token);
  const res = await fetch(url.toString(), {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
    },
  });
  return res;
}

export default function CustomerInvoicePortalPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "invalid" }
    | { status: "ok"; data: PortalPayload }
  >({ status: "loading" });
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return setState({ status: "invalid" });
    (async () => {
      try {
        const res = await callPortal(token);
        if (!res.ok) return setState({ status: "invalid" });
        const body = (await res.json()) as PortalPayload | { ok: false };
        if (!("ok" in body) || body.ok !== true) return setState({ status: "invalid" });
        setState({ status: "ok", data: body });
        document.title = `Invoice ${body.invoice.doc_number ?? ""} — ${body.tenant.name}`.trim();
      } catch {
        setState({ status: "invalid" });
      }
    })();
  }, [token]);

  const handlePay = useCallback(async () => {
    if (!token) return;
    setPaying(true);
    setPayError(null);
    try {
      const res = await callPortal(token, {
        method: "POST",
        body: JSON.stringify({ token, action: "payment_link_clicked" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok || !body?.redirect_url) {
        setPayError(
          body?.error === "link_unavailable"
            ? "Payment link is temporarily unavailable. Please contact us."
            : "Unable to open the payment page. Please try again shortly.",
        );
        return;
      }
      // Open in a new tab for safety; QBO hosted pages should not be iframed.
      window.open(body.redirect_url, "_blank", "noopener,noreferrer");
    } catch {
      setPayError("Unable to open the payment page. Please try again shortly.");
    } finally {
      setPaying(false);
    }
  }, [token]);

  if (state.status === "loading") {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-6">
        <Card className="w-full max-w-3xl">
          <CardHeader>
            <Skeleton className="h-8 w-64" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state.status === "invalid") {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-6">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="mx-auto rounded-full bg-destructive/10 p-3 w-fit">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <h1 className="text-xl font-semibold mt-3">This invoice link is no longer active</h1>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              The link may have expired or been revoked. Please contact the contractor for an
              updated invoice link.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { tenant, project, contact, invoice } = state.data;
  const brandColor = tenant.primary_color || "#0f172a";

  const StatusBadge = () => {
    const label =
      invoice.payment_capability === "paid"
        ? "Paid"
        : invoice.payment_capability === "void"
          ? "Void"
          : invoice.payment_capability === "pay_available"
            ? "Balance Due"
            : "Payment Required";
    const tone =
      invoice.payment_capability === "paid"
        ? "bg-emerald-100 text-emerald-800"
        : invoice.payment_capability === "void"
          ? "bg-muted text-muted-foreground"
          : "bg-amber-100 text-amber-900";
    return <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${tone}`}>{label}</span>;
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <header
        className="border-b bg-background"
        style={{ borderTopColor: brandColor, borderTopWidth: 4 }}
      >
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center gap-4">
          {tenant.logo_url ? (
            <img
              src={tenant.logo_url}
              alt={tenant.name}
              className="h-12 w-12 rounded object-contain bg-white"
            />
          ) : (
            <div
              className="h-12 w-12 rounded flex items-center justify-center text-white font-semibold"
              style={{ backgroundColor: brandColor }}
            >
              {tenant.name?.[0] ?? "P"}
            </div>
          )}
          <div className="min-w-0">
            <div className="font-semibold text-lg truncate">{tenant.name}</div>
            <div className="text-xs text-muted-foreground truncate">
              {[tenant.phone, tenant.email, tenant.website].filter(Boolean).join(" · ") || "\u00A0"}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Invoice</div>
              <h1 className="text-2xl font-semibold mt-1">
                #{invoice.doc_number || invoice.id.slice(0, 8)}
              </h1>
              {invoice.invoice_type && (
                <div className="text-sm text-muted-foreground mt-1 capitalize">
                  {invoice.invoice_type.replace(/_/g, " ")}
                </div>
              )}
            </div>
            <StatusBadge />
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase mb-1">Bill To</div>
              <div className="text-sm">
                {contact
                  ? `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() || "—"
                  : "—"}
              </div>
              {project?.address && (
                <div className="text-sm text-muted-foreground mt-1">
                  {project.address}
                  {project.city ? `, ${project.city}` : ""}
                  {project.state ? `, ${project.state}` : ""} {project.zip ?? ""}
                </div>
              )}
            </div>
            <div className="sm:text-right space-y-1 text-sm">
              <div>
                <span className="text-muted-foreground">Issue date: </span>
                {fmtDate(invoice.txn_date)}
              </div>
              <div>
                <span className="text-muted-foreground">Due date: </span>
                {fmtDate(invoice.due_date)}
              </div>
              {invoice.paid_at && (
                <div className="text-emerald-700">
                  <span className="text-muted-foreground">Paid on: </span>
                  {fmtDate(invoice.paid_at)}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="grid grid-cols-3 text-center">
              <div>
                <div className="text-xs text-muted-foreground">Invoice total</div>
                <div className="text-lg font-semibold">{fmtMoney(invoice.total_amount)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Amount paid</div>
                <div className="text-lg font-semibold text-emerald-700">
                  {fmtMoney(invoice.amount_paid)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Balance due</div>
                <div className="text-lg font-semibold" style={{ color: brandColor }}>
                  {fmtMoney(invoice.balance)}
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              {invoice.payment_capability === "pay_available" && (
                <div className="space-y-2">
                  <Button
                    size="lg"
                    className="w-full"
                    style={{ backgroundColor: brandColor }}
                    onClick={handlePay}
                    disabled={paying}
                  >
                    {paying ? "Opening secure payment…" : "Pay Invoice"}
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">
                    You'll be redirected to a secure QuickBooks payment page.
                  </p>
                  {payError && (
                    <div className="text-sm text-destructive text-center">{payError}</div>
                  )}
                </div>
              )}

              {invoice.payment_capability === "link_unavailable" && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <div className="font-medium mb-1">Payment link unavailable</div>
                  <p>
                    {invoice.payment_capability_message ??
                      "Your invoice will be sent through QuickBooks. Please contact us for an updated payment link."}
                  </p>
                </div>
              )}

              {invoice.payment_capability === "paid" && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 mt-0.5" />
                  <div>
                    <div className="font-medium">This invoice is paid in full</div>
                    {invoice.paid_at && <div className="text-xs mt-1">Paid on {fmtDate(invoice.paid_at)}</div>}
                  </div>
                </div>
              )}

              {invoice.payment_capability === "void" && (
                <div className="rounded-md border bg-muted p-4 text-sm text-muted-foreground">
                  This invoice has been voided. Please contact us if you have any questions.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Questions?</div>
          </CardHeader>
          <CardContent className="pt-2 space-y-1 text-sm">
            {tenant.phone && (
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <a className="hover:underline" href={`tel:${tenant.phone}`}>
                  {tenant.phone}
                </a>
              </div>
            )}
            {tenant.email && (
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <a className="hover:underline" href={`mailto:${tenant.email}`}>
                  {tenant.email}
                </a>
              </div>
            )}
            {tenant.license_number && (
              <div className="text-xs text-muted-foreground pt-1">
                License #{tenant.license_number}
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Balance last updated {fmtDateTime(invoice.last_synced_at)}
        </p>
      </main>
    </div>
  );
}

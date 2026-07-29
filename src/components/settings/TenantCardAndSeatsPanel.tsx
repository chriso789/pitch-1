import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  CreditCard,
  Loader2,
  RefreshCw,
  Users,
  UserCheck,
  UserX,
  ShieldCheck,
  ExternalLink,
  Receipt,
  ArrowUpRight,
  ArrowDownRight,
  Ban,
  PlayCircle,
  FileDown,
} from "lucide-react";
import { edgeApi } from "@/lib/edgeApi";
import { useToast } from "@/hooks/use-toast";

type SeatBucket = { seats: number; activated: number; pending: number };

type PlanRow = {
  slug: string;
  name: string;
  tier: string | null;
  description: string | null;
  price_monthly: number | null;
  price_yearly: number | null;
  sort_order: number | null;
};

type Overview = {
  mode: "test" | "live";
  seats: {
    billable_seats: number;
    activated_logins: number;
    pending_logins: number;
    total_profiles: number;
    staff: SeatBucket;
    crew: SeatBucket;
  };
  payment_method: {
    brand: string | null;
    last4: string | null;
    exp_month: number | null;
    exp_year: number | null;
    is_default: boolean;
  } | null;
  card_count: number;
  customer_exists: boolean;
  tenant: {
    subscription_tier: string | null;
    subscription_status: string | null;
    subscription_expires_at: string | null;
    billing_email: string | null;
  } | null;
  subscription: {
    id: string;
    status: string;
    quantity: number;
    unit_amount: number | null;
    currency: string;
    interval: string | null;
    current_period_end: number | null;
    cancel_at_period_end: boolean;
    plan_slug: string | null;
  } | null;
  upcoming: {
    amount_due: number;
    currency: string;
    period_end: number | null;
    next_payment_attempt: number | null;
  } | null;
  plan: PlanRow | null;
  crew_plan: PlanRow | null;
  next_billing_anchor: number | null;
  plans: PlanRow[];
};

type InvoiceRow = {
  number: string;
  created: number;
  amount_due: number;
  amount_paid: number;
  currency: string;
  status: string | null;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
};

const money = (cents: number | null | undefined, currency = "usd") =>
  cents == null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

const dollars = (amount: number | null | undefined) =>
  amount == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

const dateFrom = (unix: number | null | undefined) =>
  unix ? new Date(unix * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

const statusTone = (status?: string | null) => {
  const s = (status ?? "").toLowerCase();
  if (["active", "paid", "trialing"].includes(s)) return "default" as const;
  if (["past_due", "unpaid", "incomplete", "canceling", "canceled"].includes(s)) return "destructive" as const;
  return "secondary" as const;
};

const Stat = ({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "success" | "warning";
  icon?: React.ReactNode;
}) => (
  <div className="rounded-lg border bg-card p-3">
    <div
      className={`text-2xl font-semibold flex items-center gap-1.5 ${
        tone === "success" ? "text-green-600" : tone === "warning" ? "text-amber-600" : ""
      }`}
    >
      {icon}
      {value}
    </div>
    <div className="text-xs text-muted-foreground mt-1">{label}</div>
  </div>
);

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 py-1.5">
    <span className="text-sm text-muted-foreground">{label}</span>
    <span className="text-sm font-medium text-right">{value}</span>
  </div>
);

export const TenantCardAndSeatsPanel = ({ tenantId }: { tenantId: string | null }) => {
  const { toast } = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) {
      setData(null);
      setInvoices([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const tenantHeaders = { "x-tenant-id": tenantId };
    // The overview route resolves (and creates, if missing) the tenant's single
    // platform Stripe customer, so simply opening this tab is enough.
    const { data: res, error } = await edgeApi<Overview>("payment-api", "/membership/billing/overview", {}, { headers: tenantHeaders });
    if (error) toast({ title: "Could not load billing details", description: error, variant: "destructive" });
    setData(res ?? null);
    setLoading(false);
    const { data: inv } = await edgeApi<{ invoices: InvoiceRow[] }>("payment-api", "/membership/invoices", {}, { headers: tenantHeaders });
    setInvoices(inv?.invoices ?? []);
  }, [tenantId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Complete the card-on-file flow after Stripe redirects back.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const card = params.get("card");
    if (!card) return;
    const sessionId = params.get("session_id");
    const clean = () => {
      params.delete("card");
      params.delete("session_id");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    };
    if (card === "canceled" || !sessionId) {
      toast({ title: "Card not saved", description: "The card setup was canceled." });
      clean();
      return;
    }
    (async () => {
      if (!tenantId) {
        clean();
        return;
      }
      setBusy("confirm");
      const { error } = await edgeApi("payment-api", "/membership/payment-method/confirm", { session_id: sessionId }, { headers: { "x-tenant-id": tenantId } });
      clean();
      setBusy(null);
      if (error) toast({ title: "Could not save card", description: error, variant: "destructive" });
      else {
        toast({ title: "Card saved", description: "Future monthly charges will use this card automatically." });
        void load();
      }
    })();
  }, [load, tenantId, toast]);

  const addCard = async () => {
    if (!tenantId) {
      return toast({ title: "Select a company", description: "Choose a company before adding a payment method.", variant: "destructive" });
    }
    const checkoutTab = window.open("", "_blank");
    if (checkoutTab) {
      checkoutTab.document.write("<p style='font-family: system-ui, sans-serif; padding: 24px;'>Opening secure Stripe card form…</p>");
    }
    setBusy("card");
    const { data: res, error } = await edgeApi<{ url: string }>("payment-api", "/membership/payment-method/setup", {
      return_url: window.location.origin,
    }, {
      headers: { "x-tenant-id": tenantId },
    });
    setBusy(null);
    if (error || !res?.url) {
      checkoutTab?.close();
      return toast({ title: "Could not open card form", description: error ?? "No setup URL", variant: "destructive" });
    }
    if (checkoutTab) {
      checkoutTab.opener = null;
      checkoutTab.location.href = res.url;
      return;
    }
    window.location.assign(res.url);
  };

  const openPortal = async () => {
    if (!tenantId) {
      return toast({ title: "Select a company", description: "Choose a company before opening billing.", variant: "destructive" });
    }
    setBusy("portal");
    const { data: res, error } = await edgeApi<{ url: string }>("payment-api", "/membership/portal", {
      return_url: window.location.origin,
    }, {
      headers: { "x-tenant-id": tenantId },
    });
    setBusy(null);
    if (error || !res?.url) {
      return toast({ title: "Billing portal unavailable", description: error ?? "No portal URL", variant: "destructive" });
    }
    window.open(res.url, "_blank", "noopener,noreferrer");
  };

  const syncSeats = async () => {
    if (!tenantId) return;
    setBusy("seats");
    const { error } = await edgeApi("payment-api", "/membership/seats/sync", {}, { headers: { "x-tenant-id": tenantId } });
    setBusy(null);
    if (error) return toast({ title: "Seat sync failed", description: error, variant: "destructive" });
    toast({ title: "Seats synced", description: "Stripe now bills the current active user count." });
    void load();
  };

  const changePlan = async (slug: string, label: string) => {
    if (!tenantId) return;
    setBusy(`plan:${slug}`);
    const { error } = await edgeApi("payment-api", "/membership/subscription/change-plan", { plan_slug: slug }, { headers: { "x-tenant-id": tenantId } });
    setBusy(null);
    if (error) return toast({ title: `${label} failed`, description: error, variant: "destructive" });
    toast({ title: `${label} complete`, description: "Stripe prorated the change on your next invoice." });
    void load();
  };

  const setCancel = async (cancel: boolean) => {
    if (!tenantId) return;
    setBusy(cancel ? "cancel" : "resume");
    const { error } = await edgeApi(
      "payment-api",
      cancel ? "/membership/subscription/cancel" : "/membership/subscription/resume",
      {},
      { headers: { "x-tenant-id": tenantId } },
    );
    setBusy(null);
    if (error) {
      return toast({ title: cancel ? "Cancel failed" : "Resume failed", description: error, variant: "destructive" });
    }
    toast({
      title: cancel ? "Membership set to cancel" : "Membership resumed",
      description: cancel ? "Access continues until the end of the current period." : "Billing will continue as normal.",
    });
    void load();
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading billing details…
        </CardContent>
      </Card>
    );
  }

  const seats = data?.seats;
  const sub = data?.subscription;
  const plan = data?.plan;
  const crewPlan = data?.crew_plan;
  const hasCard = !!data?.payment_method;

  // Pricing is read from the membership catalog; never recomputed here.
  const staffMonthly = plan?.price_monthly ?? null;
  const crewMonthly = crewPlan?.price_monthly ?? null;
  const projected =
    data?.upcoming?.amount_due ??
    (sub?.unit_amount != null && seats ? sub.unit_amount * Math.max(1, seats.staff.seats) : null);

  const staffSeats = sub?.quantity ?? seats?.staff.seats ?? 0;
  const crewSeats = seats?.crew.seats ?? 0;
  // Catalog-driven monthly cost (used until Stripe reports an invoice).
  const catalogMonthly =
    staffMonthly != null ? staffMonthly * staffSeats + (crewMonthly ?? 0) * crewSeats : null;
  const nextBilling = sub?.current_period_end ?? data?.next_billing_anchor ?? null;

  const alternatePlans = (data?.plans ?? []).filter((p) => p.slug !== "crew_login" && p.slug !== plan?.slug);

  return (
    <div className="space-y-6">
      {/* ---------------- Current membership ---------------- */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              Current membership
              {data?.mode && (
                <Badge variant={data.mode === "live" ? "default" : "secondary"}>
                  {data.mode === "live" ? "Live" : "Test mode"}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>Plan, price and renewal pulled from the Pitch membership catalog.</CardDescription>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="grid gap-x-8 md:grid-cols-2">
          <div className="divide-y">
            <Row label="Current plan" value={plan?.name ?? data?.tenant?.subscription_tier ?? "No plan selected"} />
            <Row
              label="Monthly price"
              value={staffMonthly != null ? `${dollars(staffMonthly)} / user` : "—"}
            />
            <Row label="Billing frequency" value={sub?.interval ? `Every ${sub.interval}` : "Monthly (1st of month)"} />
            <Row label="Current seats" value={staffSeats} />
            <Row label="Monthly subscription cost" value={dollars(catalogMonthly)} />
          </div>
          <div className="divide-y">
            <Row label="Included seats" value={sub?.quantity ?? staffSeats} />
            <Row
              label="Additional seat cost"
              value={staffMonthly != null ? `${dollars(staffMonthly)} / staff · ${dollars(crewMonthly)} / crew` : "—"}
            />
            <Row label="Next billing date" value={dateFrom(nextBilling)} />
            <Row
              label="Subscription status"
              value={
                <Badge variant={statusTone(sub?.status ?? data?.tenant?.subscription_status)}>
                  {sub?.cancel_at_period_end ? "cancels at period end" : sub?.status ?? data?.tenant?.subscription_status ?? "none"}
                </Badge>
              }
            />
            <Row
              label="Stripe customer"
              value={
                <Badge variant={data?.customer_exists ? "secondary" : "destructive"}>
                  {data?.customer_exists ? "Connected" : "Missing"}
                </Badge>
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* ---------------- Card on file ---------------- */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              Card on file
            </CardTitle>
            <CardDescription>Stored securely by Stripe and charged automatically each month.</CardDescription>
          </div>
          {hasCard && (
            <Button size="sm" variant="outline" onClick={openPortal} disabled={busy === "portal"}>
              {busy === "portal" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
              <span className="ml-2">Billing portal</span>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {hasCard ? (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-muted p-2">
                  <CreditCard className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium capitalize">
                    {data!.payment_method!.brand ?? "Card"} •••• {data!.payment_method!.last4 ?? "----"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Expires {data!.payment_method!.exp_month}/{data!.payment_method!.exp_year}
                    {data!.card_count > 1 ? ` · ${data!.card_count} cards on file` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={data!.payment_method!.is_default ? "secondary" : "outline"} className="gap-1">
                  <ShieldCheck className="h-3 w-3" />
                  {data!.payment_method!.is_default ? "Default payment method" : "Saved"}
                </Badge>
                <Button size="sm" variant="outline" onClick={addCard} disabled={busy === "card"}>
                  {busy === "card" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Update card
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-center space-y-2">
              <p className="font-medium">No payment method has been saved.</p>
              <p className="text-sm text-muted-foreground">Membership billing requires a valid payment method.</p>
              <Button className="mt-2" onClick={addCard} disabled={busy === "card" || busy === "confirm"}>
                {busy === "card" || busy === "confirm" ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <CreditCard className="h-4 w-4 mr-2" />
                )}
                Add card
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------------- Billing summary ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Billing summary</CardTitle>
          <CardDescription>Amounts reported by the active Stripe subscription for this company.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-x-8 md:grid-cols-2">
          <div className="divide-y">
            <Row label="Current plan" value={plan?.name ?? "—"} />
            <Row
              label="Current billing amount"
              value={
                sub?.unit_amount != null
                  ? `${money(sub.unit_amount, sub.currency)} × ${sub.quantity}`
                  : staffMonthly != null
                    ? `${dollars(staffMonthly)} × ${staffSeats}`
                    : "—"
              }
            />
            <Row label="Seat count" value={staffSeats} />
          </div>
          <div className="divide-y">
            <Row
              label="Upcoming invoice"
              value={projected != null ? money(projected, sub?.currency ?? "usd") : dollars(catalogMonthly)}
            />
            <Row label="Renewal date" value={dateFrom(data?.upcoming?.period_end ?? nextBilling)} />
            <Row
              label="Payment status"
              value={<Badge variant={statusTone(sub?.status)}>{sub?.status ?? "no subscription"}</Badge>}
            />
          </div>
        </CardContent>
      </Card>

      {/* ---------------- Seat usage ---------------- */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Seat usage
            </CardTitle>
            <CardDescription>
              Staff and crew logins counted from active company profiles. Rates come from the membership catalog.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={syncSeats} disabled={busy === "seats" || !sub}>
            {busy === "seats" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Sync seats to Stripe</span>
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Staff {staffMonthly != null ? `· ${dollars(staffMonthly)}/mo each` : ""}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Licensed seats" value={seats?.staff.seats ?? 0} />
              <Stat
                label="Active users"
                value={seats?.staff.activated ?? 0}
                tone="success"
                icon={<UserCheck className="h-4 w-4" />}
              />
              <Stat
                label="Pending invites"
                value={seats?.staff.pending ?? 0}
                tone="warning"
                icon={<UserX className="h-4 w-4" />}
              />
              <Stat label="Billed in Stripe" value={sub?.quantity ?? "—"} />
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Crew {crewMonthly != null ? `· ${dollars(crewMonthly)}/mo each` : ""}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Licensed seats" value={seats?.crew.seats ?? 0} />
              <Stat
                label="Active users"
                value={seats?.crew.activated ?? 0}
                tone="success"
                icon={<UserCheck className="h-4 w-4" />}
              />
              <Stat
                label="Pending invites"
                value={seats?.crew.pending ?? 0}
                tone="warning"
                icon={<UserX className="h-4 w-4" />}
              />
              <Stat label="Billed in Stripe" value={seats?.crew.seats ? seats.crew.seats : "—"} />
            </div>
          </div>

          <Separator />

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Projected next invoice</p>
              <p className="text-3xl font-bold">
                {money(projected, sub?.currency ?? "usd")}
                <span className="text-sm font-normal text-muted-foreground">
                  {sub?.interval ? `/${sub.interval}` : ""}
                </span>
              </p>
            </div>
            {sub && seats && sub.quantity !== Math.max(1, seats.staff.seats) && (
              <Badge variant="destructive">
                Stripe bills {sub.quantity} · {seats.staff.seats} staff active
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ---------------- Invoice history ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="h-4 w-4" />
            Invoice history
          </CardTitle>
          <CardDescription>Membership invoices issued to this company.</CardDescription>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No membership invoices yet.</p>
          ) : (
            <div className="divide-y">
              {invoices.map((inv) => (
                <div key={inv.number} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{inv.number}</p>
                    <p className="text-xs text-muted-foreground">{dateFrom(inv.created)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">{money(inv.amount_due, inv.currency)}</span>
                    <Badge variant={statusTone(inv.status)}>{inv.status ?? "—"}</Badge>
                    {inv.hosted_invoice_url && (
                      <Button size="sm" variant="ghost" asChild>
                        <a href={inv.hosted_invoice_url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3.5 w-3.5 mr-1" /> View
                        </a>
                      </Button>
                    )}
                    {inv.invoice_pdf && (
                      <Button size="sm" variant="ghost" asChild>
                        <a href={inv.invoice_pdf} target="_blank" rel="noopener noreferrer">
                          <FileDown className="h-3.5 w-3.5 mr-1" /> PDF
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------------- Billing actions ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Membership controls</CardTitle>
          <CardDescription>Plan changes are prorated by Stripe on the next invoice.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {alternatePlans.map((p) => {
            const upgrade = (p.price_monthly ?? 0) >= (plan?.price_monthly ?? 0);
            return (
              <Button
                key={p.slug}
                size="sm"
                variant="outline"
                disabled={!sub || busy === `plan:${p.slug}`}
                onClick={() => void changePlan(p.slug, upgrade ? "Upgrade" : "Downgrade")}
              >
                {busy === `plan:${p.slug}` ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : upgrade ? (
                  <ArrowUpRight className="h-4 w-4 mr-2" />
                ) : (
                  <ArrowDownRight className="h-4 w-4 mr-2" />
                )}
                {upgrade ? "Upgrade to" : "Downgrade to"} {p.name} · {dollars(p.price_monthly)}/user
              </Button>
            );
          })}

          {sub?.cancel_at_period_end ? (
            <Button size="sm" variant="outline" disabled={busy === "resume"} onClick={() => void setCancel(false)}>
              {busy === "resume" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <PlayCircle className="h-4 w-4 mr-2" />}
              Resume membership
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={!sub || busy === "cancel"} onClick={() => void setCancel(true)}>
              {busy === "cancel" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Ban className="h-4 w-4 mr-2" />}
              Cancel membership
            </Button>
          )}

          <Button size="sm" variant="ghost" onClick={openPortal} disabled={!hasCard || busy === "portal"}>
            {busy === "portal" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ExternalLink className="h-4 w-4 mr-2" />}
            Billing portal
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

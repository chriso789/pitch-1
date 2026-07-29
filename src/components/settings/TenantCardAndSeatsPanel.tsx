import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CreditCard, Loader2, RefreshCw, Users, UserCheck, UserX, ShieldCheck, ExternalLink } from "lucide-react";
import { edgeApi } from "@/lib/edgeApi";
import { useToast } from "@/hooks/use-toast";

type Overview = {
  mode: "test" | "live";
  seats: {
    billable_seats: number;
    activated_logins: number;
    pending_logins: number;
    total_profiles: number;
  };
  payment_method: {
    id: string;
    brand: string | null;
    last4: string | null;
    exp_month: number | null;
    exp_year: number | null;
    is_default: boolean;
  } | null;
  card_count: number;
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
  } | null;
};

const money = (cents: number | null | undefined, currency = "usd") =>
  cents == null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

export const TenantCardAndSeatsPanel = () => {
  const { toast } = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: res, error } = await edgeApi<Overview>("payment-api", "/membership/billing/overview");
    if (error) toast({ title: "Could not load billing details", description: error, variant: "destructive" });
    setData(res ?? null);
    setLoading(false);
  }, [toast]);

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
      setBusy("confirm");
      const { error } = await edgeApi("payment-api", "/membership/payment-method/confirm", { session_id: sessionId });
      setBusy(null);
      clean();
      if (error) toast({ title: "Could not save card", description: error, variant: "destructive" });
      else {
        toast({ title: "Card saved", description: "Future monthly charges will use this card automatically." });
        void load();
      }
    })();
  }, [load, toast]);

  const addCard = async () => {
    setBusy("card");
    const { data: res, error } = await edgeApi<{ url: string }>("payment-api", "/membership/payment-method/setup");
    setBusy(null);
    if (error || !res?.url) {
      return toast({ title: "Could not open card form", description: error ?? "No setup URL", variant: "destructive" });
    }
    window.location.href = res.url;
  };

  const openPortal = async () => {
    setBusy("portal");
    const { data: res, error } = await edgeApi<{ url: string }>("payment-api", "/membership/portal");
    setBusy(null);
    if (error || !res?.url) {
      return toast({ title: "Billing portal unavailable", description: error ?? "No portal URL", variant: "destructive" });
    }
    window.open(res.url, "_blank", "noopener,noreferrer");
  };

  const syncSeats = async () => {
    setBusy("seats");
    const { error } = await edgeApi("payment-api", "/membership/seats/sync");
    setBusy(null);
    if (error) return toast({ title: "Seat sync failed", description: error, variant: "destructive" });
    toast({ title: "Seats synced", description: "Stripe now bills the current active user count." });
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
  const perSeat = sub?.unit_amount ?? null;
  const projected = perSeat != null && seats ? perSeat * Math.max(1, seats.billable_seats) : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              Card on file
              {data?.mode && (
                <Badge variant={data.mode === "live" ? "default" : "secondary"}>
                  {data.mode === "live" ? "Live" : "Test mode"}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Saved securely at Stripe and charged automatically each month for your active users.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={openPortal} disabled={busy === "portal"}>
              {busy === "portal" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
              <span className="ml-2">Billing portal</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {data?.payment_method ? (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-muted p-2">
                  <CreditCard className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium capitalize">
                    {data.payment_method.brand ?? "Card"} •••• {data.payment_method.last4 ?? "----"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Expires {data.payment_method.exp_month}/{data.payment_method.exp_year}
                    {data.card_count > 1 ? ` · ${data.card_count} cards on file` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {data.payment_method.is_default && (
                  <Badge variant="secondary" className="gap-1">
                    <ShieldCheck className="h-3 w-3" /> Auto-charge
                  </Badge>
                )}
                <Button size="sm" variant="outline" onClick={addCard} disabled={busy === "card"}>
                  {busy === "card" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  <span className={busy === "card" ? "ml-2" : ""}>Replace card</span>
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                No card on file yet. Add one so monthly membership charges run automatically.
              </p>
              <Button onClick={addCard} disabled={busy === "card" || busy === "confirm"}>
                {busy === "card" || busy === "confirm" ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <CreditCard className="h-4 w-4 mr-2" />
                )}
                Add credit card
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              User logins &amp; monthly seats
            </CardTitle>
            <CardDescription>
              Your monthly charge is based on the number of active user logins set up for this company.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={syncSeats} disabled={busy === "seats" || !sub}>
            {busy === "seats" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Sync seats to Stripe</span>
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-lg border p-3 text-center">
              <div className="text-2xl font-bold">{seats?.billable_seats ?? 0}</div>
              <div className="text-xs text-muted-foreground mt-1">Billable seats</div>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <div className="text-2xl font-bold text-green-600 flex items-center justify-center gap-1">
                <UserCheck className="h-4 w-4" />
                {seats?.activated_logins ?? 0}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Activated logins</div>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <div className="text-2xl font-bold text-amber-600 flex items-center justify-center gap-1">
                <UserX className="h-4 w-4" />
                {seats?.pending_logins ?? 0}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Invited, not logged in</div>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <div className="text-2xl font-bold">{sub?.quantity ?? "—"}</div>
              <div className="text-xs text-muted-foreground mt-1">Seats billed in Stripe</div>
            </div>
          </div>

          <Separator />

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Projected next charge</p>
              <p className="text-3xl font-bold">
                {projected != null ? money(projected, sub?.currency) : "—"}
                <span className="text-sm font-normal text-muted-foreground">
                  {sub?.interval ? `/${sub.interval}` : ""}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {perSeat != null ? `${money(perSeat, sub?.currency)} per seat` : "Subscribe to a plan to see per-seat pricing"}
                {sub?.current_period_end
                  ? ` · renews ${new Date(sub.current_period_end * 1000).toLocaleDateString()}`
                  : ""}
              </p>
            </div>
            {sub && seats && sub.quantity !== Math.max(1, seats.billable_seats) && (
              <Badge variant="destructive">
                Stripe bills {sub.quantity} — {seats.billable_seats} active. Sync seats.
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TenantCardAndSeatsPanel;

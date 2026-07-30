import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, CreditCard, RefreshCw, ExternalLink, Check } from "lucide-react";
import { edgeApi } from "@/lib/edgeApi";
import { useToast } from "@/hooks/use-toast";

type Plan = {
  slug: string;
  name: string;
  tier: string;
  description: string | null;
  price_monthly: number | null;
  price_yearly: number | null;
  trial_days: number | null;
  features: string[] | null;
  stripe_price_id_monthly: string | null;
  stripe_price_id_yearly: string | null;
};

export const MembershipBillingPanel = ({ isMaster = false, tenantId = null }: { isMaster?: boolean; tenantId?: string | null }) => {
  const { toast } = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [mode, setMode] = useState<"test" | "live">("test");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [interval, setInterval] = useState<"monthly" | "yearly">("monthly");
  const [status, setStatus] = useState<{ subscription_status: string; plan_slug: string | null } | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [checkoutLabel, setCheckoutLabel] = useState("Stripe checkout");

  const loadPlans = async () => {
    setLoading(true);
    const tenantHeaders = tenantId ? { "x-tenant-id": tenantId } : undefined;
    const { data, error } = await edgeApi<{ mode: "test" | "live"; plans: Plan[] }>(
      "payment-api",
      "/membership/plans/list",
      {},
      tenantHeaders ? { headers: tenantHeaders } : undefined,
    );
    if (error) toast({ title: "Could not load plans", description: error, variant: "destructive" });
    setPlans(data?.plans ?? []);
    if (data?.mode) setMode(data.mode);
    setLoading(false);
  };

  useEffect(() => { loadPlans(); }, [tenantId]);

  // Complete the checkout flow after Stripe redirects back with ?membership=success
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("membership") === "canceled") {
      toast({ title: "Checkout canceled", description: "No subscription was started." });
      params.delete("membership");
      window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
      return;
    }
    const sessionId = params.get("session_id");
    if (params.get("membership") !== "success" || !sessionId) return;

    (async () => {
      setBusy("confirm");
      const tenantHeaders = tenantId ? { "x-tenant-id": tenantId } : undefined;
      const { data, error } = await edgeApi<{ subscription_status: string; plan_slug: string | null }>(
        "payment-api",
        "/membership/checkout/confirm",
        { session_id: sessionId },
        tenantHeaders ? { headers: tenantHeaders } : undefined,
      );
      setBusy(null);
      if (error) {
        toast({ title: "Could not confirm subscription", description: error, variant: "destructive" });
      } else if (data) {
        setStatus(data);
        toast({ title: "Subscription active", description: `${data.plan_slug ?? "Membership"} — ${data.subscription_status}` });
      }
      params.delete("membership");
      params.delete("session_id");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    })();
  }, []);


  const syncCatalog = async () => {
    setBusy("sync");
    const tenantHeaders = tenantId ? { "x-tenant-id": tenantId } : undefined;
    const { data, error } = await edgeApi<{ mode: string; plans: unknown[] }>(
      "payment-api",
      "/membership/plans/sync",
      // Live keys require explicit opt-in server-side before real prices are created.
      { allow_live: mode === "live" },
      tenantHeaders ? { headers: tenantHeaders } : undefined,
    );
    setBusy(null);
    if (error) return toast({ title: "Catalog sync failed", description: error, variant: "destructive" });
    toast({ title: "Stripe catalog synced", description: `${data?.plans?.length ?? 0} plans mapped in ${data?.mode} mode.` });
    loadPlans();
  };


  const startCheckout = async (slug: string) => {
    const plan = plans.find((p) => p.slug === slug);
    setCheckoutLabel(plan?.name ?? "Stripe checkout");
    setCheckoutOpen(true);
    setCheckoutUrl(null);
    setBusy(slug);
    const tenantHeaders = tenantId ? { "x-tenant-id": tenantId } : undefined;
    const { data, error } = await edgeApi<{ url: string }>("payment-api", "/membership/checkout", {
      plan_slug: slug,
      interval,
      return_url: window.location.origin,
    }, tenantHeaders ? { headers: tenantHeaders } : undefined);
    setBusy(null);
    if (error || !data?.url) {
      return toast({ title: "Checkout failed", description: error ?? "No checkout URL returned", variant: "destructive" });
    }
    setCheckoutUrl(data.url);
  };

  const openCheckout = () => {
    if (!checkoutUrl) return;
    window.open(checkoutUrl, "_blank", "noopener,noreferrer");
  };

  const openPortal = async () => {
    setBusy("portal");
    const tenantHeaders = tenantId ? { "x-tenant-id": tenantId } : undefined;
    const { data, error } = await edgeApi<{ url: string }>("payment-api", "/membership/portal", {
      return_url: window.location.origin,
    }, tenantHeaders ? { headers: tenantHeaders } : undefined);
    setBusy(null);
    if (error || !data?.url) {
      return toast({ title: "Billing portal unavailable", description: error ?? "No portal URL", variant: "destructive" });
    }
    window.open(data.url, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Secure Stripe checkout</DialogTitle>
            <DialogDescription>
              Start the {checkoutLabel} membership subscription through Stripe, then return here after payment.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
            {busy && busy !== "portal" && !checkoutUrl ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Preparing the secure Stripe checkout…
              </div>
            ) : checkoutUrl ? (
              <p>Stripe checkout is ready. Open it in a secure tab to add the payment method and activate billing.</p>
            ) : (
              <p>Stripe did not return a checkout link. Close this window and try again.</p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => setCheckoutOpen(false)}>Close</Button>
            <Button onClick={openCheckout} disabled={!checkoutUrl || !!(busy && busy !== "portal")}>
              <ExternalLink className="h-4 w-4 mr-2" /> Open Stripe checkout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="h-4 w-4" />
            Pitch CRM Membership
            <Badge variant={mode === "live" ? "default" : "secondary"}>{mode === "live" ? "Live" : "Test mode"}</Badge>
          </CardTitle>
          <CardDescription>
            Billed on the Pitch platform Stripe account. Tenant-connected Stripe accounts are never used for membership charges.
          </CardDescription>
          {status && (
            <p className="text-xs mt-2">
              Current: <span className="font-medium">{status.plan_slug ?? "membership"}</span> — {status.subscription_status}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setInterval(interval === "monthly" ? "yearly" : "monthly")}>
            {interval === "monthly" ? "Monthly" : "Yearly"}
          </Button>
          {isMaster && (
            <Button size="sm" variant="outline" onClick={syncCatalog} disabled={busy === "sync"}>
              {busy === "sync" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-2">Sync Stripe catalog</span>
            </Button>
          )}
          {isMaster && (
            <Button size="sm" variant="outline" onClick={backfillCustomers} disabled={busy === "backfill"}>
              {busy === "backfill" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-2">Push companies to Stripe</span>
            </Button>
          )}

          <Button size="sm" variant="ghost" onClick={openPortal} disabled={busy === "portal"}>
            {busy === "portal" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
            <span className="ml-2">Billing portal</span>
          </Button>
        </div>
        </CardHeader>
        <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading plans…
          </div>
        ) : plans.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No membership plans mapped yet.{isMaster ? " Run “Sync Stripe catalog” to create the test-mode products and prices." : ""}
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {plans.filter((plan) => plan.slug !== "crew_login").map((plan) => {
              const price = interval === "yearly" ? plan.price_yearly : plan.price_monthly;
              const mapped = interval === "yearly" ? plan.stripe_price_id_yearly : plan.stripe_price_id_monthly;
              return (
                <div key={plan.slug} className="rounded-lg border p-4 space-y-3">
                  <div>
                    <p className="font-semibold">{plan.name}</p>
                    <p className="text-2xl font-bold">
                      ${price?.toLocaleString() ?? "—"}
                      <span className="text-sm font-normal text-muted-foreground">/{interval === "yearly" ? "yr" : "mo"}</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{plan.description}</p>
                  </div>
                  <ul className="space-y-1">
                    {(plan.features ?? []).map((f) => (
                      <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <Check className="h-3 w-3 mt-0.5 text-primary shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full"
                    size="sm"
                    disabled={busy === plan.slug}
                    onClick={() => startCheckout(plan.slug)}
                  >
                    {busy === plan.slug ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    <span className="ml-2">{mapped ? "Subscribe" : "Subscribe — map price now"}</span>
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        </CardContent>
      </Card>
    </>
  );
};

export default MembershipBillingPanel;

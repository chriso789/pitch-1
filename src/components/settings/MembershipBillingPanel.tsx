import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

export const MembershipBillingPanel = ({ isMaster = false }: { isMaster?: boolean }) => {
  const { toast } = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [mode, setMode] = useState<"test" | "live">("test");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [interval, setInterval] = useState<"monthly" | "yearly">("monthly");

  const loadPlans = async () => {
    setLoading(true);
    const { data, error } = await edgeApi<{ mode: "test" | "live"; plans: Plan[] }>(
      "payment-api",
      "/membership/plans/list",
    );
    if (error) toast({ title: "Could not load plans", description: error, variant: "destructive" });
    setPlans(data?.plans ?? []);
    if (data?.mode) setMode(data.mode);
    setLoading(false);
  };

  useEffect(() => { loadPlans(); }, []);

  const syncCatalog = async () => {
    setBusy("sync");
    const { data, error } = await edgeApi<{ mode: string; plans: unknown[] }>(
      "payment-api",
      "/membership/plans/sync",
    );
    setBusy(null);
    if (error) return toast({ title: "Catalog sync failed", description: error, variant: "destructive" });
    toast({ title: "Stripe catalog synced", description: `${data?.plans?.length ?? 0} plans mapped in ${data?.mode} mode.` });
    loadPlans();
  };

  const startCheckout = async (slug: string) => {
    setBusy(slug);
    const { data, error } = await edgeApi<{ url: string }>("payment-api", "/membership/checkout", {
      plan_slug: slug,
      interval,
    });
    setBusy(null);
    if (error || !data?.url) {
      return toast({ title: "Checkout failed", description: error ?? "No checkout URL returned", variant: "destructive" });
    }
    window.open(data.url, "_blank", "noopener,noreferrer");
  };

  const openPortal = async () => {
    setBusy("portal");
    const { data, error } = await edgeApi<{ url: string }>("payment-api", "/membership/portal");
    setBusy(null);
    if (error || !data?.url) {
      return toast({ title: "Billing portal unavailable", description: error ?? "No portal URL", variant: "destructive" });
    }
    window.open(data.url, "_blank", "noopener,noreferrer");
  };

  return (
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
            {plans.map((plan) => {
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
                    disabled={!mapped || busy === plan.slug}
                    onClick={() => startCheckout(plan.slug)}
                  >
                    {busy === plan.slug ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    <span className="ml-2">{mapped ? `Subscribe${plan.trial_days ? ` — ${plan.trial_days}-day trial` : ""}` : "Price not mapped"}</span>
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MembershipBillingPanel;

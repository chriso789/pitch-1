import { useEffect, useState } from "react";
import { CreditCard, Crown, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEffectiveTenantId, useEffectiveTenantIdLoading } from "@/hooks/useEffectiveTenantId";
import { MembershipBillingPanel } from "@/components/settings/MembershipBillingPanel";
import { TenantCardAndSeatsPanel } from "@/components/settings/TenantCardAndSeatsPanel";

export const SubscriptionManagement = () => {
  const [billingTab, setBillingTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("billing") === "payment" || params.has("card") ? "payment" : "plan";
  });
  const effectiveTenantId = useEffectiveTenantId();
  const tenantLoading = useEffectiveTenantIdLoading();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("billing") === "payment" || params.has("card")) {
      setBillingTab("payment");
    }
  }, []);

  if (tenantLoading) {
    return (
      <Card>
        <CardContent className="pt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading subscription settings…
        </CardContent>
      </Card>
    );
  }

  if (!effectiveTenantId) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Select a company to manage CRM subscription billing.
        </CardContent>
      </Card>
    );
  }

  return (
    <Tabs value={billingTab} onValueChange={setBillingTab} className="space-y-6">
      <TabsList>
        <TabsTrigger value="plan" className="gap-2">
          <Crown className="h-4 w-4" />
          Plan
        </TabsTrigger>
        <TabsTrigger value="payment" className="gap-2">
          <CreditCard className="h-4 w-4" />
          Payment &amp; Seats
        </TabsTrigger>
      </TabsList>

      <TabsContent value="payment" className="space-y-6">
        <TenantCardAndSeatsPanel tenantId={effectiveTenantId} />
      </TabsContent>

      <TabsContent value="plan" className="space-y-6">
        <MembershipBillingPanel tenantId={effectiveTenantId} />
      </TabsContent>
    </Tabs>
  );
};

export default SubscriptionManagement;

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  CreditCard,
  RefreshCw,
} from "lucide-react";

interface TenantStripeStatus {
  connected: boolean;
  account: {
    id: string;
    onboarding_complete: boolean;
    charges_enabled: boolean;
    payouts_enabled: boolean;
    details_submitted: boolean;
    requirements_due: string[];
    requirements_pending: string[];
  } | null;
}

export default function TenantStripeConnectPanel() {
  const [status, setStatus] = useState<TenantStripeStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const { toast } = useToast();

  const refresh = async () => {
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "stripe-connect-tenant-status"
      );
      if (error) throw error;
      setStatus(data as TenantStripeStatus);
    } catch (err) {
      console.error("Failed to load tenant Stripe status", err);
      toast({
        title: "Couldn't load Stripe status",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    refresh();
    // Auto-refresh once if user just returned from Stripe onboarding
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "true" || params.get("refresh") === "true") {
      setTimeout(refresh, 800);
    }
  }, []);

  const startOnboarding = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "stripe-connect-tenant-onboard"
      );
      if (error) throw error;
      if (data?.onboarding_url) {
        window.location.href = data.onboarding_url;
        return;
      }
      throw new Error("No onboarding URL returned");
    } catch (err: any) {
      console.error("Onboarding error", err);
      toast({
        title: "Couldn't start Stripe onboarding",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <Card>
        <CardContent className="pt-6 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // Not connected at all
  if (!status?.connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Connect Stripe to accept invoice payments
          </CardTitle>
          <CardDescription>
            Each company connects its own Stripe account. Customers pay invoices
            and the funds settle directly into your company bank account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              You'll be redirected to Stripe to securely verify your business
              and bank account. This usually takes 3–5 minutes. 100% of each
              payment is passed through — no platform fee.
            </AlertDescription>
          </Alert>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">What you'll need:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Business legal name and EIN (or SSN for sole proprietors)</li>
              <li>Bank account and routing number</li>
              <li>Owner's date of birth and home address</li>
            </ul>
          </div>
          <Button
            onClick={startOnboarding}
            disabled={loading}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <ExternalLink className="h-4 w-4 mr-2" />
                Connect Stripe Account
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const acct = status.account!;
  const fullyReady = acct.charges_enabled && acct.payouts_enabled;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {fullyReady ? (
            <CheckCircle2 className="h-5 w-5 text-green-600" />
          ) : (
            <AlertCircle className="h-5 w-5 text-yellow-500" />
          )}
          Stripe Account
          {fullyReady ? (
            <Badge variant="default" className="ml-2">
              Active
            </Badge>
          ) : (
            <Badge variant="secondary" className="ml-2">
              Setup incomplete
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Invoice payments will route directly to your company's bank account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <StatusRow
            label="Accept payments"
            ok={acct.charges_enabled}
          />
          <StatusRow
            label="Payouts to bank"
            ok={acct.payouts_enabled}
          />
          <StatusRow
            label="Details submitted"
            ok={acct.details_submitted}
          />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Account ID</span>
            <code className="text-xs bg-muted px-2 py-0.5 rounded">
              {acct.id}
            </code>
          </div>
        </div>

        {acct.requirements_due?.length > 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <span className="font-medium">Action required: </span>
              Stripe needs additional information ({acct.requirements_due.length}{" "}
              item{acct.requirements_due.length === 1 ? "" : "s"}). Click
              "Complete Stripe setup" below.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2">
          <Button
            variant={fullyReady ? "outline" : "default"}
            onClick={startOnboarding}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ExternalLink className="h-4 w-4 mr-2" />
            )}
            {fullyReady ? "Update account details" : "Complete Stripe setup"}
          </Button>
          <Button variant="ghost" onClick={refresh} disabled={checking}>
            <RefreshCw
              className={`h-4 w-4 mr-2 ${checking ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1">
        {ok ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <span className="text-green-600">Yes</span>
          </>
        ) : (
          <>
            <AlertCircle className="h-4 w-4 text-yellow-500" />
            <span className="text-yellow-600">Pending</span>
          </>
        )}
      </span>
    </div>
  );
}

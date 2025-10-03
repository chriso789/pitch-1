import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, AlertCircle, Loader2, ExternalLink } from "lucide-react";

interface AccountStatus {
  connected: boolean;
  account: {
    id: string;
    onboarding_complete: boolean;
    payouts_enabled: boolean;
    charges_enabled: boolean;
    requirements_due: string[];
    requirements_pending: string[];
  } | null;
}

export default function StripeConnectOnboarding() {
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    checkAccountStatus();
  }, []);

  const checkAccountStatus = async () => {
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke('stripe-connect-account-status');
      
      if (error) throw error;
      
      setStatus(data);
    } catch (error) {
      console.error('Error checking account status:', error);
      toast({
        title: "Error",
        description: "Failed to check account status. Please try again.",
        variant: "destructive",
      });
    } finally {
      setChecking(false);
    }
  };

  const startOnboarding = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('stripe-connect-onboard');
      
      if (error) throw error;
      
      if (data.success && data.onboarding_url) {
        // Redirect to Stripe onboarding
        window.location.href = data.onboarding_url;
      } else {
        throw new Error('Failed to generate onboarding link');
      }
    } catch (error) {
      console.error('Error starting onboarding:', error);
      toast({
        title: "Error",
        description: "Failed to start onboarding. Please try again.",
        variant: "destructive",
      });
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <Card>
        <CardContent className="pt-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (status?.connected && status.account?.onboarding_complete) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            Bank Account Connected
          </CardTitle>
          <CardDescription>
            Your bank account is connected and ready to receive prize payouts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Payouts Enabled</span>
              <span className="flex items-center gap-1">
                {status.account.payouts_enabled ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <span className="text-green-500">Yes</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-4 w-4 text-yellow-500" />
                    <span className="text-yellow-500">Pending</span>
                  </>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Account ID</span>
              <code className="text-xs bg-muted px-2 py-1 rounded">
                {status.account.id}
              </code>
            </div>
          </div>

          {status.account.requirements_due && status.account.requirements_due.length > 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Additional information required: {status.account.requirements_due.join(', ')}
              </AlertDescription>
            </Alert>
          )}

          <Button 
            variant="outline" 
            onClick={startOnboarding}
            disabled={loading}
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Update Account Details
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect Your Bank Account</CardTitle>
        <CardDescription>
          Connect your bank account to receive cash prize payouts directly.
          Powered by Stripe.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            You'll be redirected to Stripe to securely connect your bank account.
            This process takes about 2-3 minutes.
          </AlertDescription>
        </Alert>

        <div className="space-y-2 text-sm text-muted-foreground">
          <p className="font-medium">What you'll need:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Your bank account and routing number</li>
            <li>Social Security Number (for tax purposes)</li>
            <li>Date of birth</li>
            <li>Home address</li>
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
              Connect Bank Account
            </>
          )}
        </Button>

        <p className="text-xs text-muted-foreground text-center">
          Your information is securely processed by Stripe and never stored on our servers.
        </p>
      </CardContent>
    </Card>
  );
}

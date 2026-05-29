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
import { CheckCircle2, AlertCircle, Loader2, RefreshCw, CreditCard } from "lucide-react";

interface SquareStatus {
  ok: boolean;
  configured: boolean;
  environment?: string;
  locationId?: string | null;
  locationCount?: number;
  locations?: Array<{ id: string; name: string; status: string; currency: string }>;
  error?: string;
}

export default function SquareSettings() {
  const [status, setStatus] = useState<SquareStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const { toast } = useToast();

  const refresh = async () => {
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("square-test-connection");
      if (error) throw error;
      setStatus(data as SquareStatus);
    } catch (err: any) {
      setStatus({ ok: false, configured: false, error: err.message });
      toast({
        title: "Could not check Square status",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const isConnected = status?.ok && status?.configured;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            <CardTitle>Square Payments</CardTitle>
            {isConnected ? (
              <Badge variant="default" className="bg-green-600">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Connected
              </Badge>
            ) : status?.configured ? (
              <Badge variant="destructive">
                <AlertCircle className="h-3 w-3 mr-1" /> Error
              </Badge>
            ) : (
              <Badge variant="outline">Not configured</Badge>
            )}
            {status?.environment && (
              <Badge variant="secondary" className="capitalize">{status.environment}</Badge>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={checking}>
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
        <CardDescription>
          Accept credit card payments through Square. Credentials are stored as
          encrypted edge function secrets and never exposed to the browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!status?.configured && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="space-y-2">
              <p className="font-medium">To connect Square you need three secrets:</p>
              <ol className="list-decimal list-inside text-sm space-y-1">
                <li>
                  <strong>SQUARE_ACCESS_TOKEN</strong> — from the
                  Square Developer Dashboard → your application → Credentials tab.
                  Use the <em>Sandbox</em> token to test, or the <em>Production</em>
                  {" "}token to take real payments.
                </li>
                <li>
                  <strong>SQUARE_LOCATION_ID</strong> — found under Locations in
                  the same application. This is the merchant location that will receive payments.
                </li>
                <li>
                  <strong>SQUARE_ENVIRONMENT</strong> — set to either
                  <code className="mx-1 px-1 bg-muted rounded">sandbox</code> or
                  <code className="mx-1 px-1 bg-muted rounded">production</code>.
                </li>
              </ol>
              <p className="text-xs text-muted-foreground pt-1">
                Ask Lovable to "add the Square secrets" and you'll get a secure
                form to paste each value.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {status?.configured && !status.ok && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Square rejected the credentials:</strong> {status.error}
              <p className="text-xs mt-1">
                Double-check that the access token matches the selected environment
                ({status.environment}) and hasn't been revoked.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {isConnected && (
          <div className="space-y-2">
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                Square is connected in <strong>{status.environment}</strong> mode
                with {status.locationCount} location{status.locationCount === 1 ? "" : "s"}.
              </AlertDescription>
            </Alert>
            {status.locations && status.locations.length > 0 && (
              <div className="border rounded-md divide-y">
                {status.locations.map((loc) => (
                  <div key={loc.id} className="p-3 flex items-center justify-between text-sm">
                    <div>
                      <div className="font-medium">{loc.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {loc.id} · {loc.currency}
                      </div>
                    </div>
                    <Badge variant={loc.status === "ACTIVE" ? "default" : "secondary"}>
                      {loc.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Hosted Square checkout links per invoice aren't wired up yet — let
              Lovable know when you're ready to add that flow.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

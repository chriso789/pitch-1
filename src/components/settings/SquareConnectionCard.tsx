import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { edgeApi } from "@/lib/edgeApi";
import { AlertCircle, CheckCircle2, Loader2, Plug, RefreshCw, Unplug } from "lucide-react";

interface StatusDTO {
  connected: boolean;
  status: string;
  needs_reauth?: boolean;
  environment?: "sandbox" | "production";
  merchant_id?: string | null;
  merchant_name?: string | null;
  selected_location_id?: string | null;
  selected_location_name?: string | null;
  scopes?: string[];
  access_token_expires_at?: string | null;
}
interface SquareLocation {
  id: string;
  name: string;
  status: string;
  currency: string;
}

export default function SquareConnectionCard() {
  const { toast } = useToast();
  const { user } = useCurrentUser();
  const isMaster = user?.role === "master" || user?.role === "platform_admin";

  const [status, setStatus] = useState<StatusDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [locations, setLocations] = useState<SquareLocation[]>([]);

  const loadStatus = async () => {
    setLoading(true);
    const { data, error } = await edgeApi<StatusDTO>("payment-api", "/square/status", {});
    if (error) {
      toast({ title: "Square status unavailable", description: error, variant: "destructive" });
      setStatus(null);
    } else if (data) {
      setStatus(data);
      if (data.connected) loadLocations();
    }
    setLoading(false);
  };

  const loadLocations = async () => {
    const { data, error } = await edgeApi<{ locations: SquareLocation[] }>(
      "payment-api",
      "/square/locations",
      {},
    );
    if (!error && data) setLocations(data.locations ?? []);
  };

  useEffect(() => {
    if (isMaster) loadStatus();
    // ?square=connected redirect handler
    const params = new URLSearchParams(window.location.search);
    if (params.get("square")) {
      const flag = params.get("square");
      if (flag === "connected") toast({ title: "Square connected" });
      else if (flag === "error") toast({ title: "Square connection failed", description: params.get("reason") ?? "", variant: "destructive" });
      params.delete("square");
      params.delete("reason");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMaster]);

  if (!isMaster) return null;

  const startConnect = async (environment: "sandbox" | "production") => {
    setBusy("connect");
    const { data, error } = await edgeApi<{ authorize_url: string }>(
      "payment-api",
      "/square/oauth/start",
      { environment },
    );
    setBusy(null);
    if (error || !data?.authorize_url) {
      toast({ title: "Could not start Square OAuth", description: error ?? "missing authorize_url", variant: "destructive" });
      return;
    }
    window.location.href = data.authorize_url;
  };

  const disconnect = async () => {
    setBusy("disconnect");
    const { error } = await edgeApi("payment-api", "/square/disconnect", {});
    setBusy(null);
    if (error) {
      toast({ title: "Disconnect failed", description: error, variant: "destructive" });
      return;
    }
    toast({ title: "Square disconnected" });
    setLocations([]);
    loadStatus();
  };

  const selectLocation = async (location_id: string) => {
    const loc = locations.find((l) => l.id === location_id);
    setBusy("location");
    const { error } = await edgeApi("payment-api", "/square/location", {
      location_id,
      location_name: loc?.name,
    });
    setBusy(null);
    if (error) {
      toast({ title: "Could not save location", description: error, variant: "destructive" });
      return;
    }
    toast({ title: "Square location saved" });
    loadStatus();
  };

  const statusBadge = () => {
    if (!status) return <Badge variant="outline">Unknown</Badge>;
    if (status.connected) {
      return (
        <Badge className="bg-green-600 hover:bg-green-600">
          <CheckCircle2 className="h-3 w-3 mr-1" /> Connected
        </Badge>
      );
    }
    if (status.needs_reauth) {
      return (
        <Badge variant="destructive">
          <AlertCircle className="h-3 w-3 mr-1" /> Needs Reconnect
        </Badge>
      );
    }
    return <Badge variant="outline">Disconnected</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Plug className="h-5 w-5" />
            <CardTitle>Square Account (OAuth)</CardTitle>
            {statusBadge()}
            {status?.environment && (
              <Badge variant="secondary" className="capitalize">{status.environment}</Badge>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={loadStatus} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
        <CardDescription>
          Per-tenant Square OAuth connection. Access tokens stay on the server and
          are never exposed to the browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <strong>Beta:</strong> Square payments are in beta and not available
            to tenants yet. You can connect a Square account and pick a location,
            but invoice collection through Square is still disabled.
          </AlertDescription>
        </Alert>

        {!status?.connected && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => startConnect("sandbox")} disabled={busy === "connect"}>
              {busy === "connect" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plug className="h-4 w-4 mr-2" />}
              Connect Square (Sandbox)
            </Button>
            <Button variant="outline" onClick={() => startConnect("production")} disabled={busy === "connect"}>
              Connect Square (Production)
            </Button>
          </div>
        )}

        {status?.connected && (
          <div className="space-y-3">
            <div className="text-sm">
              <div>
                <span className="text-muted-foreground">Merchant: </span>
                <span className="font-medium">{status.merchant_name ?? status.merchant_id ?? "—"}</span>
              </div>
              {status.access_token_expires_at && (
                <div className="text-xs text-muted-foreground">
                  Access token expires {new Date(status.access_token_expires_at).toLocaleString()}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Default location</div>
              <Select
                value={status.selected_location_id ?? ""}
                onValueChange={selectLocation}
                disabled={busy === "location" || locations.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={locations.length ? "Pick a location" : "Loading locations…"} />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name} <span className="text-xs text-muted-foreground ml-1">· {l.currency}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={loadLocations}>
                Refresh locations
              </Button>
            </div>

            <div>
              <Button variant="destructive" onClick={disconnect} disabled={busy === "disconnect"}>
                {busy === "disconnect" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Unplug className="h-4 w-4 mr-2" />}
                Disconnect Square
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

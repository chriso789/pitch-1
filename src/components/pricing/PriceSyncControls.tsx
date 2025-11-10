import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { RefreshCw, Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const PriceSyncControls = () => {
  const [vendor, setVendor] = useState("SRS");
  const [batchSize, setBatchSize] = useState("50");
  const [syncing, setSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<any>(null);
  const { toast } = useToast();

  const handleSync = async () => {
    setSyncing(true);
    setLastSyncResult(null);

    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('active_tenant_id, tenant_id')
        .eq('id', (await supabase.auth.getUser()).data.user?.id)
        .single();

      const tenantId = profile?.active_tenant_id || profile?.tenant_id;

      const { data, error } = await supabase.functions.invoke('srs-price-refresh-scheduler', {
        body: {
          vendor_code: vendor,
          batch_size: parseInt(batchSize),
          tenant_id: tenantId,
        },
        headers: {
          'x-sync-type': 'manual',
        },
      });

      if (error) throw error;

      setLastSyncResult(data);

      toast({
        title: "Price Sync Completed",
        description: `Successfully updated ${data.successful_updates} of ${data.total_skus} prices`,
      });
    } catch (error) {
      console.error('Price sync error:', error);
      toast({
        title: "Price Sync Failed",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Manual Price Sync</CardTitle>
          <CardDescription>
            Trigger an immediate price refresh from your vendor API
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="vendor">Vendor</Label>
              <Select value={vendor} onValueChange={setVendor}>
                <SelectTrigger id="vendor">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SRS">SRS (Suniland)</SelectItem>
                  <SelectItem value="ABC">ABC Supply</SelectItem>
                  <SelectItem value="BILLTRUST">Billtrust</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="batch-size">Batch Size</Label>
              <Input
                id="batch-size"
                type="number"
                value={batchSize}
                onChange={(e) => setBatchSize(e.target.value)}
                min="10"
                max="100"
                step="10"
              />
            </div>
          </div>

          <Button 
            onClick={handleSync} 
            disabled={syncing}
            className="w-full"
          >
            {syncing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Syncing Prices...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Sync All {vendor} Prices Now
              </>
            )}
          </Button>

          {lastSyncResult && (
            <Alert className={lastSyncResult.failed_updates > 0 ? "border-destructive" : "border-primary"}>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-1">
                  <p className="font-medium">Sync Complete</p>
                  <p className="text-sm">
                    ✓ {lastSyncResult.successful_updates} successful updates
                  </p>
                  {lastSyncResult.failed_updates > 0 && (
                    <p className="text-sm text-destructive">
                      ✗ {lastSyncResult.failed_updates} failed updates
                    </p>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sync Configuration</CardTitle>
          <CardDescription>
            Configure automatic price refresh schedule (coming soon)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Auto-Refresh Schedule</Label>
            <Select disabled>
              <SelectTrigger>
                <SelectValue placeholder="Manual Only (Scheduled sync not configured)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual Only</SelectItem>
                <SelectItem value="hourly">Every Hour</SelectItem>
                <SelectItem value="daily">Daily at 2 AM</SelectItem>
                <SelectItem value="weekly">Weekly on Monday</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Automatic scheduling requires cron configuration in Supabase
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

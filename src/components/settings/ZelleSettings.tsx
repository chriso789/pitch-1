import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, DollarSign, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export default function ZelleSettings() {
  const { activeTenantId } = useActiveTenantId();
  const queryClient = useQueryClient();

  const [zelleEnabled, setZelleEnabled] = useState(false);
  const [zelleEmail, setZelleEmail] = useState("");
  const [zellePhone, setZellePhone] = useState("");
  const [zelleDisplayName, setZelleDisplayName] = useState("");
  const [zelleInstructions, setZelleInstructions] = useState("");

  const { data: settings, isLoading } = useQuery({
    queryKey: ["tenant-zelle-settings", activeTenantId],
    queryFn: async () => {
      if (!activeTenantId) return null;
      const { data, error } = await supabase
        .from("tenant_settings")
        .select("zelle_enabled, zelle_email, zelle_phone, zelle_display_name, zelle_instructions")
        .eq("tenant_id", activeTenantId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!activeTenantId,
  });

  useEffect(() => {
    if (settings) {
      setZelleEnabled(settings.zelle_enabled || false);
      setZelleEmail(settings.zelle_email || "");
      setZellePhone(settings.zelle_phone || "");
      setZelleDisplayName(settings.zelle_display_name || "");
      setZelleInstructions(settings.zelle_instructions || "");
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeTenantId) throw new Error("No tenant");
      const { error } = await supabase
        .from("tenant_settings")
        .update({
          zelle_enabled: zelleEnabled,
          zelle_email: zelleEmail || null,
          zelle_phone: zellePhone || null,
          zelle_display_name: zelleDisplayName || null,
          zelle_instructions: zelleInstructions || null,
        })
        .eq("tenant_id", activeTenantId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-zelle-settings", activeTenantId] });
      toast.success("Zelle settings saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="h-5 w-5" />
          Zelle Payment Settings
        </CardTitle>
        <CardDescription>
          Configure Zelle to accept bank-to-bank payments from clients. Payment links will show your Zelle details with the invoice amount.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">Enable Zelle Payments</Label>
            <p className="text-xs text-muted-foreground">Allow generating Zelle payment links for invoices</p>
          </div>
          <Switch checked={zelleEnabled} onCheckedChange={setZelleEnabled} />
        </div>

        {zelleEnabled && (
          <>
            <div className="space-y-4">
              <div>
                <Label>Zelle Email</Label>
                <Input
                  value={zelleEmail}
                  onChange={(e) => setZelleEmail(e.target.value)}
                  placeholder="payments@yourcompany.com"
                  type="email"
                />
                <p className="text-xs text-muted-foreground mt-1">The email registered with your Zelle account</p>
              </div>
              <div>
                <Label>Zelle Phone Number</Label>
                <Input
                  value={zellePhone}
                  onChange={(e) => setZellePhone(e.target.value)}
                  placeholder="(555) 123-4567"
                />
                <p className="text-xs text-muted-foreground mt-1">The phone number registered with your Zelle account</p>
              </div>
              <div>
                <Label>Display Name</Label>
                <Input
                  value={zelleDisplayName}
                  onChange={(e) => setZelleDisplayName(e.target.value)}
                  placeholder="Your Company Name"
                />
                <p className="text-xs text-muted-foreground mt-1">Name clients will see when looking up your Zelle</p>
              </div>
              <div>
                <Label>Custom Instructions</Label>
                <Textarea
                  value={zelleInstructions}
                  onChange={(e) => setZelleInstructions(e.target.value)}
                  placeholder="Open your banking app, go to Zelle, and send the amount shown to our email or phone number above."
                  rows={3}
                />
                <p className="text-xs text-muted-foreground mt-1">Custom instructions shown to clients on the payment page</p>
              </div>
            </div>

            {!zelleEmail && !zellePhone && (
              <p className="text-sm text-destructive">Please provide at least a Zelle email or phone number</p>
            )}
          </>
        )}

        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || (zelleEnabled && !zelleEmail && !zellePhone)}
          className="w-full"
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Zelle Settings
        </Button>
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface DropPinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lat: number;
  lng: number;
  tenantId: string;
  userId: string;
  onSuccess: () => void;
}

export default function DropPinDialog({
  open,
  onOpenChange,
  lat,
  lng,
  tenantId,
  userId,
  onSuccess,
}: DropPinDialogProps) {
  const [runEnrichment, setRunEnrichment] = useState(true);
  const [saving, setSaving] = useState(false);

  const handleDrop = async () => {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("canvass-drop-pin", {
        body: { tenant_id: tenantId, user_id: userId, lat, lng, run_enrichment: runEnrichment },
      });

      if (error) throw error;

      toast.success("Pin dropped successfully");
      onOpenChange(false);
      onSuccess();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to drop pin");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Drop Pin
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Create a property pin at:
          </p>
          <p className="text-xs font-mono bg-muted rounded px-2 py-1">
            {lat.toFixed(6)}, {lng.toFixed(6)}
          </p>

          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={runEnrichment}
              onCheckedChange={(v) => setRunEnrichment(!!v)}
            />
            <Label className="text-xs cursor-pointer">Run property enrichment</Label>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleDrop} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            Drop Pin
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

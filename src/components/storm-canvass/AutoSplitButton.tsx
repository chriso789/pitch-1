import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Scissors } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface TeamMember {
  id: string;
  first_name: string | null;
  last_name: string | null;
}

interface AutoSplitButtonProps {
  tenantId: string;
  areaId: string;
  areaName: string;
  teamMembers: TeamMember[];
}

export default function AutoSplitButton({
  tenantId,
  areaId,
  areaName,
  teamMembers,
}: AutoSplitButtonProps) {
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Record<string, number> | null>(null);

  const toggle = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSplit = async () => {
    if (selectedIds.length < 2) {
      toast.error("Select at least 2 reps");
      return;
    }
    setRunning(true);
    setResults(null);

    try {
      const { data, error } = await supabase.functions.invoke("canvass-area-auto-split", {
        body: { tenant_id: tenantId, area_id: areaId, user_ids: selectedIds },
      });

      if (error) throw error;

      setResults(data?.counts || {});
      toast.success(`Split ${data?.total || 0} properties among ${selectedIds.length} reps`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Auto-split failed");
    } finally {
      setRunning(false);
    }
  };

  const getName = (id: string) => {
    const m = teamMembers.find(t => t.id === id);
    return [m?.first_name, m?.last_name].filter(Boolean).join(" ") || "Unknown";
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-xs gap-1"
        onClick={() => { setOpen(true); setResults(null); setSelectedIds([]); }}
      >
        <Scissors className="h-3 w-3" />
        Auto Split
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">
              Auto Split — {areaName}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2 max-h-48 overflow-y-auto">
            {teamMembers.map(m => (
              <label key={m.id} className="flex items-center gap-2 cursor-pointer text-xs p-1 rounded hover:bg-muted">
                <Checkbox
                  checked={selectedIds.includes(m.id)}
                  onCheckedChange={() => toggle(m.id)}
                />
                <span>{[m.first_name, m.last_name].filter(Boolean).join(" ") || "Unknown"}</span>
              </label>
            ))}
          </div>

          {results && (
            <div className="space-y-1 border-t pt-2">
              <p className="text-xs font-medium">Results:</p>
              {Object.entries(results).map(([uid, count]) => (
                <div key={uid} className="flex items-center justify-between text-xs">
                  <span>{getName(uid)}</span>
                  <Badge variant="secondary" className="text-[10px]">{count} properties</Badge>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button size="sm" onClick={handleSplit} disabled={running || selectedIds.length < 2}>
              {running && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              Split ({selectedIds.length} reps)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

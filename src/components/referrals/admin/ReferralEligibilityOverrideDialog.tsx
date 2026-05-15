import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useReferralEligibilityActions } from "@/hooks/referrals/useReferralEligibility";

interface Props {
  submissionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReferralEligibilityOverrideDialog({ submissionId, open, onOpenChange }: Props) {
  const { override } = useReferralEligibilityActions();
  const [decision, setDecision] = useState<"eligible" | "blocked">("eligible");
  const [reason, setReason] = useState("");

  const submit = async () => {
    if (!submissionId || !reason.trim()) return;
    await override.mutateAsync({
      submissionId,
      eligible: decision === "eligible",
      reason: reason.trim(),
    });
    setReason("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Admin override eligibility</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Decision</Label>
            <RadioGroup value={decision} onValueChange={(v) => setDecision(v as any)}>
              <div className="flex items-center gap-2">
                <RadioGroupItem id="elig" value="eligible" />
                <Label htmlFor="elig" className="font-normal">Mark eligible (bypass blocks)</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem id="blk" value="blocked" />
                <Label htmlFor="blk" className="font-normal">Mark not eligible (block payout)</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">Reason (required)</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are you overriding eligibility?"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!reason.trim() || override.isPending}>
            {override.isPending ? "Saving…" : "Apply override"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

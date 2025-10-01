import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertCircle } from "lucide-react";

interface TransitionReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  fromStatus: string;
  toStatus: string;
  isBackward?: boolean;
}

export function TransitionReasonDialog({
  open,
  onOpenChange,
  onConfirm,
  fromStatus,
  toStatus,
  isBackward = false,
}: TransitionReasonDialogProps) {
  const [reason, setReason] = useState("");

  const handleConfirm = () => {
    if (reason.trim()) {
      onConfirm(reason);
      setReason("");
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isBackward && <AlertCircle className="h-5 w-5 text-warning" />}
            Status Change Reason Required
          </DialogTitle>
          <DialogDescription>
            {isBackward ? (
              <span className="text-warning">
                You are moving a job backward from <strong>{fromStatus}</strong> to <strong>{toStatus}</strong>.
                Please provide a reason for this change.
              </span>
            ) : (
              <span>
                Moving from <strong>{fromStatus}</strong> to <strong>{toStatus}</strong> requires a reason.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="reason">Reason for status change *</Label>
            <Textarea
              id="reason"
              placeholder="Enter the reason for this status change..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-[100px]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setReason("");
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!reason.trim()}
          >
            Confirm Change
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

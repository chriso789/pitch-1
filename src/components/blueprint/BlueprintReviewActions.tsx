import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle } from "lucide-react";

export function BlueprintReviewActions({
  onApprove,
  onReject,
  currentStatus,
}: {
  onApprove: () => Promise<void> | void;
  onReject: () => Promise<void> | void;
  currentStatus?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Review</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Current status: <span className="font-medium">{currentStatus || "pending"}</span>
        </p>
        <div className="flex gap-2">
          <Button onClick={() => onApprove()} className="flex-1">
            <CheckCircle2 className="h-4 w-4 mr-2" /> Approve
          </Button>
          <Button onClick={() => onReject()} variant="destructive" className="flex-1">
            <XCircle className="h-4 w-4 mr-2" /> Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

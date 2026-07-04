import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function InspectionSuccessPage() {
  const [params] = useSearchParams();
  const rid = params.get("rid");
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-background to-muted/30">
      <div className="max-w-md text-center space-y-4 bg-card border rounded-xl p-8 shadow-sm">
        <CheckCircle2 className="h-14 w-14 text-primary mx-auto" />
        <h1 className="text-2xl font-bold">Payment received</h1>
        <p className="text-muted-foreground">
          Thanks — your inspection request has been submitted. Our office will
          reach out shortly to schedule a time that works for you.
        </p>
        {rid && (
          <p className="text-xs text-muted-foreground font-mono">
            Confirmation #{rid.slice(0, 8).toUpperCase()}
          </p>
        )}
        <Button asChild variant="outline">
          <Link to="/">Return to site</Link>
        </Button>
      </div>
    </div>
  );
}

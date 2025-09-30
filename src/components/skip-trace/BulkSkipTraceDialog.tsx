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
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, DollarSign, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

interface BulkSkipTraceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactIds: string[];
  onComplete?: () => void;
}

export const BulkSkipTraceDialog = ({ 
  open, 
  onOpenChange, 
  contactIds,
  onComplete 
}: BulkSkipTraceDialogProps) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<{
    success: number;
    failed: number;
    total: number;
    totalCost: number;
  }>({ success: 0, failed: 0, total: contactIds.length, totalCost: 0 });
  const { toast } = useToast();

  const estimatedCost = contactIds.length * 0.25; // $0.25 per lookup estimate

  const handleBulkSkipTrace = async () => {
    setIsProcessing(true);
    setProgress(0);
    
    let successCount = 0;
    let failedCount = 0;
    let totalCost = 0;

    for (let i = 0; i < contactIds.length; i++) {
      try {
        const { data, error } = await supabase.functions.invoke('skip-trace-lookup', {
          body: { contact_id: contactIds[i] }
        });

        if (error) throw error;

        if (data.success) {
          successCount++;
          totalCost += data.cost || 0.25;
        } else {
          failedCount++;
        }
      } catch (error) {
        console.error('Skip trace error:', error);
        failedCount++;
      }

      // Update progress
      const currentProgress = ((i + 1) / contactIds.length) * 100;
      setProgress(currentProgress);
      setResults({
        success: successCount,
        failed: failedCount,
        total: contactIds.length,
        totalCost
      });
    }

    setIsProcessing(false);
    
    toast({
      title: "Bulk Skip Trace Complete",
      description: `Successfully traced ${successCount} of ${contactIds.length} contacts`,
    });

    onComplete?.();
  };

  const handleClose = () => {
    if (!isProcessing) {
      onOpenChange(false);
      // Reset state after closing
      setTimeout(() => {
        setProgress(0);
        setResults({ success: 0, failed: 0, total: contactIds.length, totalCost: 0 });
      }, 300);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk Skip Trace</DialogTitle>
          <DialogDescription>
            Run skip trace on {contactIds.length} selected contacts
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {!isProcessing && progress === 0 && (
            <Alert>
              <DollarSign className="h-4 w-4" />
              <AlertDescription>
                Estimated cost: ${estimatedCost.toFixed(2)}
                <br />
                <span className="text-xs text-muted-foreground">
                  (${(estimatedCost / contactIds.length).toFixed(2)} per contact)
                </span>
              </AlertDescription>
            </Alert>
          )}

          {(isProcessing || progress > 0) && (
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span>Progress</span>
                  <span className="text-muted-foreground">
                    {Math.round(progress)}%
                  </span>
                </div>
                <Progress value={progress} />
              </div>

              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="space-y-1">
                  <div className="flex items-center justify-center gap-1">
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    <span className="text-2xl font-bold text-success">{results.success}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Success</p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-center gap-1">
                    <XCircle className="h-4 w-4 text-destructive" />
                    <span className="text-2xl font-bold text-destructive">{results.failed}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Failed</p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-center gap-1">
                    <DollarSign className="h-4 w-4 text-primary" />
                    <span className="text-2xl font-bold text-primary">
                      ${results.totalCost.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">Cost</p>
                </div>
              </div>
            </div>
          )}

          {progress === 100 && (
            <Alert className="bg-success/10 border-success/20">
              <CheckCircle2 className="h-4 w-4 text-success" />
              <AlertDescription className="text-success">
                Bulk skip trace completed successfully
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          {!isProcessing && progress === 0 && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleBulkSkipTrace}>
                Start Skip Trace
              </Button>
            </>
          )}
          {isProcessing && (
            <Button disabled>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Processing...
            </Button>
          )}
          {!isProcessing && progress === 100 && (
            <Button onClick={handleClose}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

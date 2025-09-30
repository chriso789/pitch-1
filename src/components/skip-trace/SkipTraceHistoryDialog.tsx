import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, DollarSign, Calendar, TrendingUp } from "lucide-react";
import { format } from "date-fns";

interface SkipTraceHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
}

interface SkipTraceResult {
  id: string;
  created_at: string;
  status: string;
  confidence_score: number;
  cost: number;
  provider: string;
  enriched_data: any;
}

export const SkipTraceHistoryDialog = ({ 
  open, 
  onOpenChange, 
  contactId 
}: SkipTraceHistoryDialogProps) => {
  const [history, setHistory] = useState<SkipTraceResult[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (open && contactId) {
      fetchHistory();
    }
  }, [open, contactId]);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('skip_trace_results')
        .select('*')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setHistory(data || []);
    } catch (error) {
      console.error('Error fetching skip trace history:', error);
      toast({
        title: "Error",
        description: "Failed to load skip trace history",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const totalCost = history.reduce((sum, h) => sum + (h.cost || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Skip Trace History</DialogTitle>
          <DialogDescription>
            View all skip trace attempts for this contact
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No skip trace history found
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-4 p-4 bg-muted/20 rounded-lg">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <TrendingUp className="h-4 w-4" />
                  Total Lookups
                </div>
                <p className="text-2xl font-bold">{history.length}</p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <DollarSign className="h-4 w-4" />
                  Total Cost
                </div>
                <p className="text-2xl font-bold">${totalCost.toFixed(2)}</p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <TrendingUp className="h-4 w-4" />
                  Avg Confidence
                </div>
                <p className="text-2xl font-bold">
                  {Math.round(
                    (history.reduce((sum, h) => sum + (h.confidence_score || 0), 0) / history.length) * 100
                  )}%
                </p>
              </div>
            </div>

            {/* Timeline */}
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {history.map((result) => (
                <div 
                  key={result.id} 
                  className="flex items-start gap-4 p-4 border rounded-lg hover:bg-muted/5 transition-colors"
                >
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">
                          {format(new Date(result.created_at), 'MMM dd, yyyy h:mm a')}
                        </span>
                      </div>
                      <Badge 
                        variant={result.status === 'completed' ? 'default' : 'destructive'}
                        className="text-xs"
                      >
                        {result.status}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>Provider: {result.provider}</span>
                      <span>•</span>
                      <span>Cost: ${result.cost?.toFixed(2) || '0.00'}</span>
                      {result.confidence_score && (
                        <>
                          <span>•</span>
                          <span>Confidence: {Math.round(result.confidence_score * 100)}%</span>
                        </>
                      )}
                    </div>

                    {result.enriched_data && Object.keys(result.enriched_data).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {Object.keys(result.enriched_data).slice(0, 3).map((key) => (
                          <Badge key={key} variant="outline" className="text-xs">
                            {key}
                          </Badge>
                        ))}
                        {Object.keys(result.enriched_data).length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{Object.keys(result.enriched_data).length - 3} more
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

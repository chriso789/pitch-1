import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, AlertCircle } from "lucide-react";

interface SkipTraceStatusBadgeProps {
  status?: 'completed' | 'pending' | 'failed' | null;
  confidenceScore?: number;
  lastTracedAt?: string;
}

export const SkipTraceStatusBadge = ({ 
  status, 
  confidenceScore,
  lastTracedAt 
}: SkipTraceStatusBadgeProps) => {
  if (!status) {
    return (
      <Badge variant="outline" className="text-xs px-2 py-1 bg-muted/10 text-muted-foreground border-muted/20">
        Not Traced
      </Badge>
    );
  }

  if (status === 'completed' && confidenceScore) {
    const scoreColor = confidenceScore >= 0.8 
      ? 'bg-success/10 text-success border-success/20' 
      : confidenceScore >= 0.6
      ? 'bg-warning/10 text-warning border-warning/20'
      : 'bg-muted/10 text-muted-foreground border-muted/20';

    return (
      <Badge className={`text-xs px-2 py-1 ${scoreColor}`}>
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Enriched {Math.round(confidenceScore * 100)}%
      </Badge>
    );
  }

  if (status === 'pending') {
    return (
      <Badge className="text-xs px-2 py-1 bg-warning/10 text-warning border-warning/20">
        <Clock className="h-3 w-3 mr-1" />
        Pending
      </Badge>
    );
  }

  if (status === 'failed') {
    return (
      <Badge className="text-xs px-2 py-1 bg-destructive/10 text-destructive border-destructive/20">
        <AlertCircle className="h-3 w-3 mr-1" />
        Failed
      </Badge>
    );
  }

  return null;
};

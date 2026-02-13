import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { MapPin, Users } from "lucide-react";

interface AreaStatsBadgeProps {
  total: number;
  contacted: number;
  className?: string;
  compact?: boolean;
}

export default function AreaStatsBadge({ total, contacted, className, compact }: AreaStatsBadgeProps) {
  const pct = total > 0 ? Math.round((contacted / total) * 100) : 0;

  if (compact) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-[10px] text-muted-foreground", className)}>
        <MapPin className="h-3 w-3" />
        {contacted}/{total} ({pct}%)
      </span>
    );
  }

  return (
    <div className={cn("rounded-lg border bg-card p-3 space-y-2", className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          Properties
        </span>
        <span className="font-medium">
          {contacted} / {total} <span className="text-muted-foreground">({pct}%)</span>
        </span>
      </div>
      <Progress value={pct} className="h-2" />
    </div>
  );
}

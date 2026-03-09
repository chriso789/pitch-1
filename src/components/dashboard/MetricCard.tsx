import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface MetricCardProps {
  title: string;
  count: number;
  icon: LucideIcon;
  onClick?: () => void;
  variant?: "default" | "warning" | "danger";
}

export function MetricCard({ title, count, icon: Icon, onClick, variant = "default" }: MetricCardProps) {
  const isZero = count === 0;
  
  const variantStyles = {
    default: "text-primary",
    warning: "text-orange-600",
    danger: "text-destructive"
  };

  return (
    <Card 
      variant="elevated"
      className={cn(
        "cursor-pointer",
        onClick && "hover:border-primary/30"
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className={cn(
              "text-2xl font-bold",
              isZero ? "text-muted-foreground" : variantStyles[variant]
            )} style={{ textShadow: isZero ? 'none' : '0 1px 2px hsl(214 100% 25% / 0.08)' }}>
              {count}
            </div>
            <div className="text-sm text-muted-foreground truncate" title={title}>
              {title}
            </div>
          </div>
          <div className={cn(
            "h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0 embossed",
            isZero ? "bg-muted" : "bg-gradient-to-br from-primary/15 to-primary/5"
          )}>
            <Icon className={cn(
              "h-5 w-5",
              isZero ? "text-muted-foreground/50" : variantStyles[variant]
            )} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

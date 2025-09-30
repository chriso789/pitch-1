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
      className={cn(
        "cursor-pointer transition-all hover:shadow-md",
        onClick && "hover:border-primary"
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className={cn(
              "text-3xl font-bold mb-1",
              isZero ? "text-muted-foreground" : variantStyles[variant]
            )}>
              {count}
            </div>
            <div className="text-sm text-muted-foreground">
              {title}
            </div>
          </div>
          <Icon className={cn(
            "h-8 w-8",
            isZero ? "text-muted-foreground/50" : variantStyles[variant]
          )} />
        </div>
      </CardContent>
    </Card>
  );
}

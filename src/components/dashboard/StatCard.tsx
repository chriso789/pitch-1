import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  iconBgClass?: string;
  iconClass?: string;
  valueClass?: string;
  onClick?: () => void;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  iconBgClass = "bg-primary/10",
  iconClass = "text-primary",
  valueClass = "text-foreground",
  onClick,
}: StatCardProps) {
  return (
    <Card
      className={cn(
        "shadow-soft transition-smooth hover:shadow-medium",
        onClick && "cursor-pointer hover:border-primary"
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="text-sm font-medium text-muted-foreground truncate">
                    {label}
                  </p>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{label}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <p className={cn("text-2xl font-bold", valueClass)}>{value}</p>
          </div>
          <div
            className={cn(
              "h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0",
              iconBgClass
            )}
          >
            <Icon className={cn("h-5 w-5", iconClass)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

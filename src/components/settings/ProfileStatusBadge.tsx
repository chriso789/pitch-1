import React from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle, Clock, AlertCircle, User, Phone, Briefcase, Camera } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProfileStatusBadgeProps {
  loginCount: number;
  hasPhoto: boolean;
  hasPhone: boolean;
  hasTitle: boolean;
  showCompletion?: boolean;
  className?: string;
}

export const ProfileStatusBadge: React.FC<ProfileStatusBadgeProps> = ({
  loginCount,
  hasPhoto,
  hasPhone,
  hasTitle,
  showCompletion = true,
  className
}) => {
  const isActivated = loginCount > 0;
  
  // Calculate profile completion (each field worth 25%)
  const completionItems = [
    { label: "Photo uploaded", done: hasPhoto, icon: Camera },
    { label: "Phone number", done: hasPhone, icon: Phone },
    { label: "Title set", done: hasTitle, icon: Briefcase },
    { label: "Account activated", done: isActivated, icon: User },
  ];
  
  const completedCount = completionItems.filter(item => item.done).length;
  const completionPercentage = Math.round((completedCount / completionItems.length) * 100);
  
  const missingItems = completionItems.filter(item => !item.done);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* Activation Badge */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant={isActivated ? "default" : "secondary"}
              className={cn(
                "flex items-center gap-1.5 cursor-help",
                isActivated 
                  ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" 
                  : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
              )}
            >
              {isActivated ? (
                <CheckCircle className="h-3 w-3" />
              ) : (
                <Clock className="h-3 w-3" />
              )}
              {isActivated ? "Activated" : "Pending"}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {isActivated 
              ? `User has logged in ${loginCount} time${loginCount !== 1 ? 's' : ''}`
              : "User has not yet activated their account"
            }
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Profile Completion Ring */}
      {showCompletion && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="relative cursor-help">
                <svg className="h-8 w-8 -rotate-90">
                  <circle
                    cx="16"
                    cy="16"
                    r="12"
                    className="fill-none stroke-muted stroke-2"
                  />
                  <circle
                    cx="16"
                    cy="16"
                    r="12"
                    className={cn(
                      "fill-none stroke-2 transition-all",
                      completionPercentage === 100 
                        ? "stroke-green-500" 
                        : completionPercentage >= 75 
                          ? "stroke-blue-500"
                          : completionPercentage >= 50 
                            ? "stroke-amber-500" 
                            : "stroke-red-500"
                    )}
                    strokeDasharray={`${(completionPercentage / 100) * 75.4} 75.4`}
                    strokeLinecap="round"
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium">
                  {completionPercentage}%
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent className="p-3">
              <p className="font-medium mb-2">Profile Completion: {completionPercentage}%</p>
              <ul className="space-y-1 text-sm">
                {completionItems.map((item, idx) => (
                  <li key={idx} className="flex items-center gap-2">
                    {item.done ? (
                      <CheckCircle className="h-3 w-3 text-green-500" />
                    ) : (
                      <AlertCircle className="h-3 w-3 text-amber-500" />
                    )}
                    <span className={item.done ? "text-muted-foreground" : ""}>
                      {item.label}
                    </span>
                  </li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
};

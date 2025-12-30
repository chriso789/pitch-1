import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CheckCircle, Circle, Camera, Phone, Briefcase, LogIn, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProfileCompletionChecklistProps {
  hasPhoto: boolean;
  hasPhone: boolean;
  hasTitle: boolean;
  isActivated: boolean;
  onUploadPhoto?: () => void;
  onAddPhone?: () => void;
  onAddTitle?: () => void;
  onResendInvite?: () => void;
  compact?: boolean;
}

export const ProfileCompletionChecklist: React.FC<ProfileCompletionChecklistProps> = ({
  hasPhoto,
  hasPhone,
  hasTitle,
  isActivated,
  onUploadPhoto,
  onAddPhone,
  onAddTitle,
  onResendInvite,
  compact = false
}) => {
  const items = [
    {
      label: "Profile photo uploaded",
      done: hasPhoto,
      icon: Camera,
      action: onUploadPhoto,
      actionLabel: "Upload Photo"
    },
    {
      label: "Phone number added",
      done: hasPhone,
      icon: Phone,
      action: onAddPhone,
      actionLabel: "Add Phone"
    },
    {
      label: "Job title set",
      done: hasTitle,
      icon: Briefcase,
      action: onAddTitle,
      actionLabel: "Set Title"
    },
    {
      label: "Account activated",
      done: isActivated,
      icon: LogIn,
      action: onResendInvite,
      actionLabel: "Resend Invite"
    },
  ];

  const completedCount = items.filter(item => item.done).length;
  const completionPercentage = Math.round((completedCount / items.length) * 100);

  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Profile Completion</span>
          <span className="font-medium">{completionPercentage}%</span>
        </div>
        <Progress value={completionPercentage} className="h-2" />
        {completionPercentage < 100 && (
          <p className="text-xs text-muted-foreground">
            {4 - completedCount} item{4 - completedCount !== 1 ? 's' : ''} remaining
          </p>
        )}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span>Profile Completion</span>
          <span className={cn(
            "text-sm font-normal px-2 py-0.5 rounded-full",
            completionPercentage === 100 
              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
              : "bg-muted text-muted-foreground"
          )}>
            {completionPercentage}%
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={completionPercentage} className="h-2" />
        
        <ul className="space-y-3">
          {items.map((item, idx) => (
            <li 
              key={idx} 
              className={cn(
                "flex items-center justify-between py-2 px-3 rounded-lg transition-colors",
                item.done 
                  ? "bg-green-50 dark:bg-green-900/10" 
                  : "bg-amber-50 dark:bg-amber-900/10"
              )}
            >
              <div className="flex items-center gap-3">
                {item.done ? (
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                ) : (
                  <Circle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                )}
                <div className="flex items-center gap-2">
                  <item.icon className={cn(
                    "h-4 w-4",
                    item.done ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"
                  )} />
                  <span className={cn(
                    "text-sm font-medium",
                    item.done ? "text-green-800 dark:text-green-300" : "text-amber-800 dark:text-amber-300"
                  )}>
                    {item.label}
                  </span>
                </div>
              </div>
              
              {!item.done && item.action && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={item.action}
                  className="h-7 text-xs gap-1"
                >
                  {item.actionLabel}
                  <ArrowRight className="h-3 w-3" />
                </Button>
              )}
            </li>
          ))}
        </ul>

        {completionPercentage === 100 && (
          <p className="text-sm text-green-700 dark:text-green-400 text-center py-2">
            🎉 Profile is complete!
          </p>
        )}
      </CardContent>
    </Card>
  );
};

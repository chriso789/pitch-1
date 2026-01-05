/**
 * User Login Status Badge Component
 * Visual indicator for user login status in tables and lists
 */

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDistanceToNow, format } from "date-fns";
import { AlertCircle, CheckCircle2, Clock, Activity } from "lucide-react";

interface UserLoginStatusBadgeProps {
  lastLogin: string | null;
  isActivated: boolean;
  passwordSetAt?: string | null;
  compact?: boolean;
}

export const UserLoginStatusBadge: React.FC<UserLoginStatusBadgeProps> = ({
  lastLogin,
  isActivated,
  passwordSetAt,
  compact = false,
}) => {
  // Password created but never logged in since
  if (passwordSetAt && !lastLogin) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" className="gap-1 cursor-default bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
              <CheckCircle2 className="h-3 w-3" />
              {!compact && "Password Created"}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p className="font-medium">Password Set</p>
            <p className="text-xs text-muted-foreground">
              Created: {format(new Date(passwordSetAt), "MMM d, yyyy 'at' h:mm a")}
            </p>
            <p className="text-xs text-muted-foreground">
              User has not logged in since setting password
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Never logged in and no password set
  if (!lastLogin || !isActivated) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="destructive" className="gap-1 cursor-default">
              <AlertCircle className="h-3 w-3" />
              {!compact && "Never logged in"}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p className="font-medium">Account Not Activated</p>
            <p className="text-xs text-muted-foreground">
              User has never logged into the system
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const lastLoginDate = new Date(lastLogin);
  const now = new Date();
  const hoursDiff = (now.getTime() - lastLoginDate.getTime()) / (1000 * 60 * 60);

  // Active now (within last hour)
  if (hoursDiff < 1) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge className="gap-1 bg-green-500/90 hover:bg-green-500 cursor-default">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-100 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-200" />
              </span>
              {!compact && "Active now"}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p className="font-medium">Currently Active</p>
            <p className="text-xs text-muted-foreground">
              Last activity: {formatDistanceToNow(lastLoginDate, { addSuffix: true })}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Today (within last 24 hours)
  if (hoursDiff < 24) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" className="gap-1 cursor-default">
              <Activity className="h-3 w-3" />
              {!compact && formatDistanceToNow(lastLoginDate, { addSuffix: true })}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p className="font-medium">Active Today</p>
            <p className="text-xs text-muted-foreground">
              {format(lastLoginDate, "MMM d, yyyy 'at' h:mm a")}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Recent (within last 7 days)
  if (hoursDiff < 168) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="gap-1 cursor-default">
              <CheckCircle2 className="h-3 w-3 text-muted-foreground" />
              {!compact && formatDistanceToNow(lastLoginDate, { addSuffix: true })}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p className="font-medium">Recently Active</p>
            <p className="text-xs text-muted-foreground">
              {format(lastLoginDate, "MMM d, yyyy 'at' h:mm a")}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Inactive (more than 7 days)
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="gap-1 text-muted-foreground cursor-default">
            <Clock className="h-3 w-3" />
            {!compact && formatDistanceToNow(lastLoginDate, { addSuffix: true })}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="font-medium">Inactive</p>
          <p className="text-xs text-muted-foreground">
            Last login: {format(lastLoginDate, "MMM d, yyyy 'at' h:mm a")}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

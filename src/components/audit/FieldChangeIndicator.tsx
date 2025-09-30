import React, { useState } from 'react';
import { Badge } from "@/components/ui/badge";
import { 
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { MapPin, User, Calendar } from "lucide-react";
import { formatDistanceToNow } from 'date-fns';

interface FieldChangeIndicatorProps {
  fieldName: string;
  lastModified?: {
    timestamp: string;
    userName: string;
    location?: string;
  };
}

export const FieldChangeIndicator = ({ 
  fieldName, 
  lastModified 
}: FieldChangeIndicatorProps) => {
  if (!lastModified) return null;

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <Badge 
          variant="outline" 
          className="ml-2 cursor-help text-xs"
        >
          <User className="h-3 w-3 mr-1" />
          Modified {formatDistanceToNow(new Date(lastModified.timestamp), { addSuffix: true })}
        </Badge>
      </HoverCardTrigger>
      <HoverCardContent className="w-80">
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">{fieldName} - Change History</h4>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span>Modified by: <strong>{lastModified.userName}</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span>{new Date(lastModified.timestamp).toLocaleString()}</span>
            </div>
            {lastModified.location && (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span>{lastModified.location}</span>
              </div>
            )}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};
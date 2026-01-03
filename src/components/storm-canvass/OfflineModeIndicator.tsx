import React, { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Popover, 
  PopoverContent, 
  PopoverTrigger 
} from '@/components/ui/popover';
import { unifiedOfflineStore } from '@/services/unifiedOfflineStore';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import {
  Wifi,
  WifiOff,
  Cloud,
  CloudOff,
  RefreshCw,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface OfflineModeIndicatorProps {
  compact?: boolean;
  className?: string;
}

export const OfflineModeIndicator: React.FC<OfflineModeIndicatorProps> = ({
  compact = false,
  className,
}) => {
  const { isOnline, isSyncing, syncNow } = useOfflineSync();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const loadCount = async () => {
      const count = await unifiedOfflineStore.getTotalPendingCount();
      setPendingCount(count);
    };

    loadCount();
    const interval = setInterval(loadCount, 5000);
    return () => clearInterval(interval);
  }, []);

  if (compact) {
    return (
      <div className={cn('flex items-center gap-1', className)}>
        {isOnline ? (
          <Wifi className="h-4 w-4 text-green-500" />
        ) : (
          <WifiOff className="h-4 w-4 text-red-500" />
        )}
        {pendingCount > 0 && (
          <Badge variant="secondary" className="h-5 px-1.5 text-xs">
            {pendingCount}
          </Badge>
        )}
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'gap-2 h-8',
            !isOnline && 'bg-yellow-500/10 hover:bg-yellow-500/20',
            className
          )}
        >
          {isOnline ? (
            <Cloud className="h-4 w-4 text-green-500" />
          ) : (
            <CloudOff className="h-4 w-4 text-yellow-500" />
          )}
          {pendingCount > 0 && (
            <Badge 
              variant={isOnline ? 'secondary' : 'outline'} 
              className="h-5 px-1.5"
            >
              {pendingCount}
            </Badge>
          )}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isOnline ? (
                <>
                  <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-sm font-medium">Online</span>
                </>
              ) : (
                <>
                  <div className="h-2 w-2 rounded-full bg-yellow-500" />
                  <span className="text-sm font-medium">Offline Mode</span>
                </>
              )}
            </div>
            {isOnline && pendingCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={syncNow}
                disabled={isSyncing}
                className="h-7 text-xs"
              >
                <RefreshCw className={cn('h-3 w-3 mr-1', isSyncing && 'animate-spin')} />
                Sync
              </Button>
            )}
          </div>

          {pendingCount > 0 ? (
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{pendingCount}</span> items waiting to sync
              {!isOnline && (
                <p className="text-xs mt-1">
                  Items will sync automatically when you reconnect
                </p>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              All data is synced
            </div>
          )}

          {!isOnline && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground">
                Your work is being saved locally. Continue capturing photos, notes, and updating dispositions.
              </p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

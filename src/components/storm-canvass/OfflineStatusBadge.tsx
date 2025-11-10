import { WifiOff, Wifi, RefreshCw, CloudOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { formatDistanceToNow } from 'date-fns';

export default function OfflineStatusBadge() {
  const { isOnline, pendingCount, isSyncing, lastSyncAt, syncNow } = useOfflineSync();

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Badge
        variant={isOnline ? 'default' : 'destructive'}
        className="flex items-center gap-1.5"
      >
        {isOnline ? (
          <>
            <Wifi className="h-3 w-3" />
            <span>Online</span>
          </>
        ) : (
          <>
            <WifiOff className="h-3 w-3" />
            <span>Offline</span>
          </>
        )}
      </Badge>

      {pendingCount > 0 && (
        <Badge variant="outline" className="flex items-center gap-1.5">
          <CloudOff className="h-3 w-3" />
          <span>{pendingCount} queued</span>
        </Badge>
      )}

      {isOnline && pendingCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={syncNow}
          disabled={isSyncing}
          className="h-8 px-2"
        >
          <RefreshCw className={`h-3 w-3 mr-1 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Syncing...' : 'Sync Now'}
        </Button>
      )}

      {lastSyncAt && isOnline && (
        <span className="text-xs text-muted-foreground">
          Last sync: {formatDistanceToNow(lastSyncAt, { addSuffix: true })}
        </span>
      )}
    </div>
  );
}

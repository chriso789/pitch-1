import { Cloud, CloudOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PendingSyncBadgeProps {
  synced: boolean;
  className?: string;
}

const PendingSyncBadge = ({ synced, className }: PendingSyncBadgeProps) => {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors duration-300',
        synced
          ? 'bg-green-500/10 text-green-600 dark:text-green-400'
          : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 animate-pulse',
        className
      )}
    >
      {synced ? <Cloud className="h-3 w-3" /> : <CloudOff className="h-3 w-3" />}
      {synced ? 'Synced' : 'Pending sync'}
    </span>
  );
};

export default PendingSyncBadge;

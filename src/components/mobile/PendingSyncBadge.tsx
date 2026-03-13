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
          ? 'bg-primary/10 text-primary'
          : 'bg-destructive/10 text-destructive animate-pulse',
        className
      )}
    >
      {synced ? <Cloud className="h-3 w-3" /> : <CloudOff className="h-3 w-3" />}
      {synced ? 'Synced' : 'Pending sync'}
    </span>
  );
};

export default PendingSyncBadge;

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface CLJBadgeProps {
  cljNumber: string | null | undefined;
  variant?: 'default' | 'outline' | 'secondary' | 'destructive';
  className?: string;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const CLJBadge = ({ 
  cljNumber, 
  variant = 'secondary',
  className,
  showLabel = false,
  size = 'md'
}: CLJBadgeProps) => {
  if (!cljNumber) {
    return (
      <Badge variant="outline" className={cn('font-mono text-muted-foreground', className)}>
        {showLabel && 'C-L-J: '}Not assigned
      </Badge>
    );
  }

  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0',
    md: 'text-sm px-2 py-0.5',
    lg: 'text-base px-3 py-1'
  };

  return (
    <Badge 
      variant={variant} 
      className={cn('font-mono', sizeClasses[size], className)}
    >
      {showLabel && 'C-L-J: '}
      {cljNumber}
    </Badge>
  );
};

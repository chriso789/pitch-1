import React from 'react';
import { Flame, Snowflake } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StreakIndicatorProps {
  streak: number;
  size?: 'sm' | 'md' | 'lg';
}

export function StreakIndicator({ streak, size = 'md' }: StreakIndicatorProps) {
  const sizeClasses = {
    sm: { container: 'px-2 py-1', icon: 'h-4 w-4', text: 'text-sm' },
    md: { container: 'px-3 py-2', icon: 'h-5 w-5', text: 'text-lg' },
    lg: { container: 'px-4 py-3', icon: 'h-6 w-6', text: 'text-2xl' },
  };

  const sizes = sizeClasses[size];

  // Different flame colors based on streak length
  const getFlameStyle = (days: number) => {
    if (days >= 30) return { color: 'text-purple-500', bg: 'bg-purple-100 dark:bg-purple-950', label: 'Legendary!' };
    if (days >= 14) return { color: 'text-red-500', bg: 'bg-red-100 dark:bg-red-950', label: 'On Fire!' };
    if (days >= 7) return { color: 'text-orange-500', bg: 'bg-orange-100 dark:bg-orange-950', label: 'Hot Streak!' };
    if (days >= 3) return { color: 'text-yellow-500', bg: 'bg-yellow-100 dark:bg-yellow-950', label: 'Warming Up' };
    if (days > 0) return { color: 'text-gray-500', bg: 'bg-gray-100 dark:bg-gray-900', label: 'Getting Started' };
    return { color: 'text-blue-500', bg: 'bg-blue-100 dark:bg-blue-950', label: 'No Streak' };
  };

  const style = getFlameStyle(streak);

  return (
    <div className={cn(
      "flex items-center gap-2 rounded-full",
      sizes.container,
      style.bg
    )}>
      {streak > 0 ? (
        <>
          <div className="relative">
            <Flame className={cn(sizes.icon, style.color, streak >= 7 && 'animate-pulse')} fill="currentColor" />
            {streak >= 14 && (
              <Flame 
                className={cn("absolute inset-0", sizes.icon, "text-yellow-300 opacity-50 animate-ping")} 
                fill="currentColor" 
              />
            )}
          </div>
          <div className="flex flex-col">
            <span className={cn(sizes.text, 'font-bold leading-none', style.color)}>
              {streak}
            </span>
            <span className="text-[10px] text-muted-foreground leading-none">
              day streak
            </span>
          </div>
        </>
      ) : (
        <>
          <Snowflake className={cn(sizes.icon, style.color)} />
          <span className="text-sm text-muted-foreground">No streak</span>
        </>
      )}
    </div>
  );
}

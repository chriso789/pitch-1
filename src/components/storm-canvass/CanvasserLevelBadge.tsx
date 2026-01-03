import React from 'react';
import { cn } from '@/lib/utils';
import { Star, Zap, Crown, Flame, Medal, Award, Trophy, Shield } from 'lucide-react';

interface CanvasserLevelBadgeProps {
  level: number;
  xpProgress: number;
  size?: 'sm' | 'md' | 'lg';
}

export function CanvasserLevelBadge({ level, xpProgress, size = 'md' }: CanvasserLevelBadgeProps) {
  // Level tiers with different styles
  const getLevelTier = (lvl: number) => {
    if (lvl >= 50) return { name: 'Legend', icon: Crown, gradient: 'from-yellow-400 via-yellow-500 to-orange-500', textColor: 'text-yellow-900' };
    if (lvl >= 30) return { name: 'Elite', icon: Trophy, gradient: 'from-purple-400 via-purple-500 to-pink-500', textColor: 'text-purple-900' };
    if (lvl >= 20) return { name: 'Veteran', icon: Award, gradient: 'from-blue-400 via-blue-500 to-indigo-500', textColor: 'text-blue-900' };
    if (lvl >= 10) return { name: 'Pro', icon: Flame, gradient: 'from-orange-400 via-red-500 to-pink-500', textColor: 'text-orange-900' };
    if (lvl >= 5) return { name: 'Rising Star', icon: Star, gradient: 'from-green-400 via-green-500 to-teal-500', textColor: 'text-green-900' };
    return { name: 'Rookie', icon: Zap, gradient: 'from-gray-400 via-gray-500 to-gray-600', textColor: 'text-gray-900' };
  };

  const tier = getLevelTier(level);
  const IconComponent = tier.icon;

  const sizeClasses = {
    sm: { container: 'h-10 w-10', icon: 'h-4 w-4', text: 'text-xs' },
    md: { container: 'h-16 w-16', icon: 'h-6 w-6', text: 'text-sm' },
    lg: { container: 'h-24 w-24', icon: 'h-10 w-10', text: 'text-lg' },
  };

  const sizes = sizeClasses[size];

  return (
    <div className="relative">
      {/* Outer Ring with Progress */}
      <div className={cn(
        "relative rounded-full",
        sizes.container
      )}>
        {/* Progress Ring */}
        <svg className="absolute inset-0 w-full h-full -rotate-90">
          <circle
            className="stroke-muted"
            strokeWidth="3"
            fill="none"
            r="45%"
            cx="50%"
            cy="50%"
          />
          <circle
            className="stroke-primary transition-all duration-500"
            strokeWidth="3"
            fill="none"
            r="45%"
            cx="50%"
            cy="50%"
            strokeDasharray={`${xpProgress * 2.83} 283`}
            strokeLinecap="round"
          />
        </svg>

        {/* Center Badge */}
        <div className={cn(
          "absolute inset-1 rounded-full flex items-center justify-center",
          `bg-gradient-to-br ${tier.gradient}`,
          "shadow-lg"
        )}>
          <div className="flex flex-col items-center">
            <IconComponent className={cn(sizes.icon, 'text-white drop-shadow-md')} />
            <span className={cn(sizes.text, 'font-bold text-white drop-shadow-md')}>
              {level}
            </span>
          </div>
        </div>
      </div>

      {/* Tier Name */}
      {size !== 'sm' && (
        <p className="text-center text-xs font-medium text-muted-foreground mt-1">
          {tier.name}
        </p>
      )}
    </div>
  );
}

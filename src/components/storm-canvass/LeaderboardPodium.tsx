import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Crown, Medal } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PodiumEntry {
  rank: number;
  user_id: string;
  score: number;
  doors_knocked: number;
  leads_generated: number;
  user?: {
    id: string;
    first_name: string;
    last_name: string;
    avatar_url: string | null;
  };
}

interface LeaderboardPodiumProps {
  topThree: PodiumEntry[];
}

export function LeaderboardPodium({ topThree }: LeaderboardPodiumProps) {
  if (topThree.length < 3) return null;

  const [first, second, third] = topThree;

  const PodiumSpot = ({ 
    entry, 
    position, 
    height, 
    gradient 
  }: { 
    entry: PodiumEntry; 
    position: 1 | 2 | 3;
    height: string;
    gradient: string;
  }) => {
    const medals = {
      1: { emoji: '🥇', color: 'from-yellow-400 to-yellow-600', crown: true },
      2: { emoji: '🥈', color: 'from-gray-300 to-gray-500', crown: false },
      3: { emoji: '🥉', color: 'from-orange-400 to-orange-600', crown: false },
    };

    const medal = medals[position];

    return (
      <div className="flex flex-col items-center">
        {/* Avatar with crown for #1 */}
        <div className="relative mb-2">
          {medal.crown && (
            <Crown 
              className="absolute -top-6 left-1/2 -translate-x-1/2 h-8 w-8 text-yellow-500 animate-bounce" 
              fill="currentColor"
            />
          )}
          <Avatar className={cn(
            "border-4 shadow-lg",
            position === 1 ? "h-20 w-20 border-yellow-400" : "h-16 w-16",
            position === 2 && "border-gray-400",
            position === 3 && "border-orange-400"
          )}>
            <AvatarImage src={entry.user?.avatar_url || undefined} />
            <AvatarFallback className="text-lg font-bold">
              {entry.user?.first_name?.[0]}{entry.user?.last_name?.[0]}
            </AvatarFallback>
          </Avatar>
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-2xl">
            {medal.emoji}
          </div>
        </div>

        {/* Name */}
        <p className="font-semibold text-center mt-3 truncate max-w-[120px]">
          {entry.user?.first_name} {entry.user?.last_name?.[0]}.
        </p>

        {/* Score */}
        <p className="text-lg font-bold">{entry.score.toLocaleString()} pts</p>

        {/* Stats */}
        <p className="text-xs text-muted-foreground">
          {entry.doors_knocked} doors • {entry.leads_generated} leads
        </p>

        {/* Podium Stand */}
        <div 
          className={cn(
            "w-24 rounded-t-lg mt-3 flex items-end justify-center pb-2",
            `bg-gradient-to-b ${gradient}`,
            height
          )}
        >
          <span className="text-3xl font-bold text-white drop-shadow-md">
            {position}
          </span>
        </div>
      </div>
    );
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="pt-8 pb-0">
        <div className="flex items-end justify-center gap-2">
          {/* 2nd Place - Left */}
          <PodiumSpot 
            entry={second} 
            position={2} 
            height="h-28"
            gradient="from-gray-400 to-gray-600"
          />
          
          {/* 1st Place - Center (Tallest) */}
          <PodiumSpot 
            entry={first} 
            position={1} 
            height="h-36"
            gradient="from-yellow-400 to-yellow-600"
          />
          
          {/* 3rd Place - Right */}
          <PodiumSpot 
            entry={third} 
            position={3} 
            height="h-20"
            gradient="from-orange-400 to-orange-600"
          />
        </div>
      </CardContent>
    </Card>
  );
}

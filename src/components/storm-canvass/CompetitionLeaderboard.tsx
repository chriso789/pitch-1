import React, { useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Trophy, TrendingUp, TrendingDown, Minus, DoorClosed, Users as UsersIcon, Camera } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LeaderboardEntry {
  rank: number;
  user_id: string;
  score: number;
  doors_knocked: number;
  leads_generated: number;
  photos_uploaded: number;
  rank_change: number;
  user?: {
    id: string;
    first_name: string;
    last_name: string;
    avatar_url: string | null;
  };
}

interface CompetitionLeaderboardProps {
  entries: LeaderboardEntry[];
  currentUserId: string;
  autoRefresh?: boolean;
  onRefresh?: () => void;
}

export function CompetitionLeaderboard({ 
  entries, 
  currentUserId,
  autoRefresh = true,
  onRefresh
}: CompetitionLeaderboardProps) {
  const userRowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (userRowRef.current) {
      userRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [entries]);

  const getMedalEmoji = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return null;
  };

  const getRankChangeIndicator = (change: number) => {
    if (change > 0) return <TrendingUp className="h-4 w-4 text-green-500" />;
    if (change < 0) return <TrendingDown className="h-4 w-4 text-destructive" />;
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  };

  const getRowClassName = (entry: LeaderboardEntry) => {
    const isCurrentUser = entry.user_id === currentUserId;
    if (isCurrentUser) {
      return 'bg-primary/10 border-l-4 border-primary font-semibold';
    }
    if (entry.rank === 1) return 'bg-gradient-to-r from-yellow-50 to-transparent dark:from-yellow-950/20';
    if (entry.rank === 2) return 'bg-gradient-to-r from-gray-50 to-transparent dark:from-gray-950/20';
    if (entry.rank === 3) return 'bg-gradient-to-r from-orange-50 to-transparent dark:from-orange-950/20';
    return 'hover:bg-muted/50';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            Live Leaderboard
          </span>
          {autoRefresh && (
            <Badge variant="secondary" className="animate-pulse">
              Live
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {entries.map((entry) => {
            const isCurrentUser = entry.user_id === currentUserId;
            const medal = getMedalEmoji(entry.rank);
            
            return (
              <div
                key={entry.user_id}
                ref={isCurrentUser ? userRowRef : null}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-lg transition-all',
                  getRowClassName(entry)
                )}
              >
                {/* Rank */}
                <div className="flex items-center justify-center w-12 text-center">
                  {medal ? (
                    <span className="text-2xl">{medal}</span>
                  ) : (
                    <span className="text-lg font-bold text-muted-foreground">
                      #{entry.rank}
                    </span>
                  )}
                </div>

                {/* User Info */}
                <Avatar className="h-10 w-10">
                  <AvatarImage src={entry.user?.avatar_url || undefined} />
                  <AvatarFallback>
                    {entry.user?.first_name?.[0]}{entry.user?.last_name?.[0]}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0">
                  <p className={cn("truncate", isCurrentUser && "font-bold")}>
                    {entry.user?.first_name} {entry.user?.last_name}
                    {isCurrentUser && (
                      <Badge variant="secondary" className="ml-2 text-xs">
                        YOU
                      </Badge>
                    )}
                  </p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <DoorClosed className="h-3 w-3" />
                      {entry.doors_knocked}
                    </span>
                    <span className="flex items-center gap-1">
                      <UsersIcon className="h-3 w-3" />
                      {entry.leads_generated}
                    </span>
                    <span className="flex items-center gap-1">
                      <Camera className="h-3 w-3" />
                      {entry.photos_uploaded}
                    </span>
                  </div>
                </div>

                {/* Score & Change */}
                <div className="text-right">
                  <div className="text-lg font-bold">{entry.score.toLocaleString()}</div>
                  <div className="flex items-center gap-1 justify-end">
                    {getRankChangeIndicator(entry.rank_change)}
                    {entry.rank_change !== 0 && (
                      <span className="text-xs">
                        {Math.abs(entry.rank_change)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {entries.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No participants yet
          </div>
        )}
      </CardContent>
    </Card>
  );
}

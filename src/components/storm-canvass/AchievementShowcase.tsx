import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Trophy, Star, Lock, Gift } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  tier: string;
  reward_points: number;
  requirement_value: number;
}

interface UserAchievement {
  id: string;
  achievement_id: string;
  unlocked_at: string;
  claimed_at: string | null;
  achievement?: Achievement;
}

interface AchievementShowcaseProps {
  unlocked: UserAchievement[];
  all: Achievement[];
  totalPoints: number;
  onClaim?: (achievementId: string) => void;
}

export function AchievementShowcase({ 
  unlocked, 
  all, 
  totalPoints,
  onClaim 
}: AchievementShowcaseProps) {
  const unlockedIds = new Set(unlocked.map(ua => ua.achievement_id));
  const unlockedCount = unlocked.length;
  const totalCount = all.length;

  const getTierColor = (tier: string) => {
    switch (tier.toLowerCase()) {
      case 'bronze': return 'text-orange-600 dark:text-orange-400';
      case 'silver': return 'text-gray-600 dark:text-gray-400';
      case 'gold': return 'text-yellow-600 dark:text-yellow-400';
      case 'platinum': return 'text-purple-600 dark:text-purple-400';
      case 'diamond': return 'text-blue-600 dark:text-blue-400';
      default: return 'text-muted-foreground';
    }
  };

  const getTierBadgeVariant = (tier: string): "default" | "secondary" | "outline" => {
    switch (tier.toLowerCase()) {
      case 'gold':
      case 'platinum':
      case 'diamond':
        return 'default';
      case 'silver':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  const recentlyUnlocked = unlocked.slice(0, 6);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            Achievements
          </span>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              {unlockedCount} / {totalCount}
            </Badge>
            <Badge variant="default" className="flex items-center gap-1">
              <Star className="h-3 w-3" />
              {totalPoints} pts
            </Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <Progress value={(unlockedCount / totalCount) * 100} className="h-2" />

        <div>
          <h4 className="text-sm font-semibold mb-3">Recently Unlocked</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {recentlyUnlocked.map((ua) => {
              const achievement = ua.achievement;
              if (!achievement) return null;

              return (
                <Card 
                  key={ua.id} 
                  className={cn(
                    "overflow-hidden transition-all hover:shadow-lg",
                    !ua.claimed_at && "ring-2 ring-primary"
                  )}
                >
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className={cn("text-3xl", getTierColor(achievement.tier))}>
                        {achievement.icon}
                      </div>
                      <Badge variant={getTierBadgeVariant(achievement.tier)}>
                        {achievement.tier}
                      </Badge>
                    </div>
                    <div>
                      <p className="font-semibold text-sm truncate">{achievement.name}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {achievement.description}
                      </p>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1 text-primary">
                        <Star className="h-3 w-3" />
                        {achievement.reward_points}
                      </span>
                      {!ua.claimed_at && onClaim && (
                        <Button 
                          size="sm" 
                          variant="secondary"
                          className="h-6 text-xs"
                          onClick={() => onClaim(achievement.id)}
                        >
                          <Gift className="h-3 w-3 mr-1" />
                          Claim
                        </Button>
                      )}
                      {ua.claimed_at && (
                        <Badge variant="secondary" className="text-xs">
                          Claimed
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        <div>
          <h4 className="text-sm font-semibold mb-3">Locked Achievements</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {all
              .filter(a => !unlockedIds.has(a.id))
              .slice(0, 8)
              .map((achievement) => (
                <div 
                  key={achievement.id}
                  className="flex flex-col items-center gap-1 p-3 rounded-lg bg-muted/50 opacity-60"
                >
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  <p className="text-xs text-center truncate w-full">{achievement.name}</p>
                  <Badge variant="outline" className="text-xs">
                    {achievement.tier}
                  </Badge>
                </div>
              ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

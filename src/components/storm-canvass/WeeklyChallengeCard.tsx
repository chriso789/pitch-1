import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Target, Gift, Clock, Trophy, DoorOpen, Camera, Users, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWeeklyChallenge, getTimeRemaining } from '@/hooks/useWeeklyChallenge';

export function WeeklyChallengeCard() {
  const { data: challenges, isLoading } = useWeeklyChallenge();

  const getIcon = (icon: string) => {
    switch (icon) {
      case '🚪': return <DoorOpen className="h-5 w-5 text-blue-500" />;
      case '🎯': return <Users className="h-5 w-5 text-green-500" />;
      case '📸': return <Camera className="h-5 w-5 text-purple-500" />;
      case '🏆': return <Trophy className="h-5 w-5 text-yellow-500" />;
      default: return <Target className="h-5 w-5 text-primary" />;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Weekly Challenges
          </span>
          {challenges?.[0]?.endDate && (
            <Badge variant="outline" className="text-xs">
              <Clock className="h-3 w-3 mr-1" />
              {getTimeRemaining(challenges[0].endDate)}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {challenges?.map((challenge) => {
          const isComplete = challenge.completed;

          return (
            <div 
              key={challenge.id}
              className={cn(
                "p-3 rounded-lg border transition-all",
                isComplete 
                  ? "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800" 
                  : "bg-muted/30"
              )}
            >
              <div className="flex items-start gap-3">
                <div className={cn(
                  "p-2 rounded-full",
                  isComplete ? "bg-green-100 dark:bg-green-900" : "bg-muted"
                )}>
                  {isComplete ? (
                    <Trophy className="h-5 w-5 text-green-600" />
                  ) : (
                    getIcon(challenge.icon)
                  )}
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{challenge.name}</p>
                    <span className="text-sm font-bold">
                      {challenge.current}/{challenge.target}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    {challenge.description}
                  </p>
                  <Progress value={challenge.progress} className="h-2" />
                  
                  {/* Reward */}
                  <div className="flex items-center gap-1 mt-2">
                    <Gift className="h-3 w-3 text-yellow-500" />
                    <span className="text-xs text-muted-foreground">
                      {isComplete ? 'Claimed!' : challenge.reward}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {(!challenges || challenges.length === 0) && (
          <div className="text-center py-4 text-muted-foreground">
            No active challenges
          </div>
        )}
      </CardContent>
    </Card>
  );
}

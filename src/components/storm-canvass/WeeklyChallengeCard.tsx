import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Target, Gift, Clock, Trophy, DoorOpen, Camera, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Challenge {
  id: string;
  title: string;
  description: string;
  target: number;
  current: number;
  reward: string;
  icon: React.ReactNode;
  endsAt: Date;
}

export function WeeklyChallengeCard() {
  const { profile } = useUserProfile();
  const { user } = useAuth();
  const tenantId = profile?.tenant_id;

  // Calculate this week's challenges based on user's activity
  const { data: challenges } = useQuery({
    queryKey: ['weekly-challenges', tenantId, user?.id],
    queryFn: async () => {
      if (!tenantId || !user?.id) return [];

      // Get start of current week
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);

      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(endOfWeek.getDate() + 7);

      // Get this week's activities
      const { data: activities } = await supabase
        .from('canvass_activity_log')
        .select('activity_type')
        .eq('tenant_id', tenantId)
        .eq('user_id', user.id)
        .gte('created_at', startOfWeek.toISOString())
        .lt('created_at', endOfWeek.toISOString()) as any;

      const counts = {
        door_knock: 0,
        lead_generated: 0,
        photo_uploaded: 0,
      };

      (activities || []).forEach((a: any) => {
        if (counts[a.activity_type as keyof typeof counts] !== undefined) {
          counts[a.activity_type as keyof typeof counts]++;
        }
      });

      return [
        {
          id: 'doors-50',
          title: 'Door Crusher',
          description: 'Knock 50 doors this week',
          target: 50,
          current: counts.door_knock,
          reward: '+250 XP Bonus',
          icon: <DoorOpen className="h-5 w-5 text-blue-500" />,
          endsAt: endOfWeek,
        },
        {
          id: 'leads-10',
          title: 'Lead Machine',
          description: 'Generate 10 qualified leads',
          target: 10,
          current: counts.lead_generated,
          reward: '+500 XP Bonus',
          icon: <Users className="h-5 w-5 text-green-500" />,
          endsAt: endOfWeek,
        },
        {
          id: 'photos-25',
          title: 'Shutterbug',
          description: 'Upload 25 property photos',
          target: 25,
          current: counts.photo_uploaded,
          reward: '+125 XP Bonus',
          icon: <Camera className="h-5 w-5 text-purple-500" />,
          endsAt: endOfWeek,
        },
      ] as Challenge[];
    },
    enabled: !!tenantId && !!user?.id,
  });

  const getTimeRemaining = (endDate: Date) => {
    const now = new Date();
    const diff = endDate.getTime() - now.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (days > 0) return `${days}d ${hours}h left`;
    return `${hours}h left`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Weekly Challenges
          </span>
          {challenges?.[0]?.endsAt && (
            <Badge variant="outline" className="text-xs">
              <Clock className="h-3 w-3 mr-1" />
              {getTimeRemaining(challenges[0].endsAt)}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {challenges?.map((challenge) => {
          const progress = Math.min((challenge.current / challenge.target) * 100, 100);
          const isComplete = challenge.current >= challenge.target;

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
                    challenge.icon
                  )}
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{challenge.title}</p>
                    <span className="text-sm font-bold">
                      {challenge.current}/{challenge.target}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    {challenge.description}
                  </p>
                  <Progress value={progress} className="h-2" />
                  
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

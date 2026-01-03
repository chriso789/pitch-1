import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { 
  DoorOpen, 
  Target, 
  Camera, 
  Flame, 
  Star, 
  Trophy,
  Zap,
  Crown,
  Medal,
  Award
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  unlocked: boolean;
  unlockedAt?: string;
  progress?: number;
  target?: number;
}

const tierStyles = {
  bronze: 'from-orange-400 to-orange-600 border-orange-500',
  silver: 'from-gray-300 to-gray-500 border-gray-400',
  gold: 'from-yellow-400 to-yellow-600 border-yellow-500',
  platinum: 'from-purple-400 to-pink-500 border-purple-500',
};

export function AchievementBadgesGrid() {
  const { profile } = useUserProfile();
  const { user } = useAuth();
  const tenantId = profile?.tenant_id;

  const { data: achievements } = useQuery({
    queryKey: ['user-achievements', tenantId, user?.id],
    queryFn: async () => {
      if (!tenantId || !user?.id) return [];

      // Get user's activity counts
      const { data: activities } = await supabase
        .from('canvass_activity_log')
        .select('activity_type')
        .eq('tenant_id', tenantId)
        .eq('user_id', user.id) as any;

      const counts = {
        door_knock: 0,
        lead_generated: 0,
        photo_uploaded: 0,
        deal_closed: 0,
      };

      (activities || []).forEach((a: any) => {
        if (counts[a.activity_type as keyof typeof counts] !== undefined) {
          counts[a.activity_type as keyof typeof counts]++;
        }
      });

      // Define achievements based on activity counts
      const achievementDefs: Achievement[] = [
        {
          id: 'first-knock',
          name: 'First Knock',
          description: 'Knock your first door',
          icon: <DoorOpen className="h-5 w-5" />,
          tier: 'bronze',
          unlocked: counts.door_knock >= 1,
          progress: Math.min(counts.door_knock, 1),
          target: 1,
        },
        {
          id: 'door-warrior',
          name: 'Door Warrior',
          description: 'Knock 100 doors',
          icon: <DoorOpen className="h-5 w-5" />,
          tier: 'silver',
          unlocked: counts.door_knock >= 100,
          progress: Math.min(counts.door_knock, 100),
          target: 100,
        },
        {
          id: 'door-master',
          name: 'Door Master',
          description: 'Knock 500 doors',
          icon: <DoorOpen className="h-5 w-5" />,
          tier: 'gold',
          unlocked: counts.door_knock >= 500,
          progress: Math.min(counts.door_knock, 500),
          target: 500,
        },
        {
          id: 'lead-finder',
          name: 'Lead Finder',
          description: 'Generate 10 leads',
          icon: <Target className="h-5 w-5" />,
          tier: 'bronze',
          unlocked: counts.lead_generated >= 10,
          progress: Math.min(counts.lead_generated, 10),
          target: 10,
        },
        {
          id: 'lead-hunter',
          name: 'Lead Hunter',
          description: 'Generate 50 leads',
          icon: <Target className="h-5 w-5" />,
          tier: 'silver',
          unlocked: counts.lead_generated >= 50,
          progress: Math.min(counts.lead_generated, 50),
          target: 50,
        },
        {
          id: 'lead-legend',
          name: 'Lead Legend',
          description: 'Generate 200 leads',
          icon: <Target className="h-5 w-5" />,
          tier: 'gold',
          unlocked: counts.lead_generated >= 200,
          progress: Math.min(counts.lead_generated, 200),
          target: 200,
        },
        {
          id: 'photographer',
          name: 'Photographer',
          description: 'Upload 25 photos',
          icon: <Camera className="h-5 w-5" />,
          tier: 'bronze',
          unlocked: counts.photo_uploaded >= 25,
          progress: Math.min(counts.photo_uploaded, 25),
          target: 25,
        },
        {
          id: 'closer',
          name: 'First Close',
          description: 'Close your first deal',
          icon: <Trophy className="h-5 w-5" />,
          tier: 'gold',
          unlocked: counts.deal_closed >= 1,
          progress: Math.min(counts.deal_closed, 1),
          target: 1,
        },
      ];

      return achievementDefs;
    },
    enabled: !!tenantId && !!user?.id,
  });

  const unlockedAchievements = achievements?.filter(a => a.unlocked) || [];
  const lockedAchievements = achievements?.filter(a => !a.unlocked).slice(0, 4) || [];

  return (
    <div className="space-y-4">
      {/* Unlocked Achievements */}
      {unlockedAchievements.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {unlockedAchievements.map((achievement) => (
            <div
              key={achievement.id}
              className={cn(
                "relative p-2 rounded-full border-2",
                `bg-gradient-to-br ${tierStyles[achievement.tier]}`
              )}
              title={`${achievement.name}: ${achievement.description}`}
            >
              <div className="text-white">
                {achievement.icon}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Next to Unlock */}
      {lockedAchievements.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium">Next to unlock:</p>
          {lockedAchievements.slice(0, 2).map((achievement) => (
            <div
              key={achievement.id}
              className="flex items-center gap-2 p-2 rounded-lg bg-muted/30 opacity-60"
            >
              <div className="p-1.5 rounded-full bg-muted text-muted-foreground">
                {achievement.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{achievement.name}</p>
                <p className="text-xs text-muted-foreground">
                  {achievement.progress}/{achievement.target}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {(!achievements || achievements.length === 0) && (
        <div className="text-center py-4 text-muted-foreground text-sm">
          Start canvassing to earn achievements!
        </div>
      )}
    </div>
  );
}

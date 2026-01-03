import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { startOfWeek, endOfWeek, differenceInHours } from 'date-fns';

export interface WeeklyChallenge {
  id: string;
  name: string;
  description: string;
  target: number;
  current: number;
  progress: number;
  reward: string;
  icon: string;
  endDate: Date;
  completed: boolean;
  challengeType: 'doors' | 'leads' | 'photos' | 'deals';
}

export function useWeeklyChallenge() {
  const { user } = useAuth();
  const { profile } = useUserProfile();
  const tenantId = profile?.tenant_id;

  return useQuery({
    queryKey: ['weekly-challenges', tenantId, user?.id],
    queryFn: async (): Promise<WeeklyChallenge[]> => {
      if (!tenantId || !user?.id) return [];

      const now = new Date();
      const weekStart = startOfWeek(now, { weekStartsOn: 1 }); // Monday
      const weekEnd = endOfWeek(now, { weekStartsOn: 1 });

      // Fetch active competitions for this week
      const { data: competitions } = await supabase
        .from('canvass_competitions')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .gte('end_date', now.toISOString())
        .lte('start_date', now.toISOString());

      // Fetch user's activity for this week
      const { data: activities } = await supabase
        .from('canvass_activity_log')
        .select('activity_type, id')
        .eq('user_id', user.id)
        .eq('tenant_id', tenantId)
        .gte('created_at', weekStart.toISOString())
        .lte('created_at', weekEnd.toISOString());

      // Count activities by type
      const activityCounts: Record<string, number> = {
        door_knock: 0,
        lead_generated: 0,
        photo_captured: 0,
        deal_closed: 0,
      };

      activities?.forEach(activity => {
        if (activityCounts[activity.activity_type] !== undefined) {
          activityCounts[activity.activity_type]++;
        }
      });

      // Map competitions to challenges
      if (competitions && competitions.length > 0) {
        return competitions.map(comp => {
          const criteria = comp.scoring_criteria as any || {};
          const challengeType = criteria.activity_type || 'doors';
          
          let current = 0;
          let icon = '🚪';
          
          switch (challengeType) {
            case 'doors':
            case 'door_knock':
              current = activityCounts.door_knock;
              icon = '🚪';
              break;
            case 'leads':
            case 'lead_generated':
              current = activityCounts.lead_generated;
              icon = '🎯';
              break;
            case 'photos':
            case 'photo_captured':
              current = activityCounts.photo_captured;
              icon = '📸';
              break;
            case 'deals':
            case 'deal_closed':
              current = activityCounts.deal_closed;
              icon = '🏆';
              break;
          }

          const target = criteria.target || 100;
          const progress = Math.min((current / target) * 100, 100);
          const prizePool = comp.prize_pool as any || {};

          return {
            id: comp.id,
            name: comp.name,
            description: comp.description || `Complete ${target} ${challengeType} this week`,
            target,
            current,
            progress,
            reward: prizePool.first_place || '$100',
            icon,
            endDate: new Date(comp.end_date),
            completed: progress >= 100,
            challengeType: challengeType as WeeklyChallenge['challengeType'],
          };
        });
      }

      // Default weekly challenges if no competitions configured
      return [
        {
          id: 'default-doors',
          name: 'Door Crusher',
          description: 'Knock 100 doors this week',
          target: 100,
          current: activityCounts.door_knock,
          progress: Math.min((activityCounts.door_knock / 100) * 100, 100),
          reward: '🏆 Top Performer Badge',
          icon: '🚪',
          endDate: weekEnd,
          completed: activityCounts.door_knock >= 100,
          challengeType: 'doors' as const,
        },
        {
          id: 'default-leads',
          name: 'Lead Machine',
          description: 'Generate 25 leads this week',
          target: 25,
          current: activityCounts.lead_generated,
          progress: Math.min((activityCounts.lead_generated / 25) * 100, 100),
          reward: '$50 Bonus',
          icon: '🎯',
          endDate: weekEnd,
          completed: activityCounts.lead_generated >= 25,
          challengeType: 'leads' as const,
        },
        {
          id: 'default-photos',
          name: 'Shutterbug',
          description: 'Capture 50 property photos',
          target: 50,
          current: activityCounts.photo_captured,
          progress: Math.min((activityCounts.photo_captured / 50) * 100, 100),
          reward: 'Extra Break Day',
          icon: '📸',
          endDate: weekEnd,
          completed: activityCounts.photo_captured >= 50,
          challengeType: 'photos' as const,
        },
      ];
    },
    enabled: !!tenantId && !!user?.id,
    refetchInterval: 60000, // Refresh every minute
  });
}

export function getTimeRemaining(endDate: Date): string {
  const now = new Date();
  const hoursLeft = differenceInHours(endDate, now);
  
  if (hoursLeft < 0) return 'Ended';
  if (hoursLeft < 24) return `${hoursLeft}h left`;
  
  const daysLeft = Math.floor(hoursLeft / 24);
  return `${daysLeft}d ${hoursLeft % 24}h left`;
}

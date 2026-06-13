import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

export interface ActivityFilters {
  startDate?: string;
  endDate?: string;
  userId?: string;
  dispositionId?: string;
  locationId?: string;
}

export interface CanvassActivity {
  id: string;
  tenant_id: string;
  user_id: string;
  contact_id: string | null;
  location_id: string | null;
  activity_type: string;
  activity_data: any;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  contact?: {
    id: string;
    first_name: string;
    last_name: string;
    address_street: string;
    address_city: string;
    address_state: string;
    address_zip: string;
    qualification_status: string;
  };
  user?: {
    first_name: string;
    last_name: string;
  };
}

export interface Disposition {
  id: string;
  name: string;
  /** Stable key matching contacts.qualification_status (e.g. "interested", "storm_damage"). */
  key?: string;
  is_positive: boolean;
  color?: string;
}

export const useStormCanvass = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const getActivities = async (filters: ActivityFilters = {}): Promise<CanvassActivity[]> => {
    setLoading(true);
    try {
      let query = supabase
        .from('canvass_activity_log')
        .select('*')
        .order('created_at', { ascending: false });

      if (filters.startDate) {
        query = query.gte('created_at', filters.startDate);
      }
      if (filters.endDate) {
        query = query.lte('created_at', filters.endDate);
      }
      if (filters.userId) {
        query = query.eq('user_id', filters.userId);
      }
      if (filters.locationId) {
        query = query.eq('location_id', filters.locationId);
      }

      const { data: activities, error } = await query;

      if (error) throw error;
      if (!activities) return [];

      // Fetch related contacts and users
      const contactIds = activities.map((a) => a.contact_id).filter(Boolean) as string[];
      const userIds = activities.map((a) => a.user_id).filter(Boolean);

      const [contactsData, usersData] = await Promise.all([
        contactIds.length > 0
          ? supabase
              .from('contacts')
              .select('id, first_name, last_name, address_street, address_city, address_state, address_zip, qualification_status')
              .in('id', contactIds)
          : Promise.resolve({ data: [] }),
        userIds.length > 0
          ? supabase
              .from('profiles')
              .select('id, first_name, last_name')
              .in('id', userIds)
          : Promise.resolve({ data: [] }),
      ]);

      const contactsMap = new Map((contactsData.data || []).map((c) => [c.id, c]));
      const usersMap = new Map((usersData.data || []).map((u) => [u.id, u]));

      // Combine the data
      const enrichedActivities: CanvassActivity[] = activities.map((activity) => ({
        ...activity,
        contact: activity.contact_id ? contactsMap.get(activity.contact_id) : undefined,
        user: usersMap.get(activity.user_id),
      })) as CanvassActivity[];

      return enrichedActivities;
    } catch (error: any) {
      toast({
        title: 'Error loading activities',
        description: error.message,
        variant: 'destructive',
      });
      return [];
    } finally {
      setLoading(false);
    }
  };

  const getDispositions = async (): Promise<Disposition[]> => {
    try {
      // Unified source of truth: canvass dispositions == contact statuses for the tenant.
      // This guarantees the option a rep picks on a pin is the exact same status that
      // appears on the contact's record in the CRM contacts list.
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data: profile } = await supabase
        .from('profiles')
        .select('active_tenant_id, tenant_id')
        .eq('id', user.id)
        .single();

      const tenantId = profile?.active_tenant_id || profile?.tenant_id;
      if (!tenantId) return [];

      const { data, error } = await supabase
        .from('contact_statuses')
        .select('id, name, key, color, is_active, status_order')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('status_order', { ascending: true });

      if (error) throw error;

      const positiveKeys = new Set([
        'interested', 'qualified', 'appointment_set', 'storm_damage',
        'new_roof', 'past_customer', 'follow_up', 'callback',
      ]);

      return (data || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        key: s.key,
        color: s.color,
        is_positive: positiveKeys.has((s.key || '').toLowerCase()),
      }));
    } catch (error: any) {
      toast({
        title: 'Error loading dispositions',
        description: error.message,
        variant: 'destructive',
      });
      return [];
    }
  };

  const updateDisposition = async (
    contactId: string,
    dispositionId: string,
    notes: string
  ) => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No active session');

      // Get user profile for tenant_id
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, tenant_id')
        .eq('id', user.id)
        .single();

      // Get disposition details from the unified contact_statuses table
      const { data: disposition, error: dispError } = await supabase
        .from('contact_statuses')
        .select('name, key')
        .eq('id', dispositionId)
        .single();

      if (dispError || !disposition) {
        throw new Error('Disposition not found');
      }

      const positiveKeys = new Set([
        'interested', 'qualified', 'appointment_set', 'storm_damage',
        'new_roof', 'past_customer', 'follow_up', 'callback',
      ]);
      const dispKey = (disposition.key || '').toLowerCase();
      const isPositive = positiveKeys.has(dispKey);

      // Check current contact status before overwriting
      const { data: currentContact } = await supabase
        .from('contacts')
        .select('qualification_status, latitude, longitude')
        .eq('id', contactId)
        .single();

      const protectedStatuses = ['project', 'closed', 'past_customer', 'completed'];
      const currentStatus = currentContact?.qualification_status?.toLowerCase();
      const isProtected = currentStatus && protectedStatuses.includes(currentStatus);

      // Use the EXACT status key from contact_statuses so the contacts list
      // shows the same label the rep picked on the canvass map.
      const qualificationStatus = disposition.key || 'lead';

      // Only update qualification_status if not in a protected lifecycle stage
      if (!isProtected) {
        const { error: updateError } = await supabase
          .from('contacts')
          .update({
            qualification_status: qualificationStatus,
            notes: notes ? `${notes}\n\nDisposition: ${disposition.name}` : `Disposition: ${disposition.name}`,
          })
          .eq('id', contactId);

        if (updateError) throw updateError;
      } else {
        // Still update notes even if status is protected
        const { error: updateError } = await supabase
          .from('contacts')
          .update({
            notes: notes ? `${notes}\n\nDisposition: ${disposition.name} (status preserved: ${currentStatus})` : `Disposition: ${disposition.name} (status preserved: ${currentStatus})`,
          })
          .eq('id', contactId);

        if (updateError) throw updateError;
      }

      // Log activity to canvass_activity_log
      if (profile?.tenant_id) {
        await supabase.from('canvass_activity_log').insert({
          user_id: user.id,
          tenant_id: profile.tenant_id,
          activity_type: 'disposition_set',
          contact_id: contactId,
          latitude: currentContact?.latitude || null,
          longitude: currentContact?.longitude || null,
          activity_data: {
            disposition_id: dispositionId,
            disposition_name: disposition.name,
            disposition_key: disposition.key,
            is_positive: isPositive,
            qualification_status: isProtected ? currentStatus : qualificationStatus,
            status_protected: isProtected,
            notes: notes || null,
          },
        });
      }

      let pipelineCreated = false;

      // Always sync to contacts pipeline — create entry for any disposition
      // so reps in the field immediately see the contact on the board with
      // the status they selected in Storm Canvass.
      if (profile?.tenant_id) {
        // Use the unified status key as the pipeline status so the kanban
        // and contacts list show the SAME label the rep picked on the map.
        const pipelineStatus = disposition.key || 'lead';

        const { data: existingPipeline } = await supabase
          .from('pipeline_entries')
          .select('id')
          .eq('contact_id', contactId)
          .eq('tenant_id', profile.tenant_id)
          .maybeSingle();

        if (!existingPipeline) {
          const { error: pipelineError } = await supabase
            .from('pipeline_entries')
            .insert({
              contact_id: contactId,
              tenant_id: profile.tenant_id,
              status: pipelineStatus,
              lead_quality_score: isPositive ? 80 : 40,
              assigned_to: user.id,
              metadata: { source: 'canvassing', disposition: disposition.name, disposition_key: disposition.key },
              created_by: user.id,
            });

          if (!pipelineError) {
            pipelineCreated = true;
          } else {
            console.error('Pipeline insert failed:', pipelineError);
          }
        } else if (!isProtected) {
          await supabase
            .from('pipeline_entries')
            .update({
              status: pipelineStatus,
              metadata: { source: 'canvassing', disposition: disposition.name },
            })
            .eq('id', existingPipeline.id)
            .eq('tenant_id', profile.tenant_id);
        }
      }

      toast({
        title: 'Disposition updated',
        description: isProtected
          ? `Disposition logged. Status "${currentStatus}" preserved.`
          : `Contact marked as ${disposition.name}`,
      });

      if (pipelineCreated) {
        toast({
          title: 'Lead added to pipeline!',
        });
      }

      return { success: true, disposition: disposition.name, pipeline_created: pipelineCreated };
    } catch (error: any) {
      toast({
        title: 'Error updating disposition',
        description: error.message,
        variant: 'destructive',
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const getStats = async (userId?: string, dateRange?: { start: string; end: string }) => {
    try {
      let query = supabase.from('canvass_activity_log').select('*');

      if (userId) {
        query = query.eq('user_id', userId);
      }
      if (dateRange) {
        query = query.gte('created_at', dateRange.start).lte('created_at', dateRange.end);
      }

      const { data, error } = await query;
      if (error) throw error;

      const doorsKnocked = data?.filter((a) => a.activity_type === 'door_knock').length || 0;
      const leadsGenerated = data?.filter((a) => a.activity_type === 'lead_created' || a.activity_type === 'disposition_set').length || 0;
      const photosUploaded = data?.filter((a) => a.activity_type === 'photo_upload').length || 0;

      return {
        doorsKnocked,
        leadsGenerated,
        photosUploaded,
        conversionRate: doorsKnocked > 0 ? ((leadsGenerated / doorsKnocked) * 100).toFixed(1) : '0',
      };
    } catch (error: any) {
      toast({
        title: 'Error loading stats',
        description: error.message,
        variant: 'destructive',
      });
      return {
        doorsKnocked: 0,
        leadsGenerated: 0,
        photosUploaded: 0,
        conversionRate: '0',
      };
    }
  };

  const getDetailedStats = async (
    userId?: string,
    dateRange?: { start: string; end: string }
  ) => {
    try {
      const filters: ActivityFilters = {};
      if (userId) filters.userId = userId;
      if (dateRange) {
        filters.startDate = dateRange.start;
        filters.endDate = dateRange.end;
      }

      const activities = await getActivities(filters);

      // Calculate daily activity data
      const dailyMap = new Map<string, { date: string; doors: number; leads: number; photos: number }>();
      
      activities.forEach((activity) => {
        const date = format(new Date(activity.created_at), 'MMM dd');
        if (!dailyMap.has(date)) {
          dailyMap.set(date, { date, doors: 0, leads: 0, photos: 0 });
        }
        const day = dailyMap.get(date)!;
        
        if (activity.activity_type === 'door_knock') day.doors++;
        if (activity.activity_type === 'lead_created' || activity.activity_type === 'disposition_set') day.leads++;
        if (activity.activity_type === 'photo_upload') day.photos++;
      });

      const dailyActivityData = Array.from(dailyMap.values()).sort((a, b) => {
        return new Date(a.date).getTime() - new Date(b.date).getTime();
      });

      // Calculate disposition breakdown from activity_data when available, fallback to contact status
      const dispositionMap = new Map<string, number>();
      activities.forEach((activity) => {
        let status = 'unknown';
        // Prefer disposition from activity_data (reliable, logged at time of action)
        if (activity.activity_data?.disposition_name) {
          status = activity.activity_data.disposition_name;
        } else if (activity.activity_data?.disposition) {
          status = activity.activity_data.disposition;
        } else if (activity.contact?.qualification_status) {
          status = activity.contact.qualification_status;
        }
        dispositionMap.set(status, (dispositionMap.get(status) || 0) + 1);
      });

      const getDispositionColor = (status: string) => {
        switch (status.toLowerCase()) {
          case 'qualified': return 'hsl(var(--chart-1))';
          case 'not_qualified': return 'hsl(var(--chart-2))';
          case 'follow_up': return 'hsl(var(--chart-3))';
          case 'no_answer': return 'hsl(var(--chart-4))';
          default: return 'hsl(var(--chart-5))';
        }
      };

      const dispositionBreakdown = Array.from(dispositionMap.entries()).map(([name, value]) => ({
        name: name.replace(/_/g, ' ').toUpperCase(),
        value,
        fill: getDispositionColor(name),
      }));

      // Calculate basic metrics
      const doorsKnocked = activities.filter(a => a.activity_type === 'door_knock').length;
      const leadsGenerated = activities.filter(a => a.activity_type === 'lead_created' || a.activity_type === 'disposition_set').length;
      const photosUploaded = activities.filter(a => a.activity_type === 'photo_upload').length;
      const conversionRate = doorsKnocked > 0 
        ? ((leadsGenerated / doorsKnocked) * 100).toFixed(1)
        : '0.0';

      // Calculate additional metrics
      const uniqueDates = new Set(activities.map(a => format(new Date(a.created_at), 'yyyy-MM-dd')));
      const activeDays = uniqueDates.size;
      const avgDoorsPerDay = activeDays > 0 ? Math.round(doorsKnocked / activeDays) : 0;

      // Find best day
      const doorsByDay = new Map<string, number>();
      activities.filter(a => a.activity_type === 'door_knock').forEach(activity => {
        const date = format(new Date(activity.created_at), 'yyyy-MM-dd');
        doorsByDay.set(date, (doorsByDay.get(date) || 0) + 1);
      });
      
      let bestDayDoors = 0;
      let bestDayDate = '';
      doorsByDay.forEach((count, date) => {
        if (count > bestDayDoors) {
          bestDayDoors = count;
          bestDayDate = date;
        }
      });

      return {
        doorsKnocked,
        leadsGenerated,
        photosUploaded,
        conversionRate,
        avgDoorsPerDay,
        activeDays,
        bestDayDoors,
        bestDayDate: bestDayDate ? format(new Date(bestDayDate), 'MMM dd, yyyy') : 'N/A',
        dailyActivityData,
        dispositionBreakdown,
      };
    } catch (error) {
      console.error('Error getting detailed stats:', error);
      throw error;
    }
  };

  const getCompetitionLeaderboard = async (competitionId: string, limit: number = 20) => {
    try {
      const { data: leaderboard, error } = await supabase
        .from('competition_leaderboards')
        .select(`
          *,
          user:profiles!competition_leaderboards_user_id_fkey(id, first_name, last_name, avatar_url)
        `)
        .eq('competition_id', competitionId)
        .eq('is_final', false)
        .order('rank', { ascending: true })
        .limit(limit);
      
      if (error) throw error;
      return leaderboard || [];
    } catch (error: any) {
      toast({
        title: 'Error loading leaderboard',
        description: error.message,
        variant: 'destructive',
      });
      return [];
    }
  };

  const getUserCompetitions = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('competition_participants')
        .select(`
          *,
          competition:canvass_competitions!competition_participants_competition_id_fkey(*)
        `)
        .eq('user_id', userId)
        .order('last_activity_at', { ascending: false });
      
      if (error) throw error;
      return data || [];
    } catch (error: any) {
      toast({
        title: 'Error loading competitions',
        description: error.message,
        variant: 'destructive',
      });
      return [];
    }
  };

  const getUserAchievements = async (userId: string) => {
    try {
      const { data: unlocked, error: unlockedError } = await supabase
        .from('user_achievements')
        .select(`
          *,
          achievement:canvass_achievements!user_achievements_achievement_id_fkey(*)
        `)
        .eq('user_id', userId)
        .order('unlocked_at', { ascending: false });
      
      if (unlockedError) throw unlockedError;
      
      const { data: allAchievements, error: allError } = await supabase
        .from('canvass_achievements')
        .select('*')
        .eq('is_active', true);
      
      if (allError) throw allError;
      
      return {
        unlocked: unlocked || [],
        all: allAchievements || [],
        totalPoints: unlocked?.reduce((sum: number, ua: any) => sum + (ua.achievement?.reward_points || 0), 0) || 0
      };
    } catch (error: any) {
      toast({
        title: 'Error loading achievements',
        description: error.message,
        variant: 'destructive',
      });
      return { unlocked: [], all: [], totalPoints: 0 };
    }
  };

  const getRewardHistory = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('achievement_rewards')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      return {
        all: data || [],
        pending: data?.filter(r => r.status === 'pending') || [],
        processing: data?.filter(r => r.status === 'processing') || [],
        sent: data?.filter(r => r.status === 'sent') || [],
        claimed: data?.filter(r => r.status === 'claimed') || [],
        totalValue: data?.reduce((sum, r) => sum + Number(r.reward_value), 0) || 0
      };
    } catch (error: any) {
      toast({
        title: 'Error loading rewards',
        description: error.message,
        variant: 'destructive',
      });
      return { all: [], pending: [], processing: [], sent: [], claimed: [], totalValue: 0 };
    }
  };

  const updateCompetitionScores = async (userId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('update-competition-scores', {
        body: { user_id: userId }
      });
      
      if (error) throw error;
      return data;
    } catch (error: any) {
      toast({
        title: 'Error updating scores',
        description: error.message,
        variant: 'destructive',
      });
      throw error;
    }
  };

  return {
    loading,
    getActivities,
    getDispositions,
    updateDisposition,
    getStats,
    getDetailedStats,
    getCompetitionLeaderboard,
    getUserCompetitions,
    getUserAchievements,
    getRewardHistory,
    updateCompetitionScores,
  };
};

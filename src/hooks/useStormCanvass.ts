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
      const { data, error } = await supabase
        .from('dialer_dispositions')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      return data || [];
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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No active session');

      const { data, error } = await supabase.functions.invoke('canvass-dispositions', {
        body: {
          session_token: session.access_token,
          contact_id: contactId,
          disposition_id: dispositionId,
          notes: notes,
        },
      });

      if (error) throw error;

      if (data.success) {
        toast({
          title: 'Disposition updated',
          description: `Contact marked as ${data.disposition}`,
        });
        if (data.pipeline_created) {
          toast({
            title: 'Lead added to pipeline!',
          });
        }
        return data;
      } else {
        throw new Error(data.error || 'Failed to update disposition');
      }
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
      const leadsGenerated = data?.filter((a) => a.activity_type === 'lead_created').length || 0;
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
        if (activity.activity_type === 'lead_created') day.leads++;
        if (activity.activity_type === 'photo_upload') day.photos++;
      });

      const dailyActivityData = Array.from(dailyMap.values()).sort((a, b) => {
        return new Date(a.date).getTime() - new Date(b.date).getTime();
      });

      // Calculate disposition breakdown
      const dispositionMap = new Map<string, number>();
      activities.forEach((activity) => {
        const status = activity.contact?.qualification_status || 'unknown';
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
      const leadsGenerated = activities.filter(a => a.activity_type === 'lead_created').length;
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

  return {
    loading,
    getActivities,
    getDispositions,
    updateDisposition,
    getStats,
    getDetailedStats,
  };
};

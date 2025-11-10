import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface Notification {
  id: string;
  user_id: string;
  type: 'rank_change' | 'achievement_unlock' | 'prize_zone' | 'reward_ready';
  title: string;
  message: string;
  icon: string;
  metadata?: any;
  is_read: boolean;
  created_at: string;
}

export const useNotifications = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const fetchNotifications = async (userId: string) => {
    setLoading(true);
    try {
      const { data, error }: { data: any; error: any } = await supabase
        .from('user_notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      
      setNotifications((data || []) as Notification[]);
      setUnreadCount((data || []).filter((n: any) => !n.is_read).length);
    } catch (error: any) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const addNotification = async (
    userId: string,
    type: Notification['type'],
    title: string,
    message: string,
    icon: string,
    metadata?: any
  ) => {
    try {
      // Get tenant_id from user profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id, active_tenant_id')
        .eq('id', userId)
        .single();

      const tenantId = profile?.active_tenant_id || profile?.tenant_id;
      if (!tenantId) throw new Error('No tenant found');

      const { data, error }: { data: any; error: any } = await supabase
        .from('user_notifications')
        .insert({
          user_id: userId,
          tenant_id: tenantId,
          type,
          title,
          message,
          icon,
          metadata,
          is_read: false,
        })
        .select()
        .single();

      if (error) throw error;
      
      setNotifications(prev => [data as Notification, ...prev]);
      setUnreadCount(prev => prev + 1);
      
      return data as Notification;
    } catch (error: any) {
      console.error('Error adding notification:', error);
      return null;
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      const { error } = await supabase
        .from('user_notifications')
        .update({ is_read: true })
        .eq('id', notificationId);

      if (error) throw error;

      setNotifications(prev =>
        prev.map(n => (n.id === notificationId ? { ...n, is_read: true } : n))
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error: any) {
      console.error('Error marking notification as read:', error);
    }
  };

  const markAllAsRead = async (userId: string) => {
    try {
      const { error } = await supabase
        .from('user_notifications')
        .update({ is_read: true })
        .eq('user_id', userId)
        .eq('is_read', false);

      if (error) throw error;

      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);

      toast({
        title: 'All notifications marked as read',
        duration: 2000,
      });
    } catch (error: any) {
      console.error('Error marking all as read:', error);
    }
  };

  const dismissNotification = async (notificationId: string) => {
    try {
      const { error } = await supabase
        .from('user_notifications')
        .delete()
        .eq('id', notificationId);

      if (error) throw error;

      setNotifications(prev => prev.filter(n => n.id !== notificationId));
      
      const notification = notifications.find(n => n.id === notificationId);
      if (notification && !notification.is_read) {
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (error: any) {
      console.error('Error dismissing notification:', error);
    }
  };

  const clearAllNotifications = async (userId: string) => {
    try {
      const { error } = await supabase
        .from('user_notifications')
        .delete()
        .eq('user_id', userId);

      if (error) throw error;

      setNotifications([]);
      setUnreadCount(0);

      toast({
        title: 'All notifications cleared',
        duration: 2000,
      });
    } catch (error: any) {
      console.error('Error clearing notifications:', error);
    }
  };

  return {
    notifications,
    unreadCount,
    loading,
    fetchNotifications,
    addNotification,
    markAsRead,
    markAllAsRead,
    dismissNotification,
    clearAllNotifications,
  };
};

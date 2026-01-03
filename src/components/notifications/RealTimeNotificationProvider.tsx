import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { NotificationToast } from './NotificationToast';
import confetti from 'canvas-confetti';

interface Notification {
  id: string;
  type: 'lead_hot' | 'estimate_viewed' | 'proposal_signed' | 'appointment_scheduled' | 'deal_closed' | 'security_alert';
  title: string;
  message: string;
  data?: Record<string, any>;
  createdAt: Date;
  read: boolean;
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearNotification: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within RealTimeNotificationProvider');
  }
  return context;
}

interface RealTimeNotificationProviderProps {
  children: React.ReactNode;
}

export function RealTimeNotificationProvider({ children }: RealTimeNotificationProviderProps) {
  const { profile } = useUserProfile();
  const { user } = useAuth();
  const tenantId = profile?.tenant_id;
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // Subscribe to real-time notifications
  useEffect(() => {
    if (!tenantId || !user?.id) return;

    // Subscribe to user_notifications table
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'user_notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newNotification = payload.new as any;
          handleNewNotification(newNotification);
        }
      )
      .subscribe();

    // Also subscribe to real-time broadcast for instant notifications
    const broadcastChannel = supabase
      .channel(`broadcast:${tenantId}:${user.id}`)
      .on('broadcast', { event: 'notification' }, ({ payload }) => {
        handleNewNotification(payload);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(broadcastChannel);
    };
  }, [tenantId, user?.id]);

  // Load initial notifications
  useEffect(() => {
    if (!user?.id) return;

    async function loadNotifications() {
      const { data } = await supabase
        .from('user_notifications')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (data) {
        setNotifications(
          data.map((n: any) => ({
            id: n.id,
            type: n.notification_type,
            title: n.title,
            message: n.message,
            data: n.metadata,
            createdAt: new Date(n.created_at),
            read: n.read,
          }))
        );
      }
    }

    loadNotifications();
  }, [user?.id]);

  const handleNewNotification = useCallback((payload: any) => {
    const notification: Notification = {
      id: payload.id || crypto.randomUUID(),
      type: payload.notification_type || payload.type,
      title: payload.title,
      message: payload.message,
      data: payload.metadata || payload.data,
      createdAt: new Date(),
      read: false,
    };

    setNotifications(prev => [notification, ...prev]);

    // Show toast based on notification type
    switch (notification.type) {
      case 'deal_closed':
        // Celebrate with confetti!
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
        });
        toast.custom(() => (
          <NotificationToast
            notification={notification}
            variant="success"
          />
        ), { duration: 8000 });
        break;

      case 'lead_hot':
        toast.custom(() => (
          <NotificationToast
            notification={notification}
            variant="warning"
          />
        ), { duration: 6000 });
        break;

      case 'proposal_signed':
        confetti({
          particleCount: 50,
          spread: 45,
          origin: { y: 0.7 },
        });
        toast.custom(() => (
          <NotificationToast
            notification={notification}
            variant="success"
          />
        ), { duration: 6000 });
        break;

      case 'security_alert':
        toast.custom(() => (
          <NotificationToast
            notification={notification}
            variant="error"
          />
        ), { duration: 10000 });
        break;

      default:
        toast.custom(() => (
          <NotificationToast notification={notification} />
        ), { duration: 5000 });
    }

    // Play notification sound
    try {
      const audio = new Audio('/notification.mp3');
      audio.volume = 0.3;
      audio.play().catch(() => {});
    } catch (e) {}
  }, []);

  const markAsRead = useCallback(async (id: string) => {
    setNotifications(prev =>
      prev.map(n => (n.id === id ? { ...n, read: true } : n))
    );

    await supabase
      .from('user_notifications')
      .update({ is_read: true })
      .eq('id', id);
  }, []);

  const markAllAsRead = useCallback(async () => {
    const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
    
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));

    if (unreadIds.length > 0) {
      await supabase
        .from('user_notifications')
        .update({ is_read: true })
        .in('id', unreadIds);
    }
  }, [notifications]);

  const clearNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        markAsRead,
        markAllAsRead,
        clearNotification,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

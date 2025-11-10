import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bell, X, CheckCheck, Trash2, TrendingUp, Trophy, DollarSign, Gift, ExternalLink } from 'lucide-react';
import { useNotifications, Notification } from '@/hooks/useNotifications';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

export function NotificationCenter() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string>('');
  const [isOpen, setIsOpen] = useState(false);
  const {
    notifications,
    unreadCount,
    loading,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
    dismissNotification,
    clearAllNotifications,
  } = useNotifications();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setUserId(user.id);
        fetchNotifications(user.id);
      }
    });
  }, []);

  const getNotificationIcon = (type: Notification['type'], icon: string) => {
    if (icon) return icon;
    
    switch (type) {
      case 'rank_change':
        return <TrendingUp className="h-4 w-4 text-primary" />;
      case 'achievement_unlock':
        return <Trophy className="h-4 w-4 text-yellow-500" />;
      case 'prize_zone':
        return <DollarSign className="h-4 w-4 text-green-500" />;
      case 'reward_ready':
        return <Gift className="h-4 w-4 text-purple-500" />;
      default:
        return <Bell className="h-4 w-4" />;
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.is_read) {
      markAsRead(notification.id);
    }
  };

  const getActionButton = (notification: Notification) => {
    switch (notification.type) {
      case 'rank_change':
      case 'prize_zone':
        return {
          label: 'View Leaderboard',
          icon: Trophy,
          action: () => {
            setIsOpen(false);
            navigate('/storm-canvass/leaderboard');
          }
        };
      case 'achievement_unlock':
        return {
          label: 'View Achievements',
          icon: Trophy,
          action: () => {
            setIsOpen(false);
            navigate('/storm-canvass/leaderboard?tab=achievements');
          }
        };
      case 'reward_ready':
        return {
          label: 'View Rewards',
          icon: Gift,
          action: () => {
            setIsOpen(false);
            navigate('/storm-canvass/leaderboard?tab=rewards');
          }
        };
      default:
        return null;
    }
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs animate-pulse"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent 
        align="end" 
        className="w-96 bg-background border shadow-lg z-50"
        sideOffset={8}
      >
        <DropdownMenuLabel className="flex items-center justify-between">
          <span className="text-base font-semibold">Notifications</span>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => markAllAsRead(userId)}
                className="h-7 text-xs"
              >
                <CheckCheck className="h-3 w-3 mr-1" />
                Mark all read
              </Button>
            )}
            {notifications.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => clearAllNotifications(userId)}
                className="h-7 text-xs text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Clear all
              </Button>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <ScrollArea className="h-[400px]">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Bell className="h-5 w-5 animate-pulse" />
              <span className="ml-2">Loading notifications...</span>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Bell className="h-12 w-12 mb-2 opacity-50" />
              <p className="text-sm">No notifications yet</p>
              <p className="text-xs">We'll notify you when something happens</p>
            </div>
          ) : (
            <div className="space-y-1 p-1">
              {notifications.map((notification) => {
                const actionButton = getActionButton(notification);
                
                return (
                  <DropdownMenuItem
                    key={notification.id}
                    className={cn(
                      "flex flex-col gap-2 p-3 cursor-pointer rounded-md transition-colors group",
                      !notification.is_read && "bg-primary/5 hover:bg-primary/10",
                      notification.is_read && "opacity-70"
                    )}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <div className="flex items-start gap-3 w-full">
                      <div className="flex-shrink-0 mt-1">
                        {typeof notification.icon === 'string' && notification.icon.length <= 2 
                          ? <span className="text-xl">{notification.icon}</span>
                          : getNotificationIcon(notification.type, notification.icon)
                        }
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-sm leading-tight">
                            {notification.title}
                          </p>
                          {!notification.is_read && (
                            <div className="h-2 w-2 bg-primary rounded-full flex-shrink-0 mt-1" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {notification.message}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                        </p>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 flex-shrink-0 opacity-0 group-hover:opacity-100 hover:bg-destructive/10"
                        onClick={(e) => {
                          e.stopPropagation();
                          dismissNotification(notification.id);
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>

                    {actionButton && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="w-full h-8 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          actionButton.action();
                        }}
                      >
                        <actionButton.icon className="h-3 w-3 mr-1" />
                        {actionButton.label}
                        <ExternalLink className="h-3 w-3 ml-1" />
                      </Button>
                    )}
                  </DropdownMenuItem>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

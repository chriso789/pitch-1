import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Bell, 
  Check, 
  CheckCheck, 
  Trash2, 
  Filter,
  ArrowLeft
} from 'lucide-react';
import { useNotifications } from '@/components/notifications/RealTimeNotificationProvider';
import { formatDistanceToNow, format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

export default function NotificationsPage() {
  const { notifications, unreadCount, markAsRead, markAllAsRead, clearNotification } = useNotifications();
  const [filter, setFilter] = useState<string>('all');
  const navigate = useNavigate();

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'lead_hot': return '🔥';
      case 'estimate_viewed': return '👁️';
      case 'proposal_signed': return '✍️';
      case 'appointment_scheduled': return '📅';
      case 'deal_closed': return '🎉';
      case 'security_alert': return '🚨';
      default: return '📬';
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'lead_hot': return 'Hot Lead';
      case 'estimate_viewed': return 'Estimate Viewed';
      case 'proposal_signed': return 'Proposal Signed';
      case 'appointment_scheduled': return 'Appointment';
      case 'deal_closed': return 'Deal Closed';
      case 'security_alert': return 'Security Alert';
      default: return 'Notification';
    }
  };

  const filteredNotifications = filter === 'all' 
    ? notifications 
    : filter === 'unread' 
      ? notifications.filter(n => !n.read)
      : notifications.filter(n => n.type === filter);

  const handleNotificationClick = (notification: any) => {
    markAsRead(notification.id);
    
    if (notification.data?.contact_id) {
      navigate(`/contact/${notification.data.contact_id}`);
    } else if (notification.data?.job_id) {
      navigate(`/job/${notification.data.job_id}`);
    }
  };

  return (
    <div className="container max-w-4xl py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Bell className="h-6 w-6" />
              Notifications
            </h1>
            <p className="text-muted-foreground">
              {unreadCount} unread notifications
            </p>
          </div>
        </div>
        
        {unreadCount > 0 && (
          <Button variant="outline" onClick={() => markAllAsRead()}>
            <CheckCheck className="h-4 w-4 mr-2" />
            Mark all as read
          </Button>
        )}
      </div>

      <Tabs defaultValue="all" onValueChange={setFilter}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unread">
            Unread {unreadCount > 0 && `(${unreadCount})`}
          </TabsTrigger>
          <TabsTrigger value="lead_hot">🔥 Hot Leads</TabsTrigger>
          <TabsTrigger value="proposal_signed">✍️ Signed</TabsTrigger>
          <TabsTrigger value="deal_closed">🎉 Closed</TabsTrigger>
        </TabsList>

        <TabsContent value={filter} className="mt-6">
          {filteredNotifications.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Bell className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No notifications to display</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredNotifications.map((notification) => (
                <Card
                  key={notification.id}
                  className={cn(
                    'cursor-pointer hover:shadow-md transition-shadow',
                    !notification.read && 'border-primary/50 bg-primary/5'
                  )}
                  onClick={() => handleNotificationClick(notification)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <span className="text-2xl flex-shrink-0">
                        {getNotificationIcon(notification.type)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className={cn(
                              'font-medium',
                              !notification.read && 'font-semibold'
                            )}>
                              {notification.title}
                            </h3>
                            <p className="text-sm text-muted-foreground mt-1">
                              {notification.message}
                            </p>
                          </div>
                          <Badge variant="secondary" className="flex-shrink-0">
                            {getTypeLabel(notification.type)}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between mt-3">
                          <span className="text-xs text-muted-foreground">
                            {format(notification.createdAt, 'MMM d, yyyy h:mm a')} · {formatDistanceToNow(notification.createdAt, { addSuffix: true })}
                          </span>
                          <div className="flex items-center gap-2">
                            {!notification.read && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  markAsRead(notification.id);
                                }}
                              >
                                <Check className="h-4 w-4 mr-1" />
                                Mark read
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                clearNotification(notification.id);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

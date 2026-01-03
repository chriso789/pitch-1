import React from 'react';
import { 
  Bell, 
  TrendingUp, 
  FileText, 
  Calendar, 
  Trophy, 
  Shield,
  X,
  ExternalLink
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, any>;
}

interface NotificationToastProps {
  notification: Notification;
  variant?: 'default' | 'success' | 'warning' | 'error';
  onDismiss?: () => void;
}

export function NotificationToast({ 
  notification, 
  variant = 'default',
  onDismiss 
}: NotificationToastProps) {
  const navigate = useNavigate();

  const getIcon = () => {
    switch (notification.type) {
      case 'lead_hot':
        return <TrendingUp className="h-5 w-5 text-orange-500" />;
      case 'estimate_viewed':
        return <FileText className="h-5 w-5 text-blue-500" />;
      case 'proposal_signed':
        return <FileText className="h-5 w-5 text-green-500" />;
      case 'appointment_scheduled':
        return <Calendar className="h-5 w-5 text-purple-500" />;
      case 'deal_closed':
        return <Trophy className="h-5 w-5 text-yellow-500" />;
      case 'security_alert':
        return <Shield className="h-5 w-5 text-red-500" />;
      default:
        return <Bell className="h-5 w-5" />;
    }
  };

  const variantStyles = {
    default: 'bg-background border-border',
    success: 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800',
    warning: 'bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-800',
    error: 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800',
  };

  const handleClick = () => {
    if (notification.data?.link) {
      navigate(notification.data.link);
    } else if (notification.data?.contactId) {
      navigate(`/contacts/${notification.data.contactId}`);
    } else if (notification.data?.projectId) {
      navigate(`/projects/${notification.data.projectId}`);
    }
  };

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-4 rounded-lg border shadow-lg max-w-sm",
        "animate-in slide-in-from-right-5 fade-in duration-300",
        variantStyles[variant]
      )}
    >
      {/* Icon */}
      <div className="flex-shrink-0 mt-0.5">
        {getIcon()}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">{notification.title}</p>
        <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
          {notification.message}
        </p>

        {/* Action button if there's a link */}
        {(notification.data?.link || notification.data?.contactId || notification.data?.projectId) && (
          <Button
            variant="link"
            size="sm"
            className="p-0 h-auto mt-1 text-xs"
            onClick={handleClick}
          >
            View Details
            <ExternalLink className="h-3 w-3 ml-1" />
          </Button>
        )}
      </div>

      {/* Dismiss button */}
      {onDismiss && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 flex-shrink-0"
          onClick={onDismiss}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Phone, PhoneOff, Circle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface CallStatusMonitorProps {
  callLog: any;
  onCallEnded: () => void;
}

export const CallStatusMonitor: React.FC<CallStatusMonitorProps> = ({
  callLog,
  onCallEnded
}) => {
  const [currentStatus, setCurrentStatus] = useState(callLog.status);
  const [duration, setDuration] = useState(0);
  const [timer, setTimer] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Poll for status updates every 2 seconds
    const pollInterval = setInterval(async () => {
      const { data, error } = await supabase
        .from('call_logs')
        .select('status, duration_seconds, ended_at')
        .eq('id', callLog.id)
        .single();

      if (data && !error) {
        setCurrentStatus(data.status);
        
        if (['completed', 'failed', 'busy', 'no-answer'].includes(data.status)) {
          clearInterval(pollInterval);
          if (timer) clearInterval(timer);
          onCallEnded();
        }
      }
    }, 2000);

    return () => {
      clearInterval(pollInterval);
      if (timer) clearInterval(timer);
    };
  }, [callLog.id]);

  useEffect(() => {
    // Start timer when call is answered
    if (currentStatus === 'in-progress' && !timer) {
      const interval = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
      setTimer(interval);
    }
  }, [currentStatus]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'initiated':
      case 'ringing':
        return 'bg-blue-500';
      case 'in-progress':
        return 'bg-green-500';
      case 'completed':
        return 'bg-gray-500';
      case 'failed':
      case 'busy':
      case 'no-answer':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'initiated':
        return 'Initiating call...';
      case 'ringing':
        return 'Ringing...';
      case 'in-progress':
        return 'Connected';
      case 'completed':
        return 'Call ended';
      case 'failed':
        return 'Call failed';
      case 'busy':
        return 'Line busy';
      case 'no-answer':
        return 'No answer';
      default:
        return status;
    }
  };

  return (
    <Card className="border-primary">
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Phone className="h-5 w-5 text-primary" />
              {currentStatus === 'in-progress' && (
                <Circle className="h-2 w-2 fill-red-500 text-red-500 absolute -top-1 -right-1 animate-pulse" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium">{getStatusText(currentStatus)}</p>
              {currentStatus === 'in-progress' && (
                <p className="text-xs text-muted-foreground">{formatDuration(duration)}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className={getStatusColor(currentStatus)}>
              {currentStatus}
            </Badge>
            {['initiated', 'ringing', 'in-progress'].includes(currentStatus) && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  // End call logic would go here
                  // For now, just close the monitor
                  onCallEnded();
                }}
              >
                <PhoneOff className="h-4 w-4 mr-2" />
                End
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

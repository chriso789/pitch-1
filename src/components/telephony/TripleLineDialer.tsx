import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Phone, PhoneOff, PhoneForwarded, Mic, MicOff, Users, Timer, Activity, Pause, Play, SkipForward } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCompanySwitcher } from '@/hooks/useCompanySwitcher';
import { toast } from 'sonner';

interface CallLine {
  id: number;
  status: 'idle' | 'dialing' | 'ringing' | 'connected' | 'voicemail' | 'failed';
  contactName?: string;
  phoneNumber?: string;
  callControlId?: string;
  duration?: number;
}

interface TripleLineDialerProps {
  campaignId: string;
  onCallConnected?: (callData: any) => void;
  onCallEnded?: (callData: any) => void;
}

export const TripleLineDialer: React.FC<TripleLineDialerProps> = ({
  campaignId,
  onCallConnected,
  onCallEnded
}) => {
  const { activeCompany } = useCompanySwitcher();
  const [dialMode, setDialMode] = useState<'single' | 'power' | 'triple'>('triple');
  const [isActive, setIsActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [lines, setLines] = useState<CallLine[]>([
    { id: 1, status: 'idle' },
    { id: 2, status: 'idle' },
    { id: 3, status: 'idle' }
  ]);
  const [stats, setStats] = useState({
    callsDialed: 0,
    callsConnected: 0,
    callsPerHour: 0,
    avgCallDuration: 0,
    leadsRemaining: 0
  });
  const [activeTimer, setActiveTimer] = useState(0);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isActive && !isPaused) {
      interval = setInterval(() => {
        setActiveTimer(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isActive, isPaused]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startDialing = async () => {
    if (!activeCompany?.tenant_id) {
      toast.error('No company selected');
      return;
    }

    setIsActive(true);
    setIsPaused(false);
    await dialNextBatch();
  };

  const dialNextBatch = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('triple-line-dialer', {
        body: {
          campaign_id: campaignId,
          tenant_id: activeCompany?.tenant_id,
          user_id: (await supabase.auth.getUser()).data.user?.id,
          dial_mode: dialMode
        }
      });

      if (error) throw error;

      if (data.success && data.calls) {
        // Update line statuses
        const newLines = [...lines];
        data.calls.forEach((call: any, index: number) => {
          if (newLines[index]) {
            newLines[index] = {
              id: index + 1,
              status: call.status === 'ringing' ? 'ringing' : call.status === 'simulated' ? 'dialing' : 'failed',
              contactName: call.contact_name,
              phoneNumber: call.phone,
              callControlId: call.call_control_id
            };
          }
        });
        setLines(newLines);

        setStats(prev => ({
          ...prev,
          callsDialed: prev.callsDialed + data.lines_dialed,
          leadsRemaining: data.leads_remaining
        }));
      } else if (data.leads_remaining === 0) {
        toast.info('No more leads in campaign');
        setIsActive(false);
      }
    } catch (error: any) {
      console.error('Dialer error:', error);
      toast.error(error.message || 'Dialing failed');
    }
  };

  const stopDialing = () => {
    setIsActive(false);
    setIsPaused(false);
    setLines([
      { id: 1, status: 'idle' },
      { id: 2, status: 'idle' },
      { id: 3, status: 'idle' }
    ]);
  };

  const togglePause = () => {
    setIsPaused(!isPaused);
  };

  const skipToNext = async () => {
    // End current calls and dial next batch
    setLines([
      { id: 1, status: 'idle' },
      { id: 2, status: 'idle' },
      { id: 3, status: 'idle' }
    ]);
    await dialNextBatch();
  };

  const connectToLine = (lineId: number) => {
    const line = lines.find(l => l.id === lineId);
    if (line && (line.status === 'ringing' || line.status === 'connected')) {
      // Connect to this line, drop others
      setLines(prev => prev.map(l => ({
        ...l,
        status: l.id === lineId ? 'connected' : l.status === 'ringing' ? 'voicemail' : l.status
      })));
      setStats(prev => ({ ...prev, callsConnected: prev.callsConnected + 1 }));
      onCallConnected?.(line);
      toast.success(`Connected to ${line.contactName || line.phoneNumber}`);
    }
  };

  const getLineColor = (status: CallLine['status']) => {
    switch (status) {
      case 'idle': return 'bg-muted';
      case 'dialing': return 'bg-yellow-500 animate-pulse';
      case 'ringing': return 'bg-blue-500 animate-pulse';
      case 'connected': return 'bg-green-500';
      case 'voicemail': return 'bg-orange-500';
      case 'failed': return 'bg-destructive';
      default: return 'bg-muted';
    }
  };

  const getStatusLabel = (status: CallLine['status']) => {
    switch (status) {
      case 'idle': return 'Idle';
      case 'dialing': return 'Dialing...';
      case 'ringing': return 'Ringing';
      case 'connected': return 'Connected';
      case 'voicemail': return 'Voicemail';
      case 'failed': return 'Failed';
      default: return 'Unknown';
    }
  };

  const maxLines = dialMode === 'triple' ? 3 : dialMode === 'power' ? 2 : 1;

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Triple-Line Power Dialer
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={dialMode} onValueChange={(v: any) => setDialMode(v)} disabled={isActive}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Single Line</SelectItem>
                <SelectItem value="power">Power (2x)</SelectItem>
                <SelectItem value="triple">Triple (3x)</SelectItem>
              </SelectContent>
            </Select>
            <Badge variant="outline" className="ml-2">
              {stats.leadsRemaining} leads remaining
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Call Lines */}
        <div className="grid grid-cols-3 gap-4">
          {lines.slice(0, maxLines).map(line => (
            <Card 
              key={line.id} 
              className={`cursor-pointer transition-all ${line.status === 'ringing' ? 'ring-2 ring-blue-500' : ''}`}
              onClick={() => connectToLine(line.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Line {line.id}</span>
                  <div className={`w-3 h-3 rounded-full ${getLineColor(line.status)}`} />
                </div>
                <div className="space-y-1">
                  <p className="font-medium truncate">
                    {line.contactName || 'Waiting...'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {line.phoneNumber || '-'}
                  </p>
                  <Badge variant={line.status === 'connected' ? 'default' : 'secondary'}>
                    {getStatusLabel(line.status)}
                  </Badge>
                </div>
                {line.status === 'ringing' && (
                  <Button 
                    size="sm" 
                    className="w-full mt-2 bg-green-600 hover:bg-green-700"
                    onClick={(e) => { e.stopPropagation(); connectToLine(line.id); }}
                  >
                    <PhoneForwarded className="h-4 w-4 mr-1" />
                    Connect
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-4">
          {!isActive ? (
            <Button size="lg" onClick={startDialing} className="bg-green-600 hover:bg-green-700">
              <Phone className="h-5 w-5 mr-2" />
              Start Dialing
            </Button>
          ) : (
            <>
              <Button 
                size="lg" 
                variant="outline" 
                onClick={togglePause}
              >
                {isPaused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
              </Button>
              <Button 
                size="lg" 
                variant="outline" 
                onClick={skipToNext}
              >
                <SkipForward className="h-5 w-5" />
              </Button>
              <Button 
                size="lg" 
                variant="outline" 
                onClick={() => setIsMuted(!isMuted)}
              >
                {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </Button>
              <Button 
                size="lg" 
                variant="destructive" 
                onClick={stopDialing}
              >
                <PhoneOff className="h-5 w-5 mr-2" />
                Stop
              </Button>
            </>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 text-center">
              <Activity className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
              <p className="text-2xl font-bold">{stats.callsDialed}</p>
              <p className="text-sm text-muted-foreground">Calls Dialed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <Users className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
              <p className="text-2xl font-bold">{stats.callsConnected}</p>
              <p className="text-sm text-muted-foreground">Connected</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <Timer className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
              <p className="text-2xl font-bold">{formatTime(activeTimer)}</p>
              <p className="text-sm text-muted-foreground">Session Time</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <Phone className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
              <p className="text-2xl font-bold">
                {activeTimer > 0 ? Math.round((stats.callsDialed / activeTimer) * 3600) : 0}
              </p>
              <p className="text-sm text-muted-foreground">Calls/Hour</p>
            </CardContent>
          </Card>
        </div>

        {/* Connection Rate */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Connection Rate</span>
            <span className="text-sm text-muted-foreground">
              {stats.callsDialed > 0 ? ((stats.callsConnected / stats.callsDialed) * 100).toFixed(1) : 0}%
            </span>
          </div>
          <Progress 
            value={stats.callsDialed > 0 ? (stats.callsConnected / stats.callsDialed) * 100 : 0} 
          />
        </div>
      </CardContent>
    </Card>
  );
};

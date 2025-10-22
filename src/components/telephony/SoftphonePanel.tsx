/**
 * Softphone Panel Component
 * Browser-based WebRTC softphone for making and receiving calls
 */

import { useState, useEffect } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { telnyxService, CallState } from '@/services/telnyxService';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export const SoftphonePanel = () => {
  const [callState, setCallState] = useState<CallState>(telnyxService.getCallState());
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    // Subscribe to call state changes
    const unsubscribe = telnyxService.onStateChange((state) => {
      setCallState(state);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleInitialize = async () => {
    setIsInitializing(true);
    const result = await telnyxService.initialize();
    setIsInitializing(false);
    
    if (result.success) {
      setIsInitialized(true);
      toast({
        title: 'Softphone Ready',
        description: 'You can now make and receive calls',
      });
    } else {
      toast({
        title: 'Failed to Initialize',
        description: 'Please check your Telnyx configuration',
        variant: 'destructive',
      });
    }
  };

  const handleCall = async () => {
    if (!phoneNumber) return;

    const result = await telnyxService.makeCall(phoneNumber);
    
    if (!result.success) {
      toast({
        title: 'Call Failed',
        description: 'Unable to place call',
        variant: 'destructive',
      });
    }
  };

  const handleHangup = async () => {
    await telnyxService.endCall();
  };

  const handleAnswer = async () => {
    await telnyxService.answerCall();
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusColor = () => {
    switch (callState.status) {
      case 'active':
        return 'bg-success';
      case 'ringing':
      case 'connecting':
        return 'bg-warning';
      case 'ended':
        return 'bg-destructive';
      default:
        return 'bg-muted';
    }
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Softphone</span>
          <Badge variant="outline" className={cn('transition-colors', getStatusColor())}>
            {callState.status}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isInitialized ? (
          <Button 
            onClick={handleInitialize} 
            disabled={isInitializing}
            className="w-full"
          >
            {isInitializing ? 'Initializing...' : 'Initialize Softphone'}
          </Button>
        ) : (
          <>
            {/* Dialer */}
            {callState.status === 'idle' && (
              <div className="space-y-2">
                <Input
                  type="tel"
                  placeholder="Enter phone number"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCall()}
                />
                <Button 
                  onClick={handleCall} 
                  disabled={!phoneNumber}
                  className="w-full"
                >
                  <Phone className="mr-2 h-4 w-4" />
                  Call
                </Button>
              </div>
            )}

            {/* Active Call */}
            {(callState.status === 'connecting' || 
              callState.status === 'ringing' || 
              callState.status === 'active') && (
              <div className="space-y-4">
                <div className="text-center space-y-2">
                  <div className="text-sm text-muted-foreground">
                    {callState.direction === 'inbound' ? 'Incoming Call' : 'Outbound Call'}
                  </div>
                  <div className="text-lg font-semibold">
                    {callState.remoteNumber || 'Unknown'}
                  </div>
                  {callState.status === 'active' && (
                    <div className="text-2xl font-mono">
                      {formatDuration(callState.duration)}
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  {callState.status === 'ringing' && callState.direction === 'inbound' && (
                    <Button 
                      onClick={handleAnswer}
                      className="flex-1"
                      variant="default"
                    >
                      <Phone className="mr-2 h-4 w-4" />
                      Answer
                    </Button>
                  )}
                  
                  <Button 
                    onClick={handleHangup}
                    className="flex-1"
                    variant="destructive"
                  >
                    <PhoneOff className="mr-2 h-4 w-4" />
                    {callState.status === 'ringing' && callState.direction === 'inbound' 
                      ? 'Decline' 
                      : 'Hang Up'}
                  </Button>
                </div>

                {callState.status === 'active' && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsMuted(!isMuted)}
                      className="flex-1"
                    >
                      {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

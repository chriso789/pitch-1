/**
 * Global Softphone Component
 * Floating/docked softphone for making calls from anywhere
 */

import { useState, useEffect } from 'react';
import { 
  Phone, PhoneOff, Mic, MicOff, X, Minimize2, Maximize2,
  PhoneIncoming, PhoneOutgoing, User, Clock
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { telnyxService, CallState } from '@/services/telnyxService';
import { useToast } from '@/hooks/use-toast';

interface GlobalSoftphoneProps {
  isOpen: boolean;
  onClose: () => void;
  initialNumber?: string;
  contactName?: string;
}

export const GlobalSoftphone = ({ 
  isOpen, 
  onClose, 
  initialNumber = '',
  contactName
}: GlobalSoftphoneProps) => {
  const [callState, setCallState] = useState<CallState>(telnyxService.getCallState());
  const [phoneNumber, setPhoneNumber] = useState(initialNumber);
  const [isMuted, setIsMuted] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setPhoneNumber(initialNumber);
  }, [initialNumber]);

  useEffect(() => {
    const unsubscribe = telnyxService.onStateChange((state) => {
      setCallState(state);
    });
    return () => unsubscribe();
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

  const dialPad = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['*', '0', '#']
  ];

  if (!isOpen) return null;

  // Minimized view during active call
  if (isMinimized && callState.status !== 'idle') {
    return (
      <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-2">
        <Card className="shadow-lg border-primary/20">
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              <div className={cn(
                'h-3 w-3 rounded-full',
                callState.status === 'active' && 'bg-green-500 animate-pulse',
                callState.status === 'ringing' && 'bg-yellow-500 animate-pulse',
                callState.status === 'connecting' && 'bg-blue-500 animate-pulse'
              )} />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {contactName || callState.remoteNumber}
                </p>
                {callState.status === 'active' && (
                  <p className="text-xs text-muted-foreground">
                    {formatDuration(callState.duration)}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setIsMinimized(false)}
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
              <Button
                variant="destructive"
                size="icon"
                className="h-8 w-8"
                onClick={handleHangup}
              >
                <PhoneOff className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-2">
      <Card className="w-72 shadow-xl border-primary/20">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Phone className="h-4 w-4" />
              Softphone
            </CardTitle>
            <div className="flex items-center gap-1">
              {callState.status !== 'idle' && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setIsMinimized(true)}
                >
                  <Minimize2 className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          {/* Status Badge */}
          <Badge 
            variant="outline" 
            className={cn(
              'w-fit mt-2',
              callState.status === 'active' && 'bg-green-500/10 text-green-600 border-green-500/20',
              callState.status === 'ringing' && 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
              callState.status === 'connecting' && 'bg-blue-500/10 text-blue-600 border-blue-500/20'
            )}
          >
            {callState.status}
          </Badge>
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
          ) : callState.status === 'idle' ? (
            <>
              {/* Contact Name */}
              {contactName && (
                <div className="flex items-center gap-2 p-2 bg-muted rounded">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{contactName}</span>
                </div>
              )}

              {/* Phone Number Input */}
              <Input
                type="tel"
                placeholder="Enter phone number"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="text-center text-lg font-mono"
              />

              {/* Dial Pad */}
              <div className="grid grid-cols-3 gap-2">
                {dialPad.flat().map((digit) => (
                  <Button
                    key={digit}
                    variant="outline"
                    className="h-10 text-lg font-medium"
                    onClick={() => setPhoneNumber(prev => prev + digit)}
                  >
                    {digit}
                  </Button>
                ))}
              </div>

              {/* Call Button */}
              <Button
                onClick={handleCall}
                disabled={!phoneNumber}
                className="w-full gap-2"
              >
                <Phone className="h-4 w-4" />
                Call
              </Button>
            </>
          ) : (
            <>
              {/* Active Call UI */}
              <div className="text-center space-y-2">
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  {callState.direction === 'inbound' ? (
                    <PhoneIncoming className="h-4 w-4" />
                  ) : (
                    <PhoneOutgoing className="h-4 w-4" />
                  )}
                  {callState.direction === 'inbound' ? 'Incoming Call' : 'Outbound Call'}
                </div>
                
                <p className="text-lg font-semibold">
                  {contactName || callState.remoteNumber || 'Unknown'}
                </p>
                
                {callState.status === 'active' && (
                  <div className="flex items-center justify-center gap-1 text-2xl font-mono">
                    <Clock className="h-5 w-5 text-muted-foreground" />
                    {formatDuration(callState.duration)}
                  </div>
                )}
              </div>

              {/* Call Controls */}
              <div className="flex justify-center gap-3">
                {callState.status === 'ringing' && callState.direction === 'inbound' && (
                  <Button
                    onClick={handleAnswer}
                    className="flex-1"
                  >
                    <Phone className="h-4 w-4 mr-2" />
                    Answer
                  </Button>
                )}
                
                {callState.status === 'active' && (
                  <Button
                    variant={isMuted ? 'destructive' : 'outline'}
                    size="icon"
                    className="h-12 w-12 rounded-full"
                    onClick={() => setIsMuted(!isMuted)}
                  >
                    {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                  </Button>
                )}
                
                <Button
                  variant="destructive"
                  size="icon"
                  className="h-12 w-12 rounded-full"
                  onClick={handleHangup}
                >
                  <PhoneOff className="h-5 w-5" />
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

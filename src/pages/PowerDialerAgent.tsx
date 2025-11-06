import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Phone, Pause, Play, Square, PhoneCall, User, Mail, MapPin, Timer } from "lucide-react";

type DialerMode = 'preview' | 'power' | 'predictive';
type SessionStatus = 'idle' | 'active' | 'paused';

interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  address?: string;
}

interface DialerSession {
  id: string;
  mode: DialerMode;
  status: string;
  contacts_attempted: number;
  contacts_reached: number;
  contacts_converted: number;
  started_at: string;
}

export default function PowerDialerAgent() {
  const { toast } = useToast();
  const [mode, setMode] = useState<DialerMode>('power');
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [session, setSession] = useState<DialerSession | null>(null);
  const [currentContact, setCurrentContact] = useState<Contact | null>(null);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [callDuration, setCallDuration] = useState(0);
  const [callStartTime, setCallStartTime] = useState<number | null>(null);

  useEffect(() => {
    loadCampaigns();
  }, []);

  useEffect(() => {
    let interval: any;
    if (callStartTime) {
      interval = setInterval(() => {
        setCallDuration(Math.floor((Date.now() - callStartTime) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [callStartTime]);

  const loadCampaigns = async () => {
    const { data } = await supabase
      .from('dialer_campaigns')
      .select('*')
      .eq('status', 'active');
    
    if (data) setCampaigns(data);
  };

  const startSession = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('power-dialer-controller', {
        body: {
          action: 'start',
          mode,
          campaignId: selectedCampaign || null
        }
      });

      if (error) throw error;

      setSession(data.session);
      setStatus('active');
      toast({
        title: "Dialer Started",
        description: `${mode.toUpperCase()} mode activated`
      });

      // Load first contact
      loadNextContact(data.session.id);
    } catch (error: any) {
      toast({
        title: "Failed to start dialer",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const loadNextContact = async (sessionId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('power-dialer-controller', {
        body: {
          action: 'next-contact',
          sessionId,
          mode
        }
      });

      if (error) throw error;

      if (data.contact) {
        setCurrentContact(data.contact);
        
        // Auto-dial in power/predictive mode
        if (mode === 'power' || mode === 'predictive') {
          setTimeout(() => makeCall(data.contact), 500);
        }
      } else {
        toast({
          title: "Queue Empty",
          description: "No more contacts to dial"
        });
        stopSession();
      }
    } catch (error: any) {
      toast({
        title: "Failed to load contact",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const makeCall = async (contact: Contact) => {
    if (!contact.phone) {
      toast({
        title: "No Phone Number",
        description: "This contact doesn't have a phone number",
        variant: "destructive"
      });
      return;
    }

    try {
      setCallStartTime(Date.now());
      
      const { error } = await supabase.functions.invoke('twilio-voice-call', {
        body: {
          contactId: contact.id,
          phoneNumber: contact.phone
        }
      });

      if (error) throw error;

      toast({
        title: "Calling",
        description: `Dialing ${contact.first_name} ${contact.last_name}`
      });
    } catch (error: any) {
      setCallStartTime(null);
      toast({
        title: "Call Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const handleDisposition = async (disposition: string) => {
    if (!currentContact || !session) return;

    try {
      await supabase.functions.invoke('power-dialer-controller', {
        body: {
          action: 'disposition',
          sessionId: session.id,
          contactId: currentContact.id,
          disposition,
          notes
        }
      });

      setCallStartTime(null);
      setCallDuration(0);
      setNotes('');

      toast({
        title: "Disposition Recorded",
        description: `Contact marked as ${disposition}`
      });

      // Load next contact
      loadNextContact(session.id);
    } catch (error: any) {
      toast({
        title: "Failed to save disposition",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const pauseSession = async () => {
    if (!session) return;
    await supabase.functions.invoke('power-dialer-controller', {
      body: { action: 'pause', sessionId: session.id }
    });
    setStatus('paused');
  };

  const resumeSession = async () => {
    if (!session) return;
    await supabase.functions.invoke('power-dialer-controller', {
      body: { action: 'resume', sessionId: session.id }
    });
    setStatus('active');
  };

  const stopSession = async () => {
    if (!session) return;
    await supabase.functions.invoke('power-dialer-controller', {
      body: { action: 'stop', sessionId: session.id }
    });
    setStatus('idle');
    setSession(null);
    setCurrentContact(null);
    setCallStartTime(null);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Power Dialer Agent</h1>
          <p className="text-muted-foreground">AI-powered automated calling system</p>
        </div>
        <Badge variant={status === 'active' ? 'default' : 'secondary'} className="text-lg px-4 py-2">
          {status.toUpperCase()}
        </Badge>
      </div>

      {/* Session Controls */}
      {status === 'idle' ? (
        <Card className="p-6 space-y-4">
          <h2 className="text-xl font-semibold">Start New Session</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Dialing Mode</label>
              <Select value={mode} onValueChange={(v) => setMode(v as DialerMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="preview">Preview - Review before calling</SelectItem>
                  <SelectItem value="power">Power - Auto-dial after disposition</SelectItem>
                  <SelectItem value="predictive">Predictive - Multiple simultaneous calls</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Campaign (Optional)</label>
              <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
                <SelectTrigger>
                  <SelectValue placeholder="All Contacts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Contacts</SelectItem>
                  {campaigns.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={startSession} className="w-full" size="lg">
            <PhoneCall className="mr-2 h-5 w-5" />
            Start Dialing
          </Button>
        </Card>
      ) : (
        <>
          {/* Session Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="p-4">
              <div className="text-sm text-muted-foreground">Attempted</div>
              <div className="text-2xl font-bold">{session?.contacts_attempted || 0}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-muted-foreground">Reached</div>
              <div className="text-2xl font-bold">{session?.contacts_reached || 0}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-muted-foreground">Converted</div>
              <div className="text-2xl font-bold">{session?.contacts_converted || 0}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-muted-foreground">Conversion Rate</div>
              <div className="text-2xl font-bold">
                {session?.contacts_attempted ? 
                  Math.round((session.contacts_converted / session.contacts_attempted) * 100) : 0}%
              </div>
            </Card>
          </div>

          {/* Current Contact */}
          {currentContact && (
            <Card className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-2xl font-bold">
                    {currentContact.first_name} {currentContact.last_name}
                  </h2>
                  {callStartTime && (
                    <div className="flex items-center gap-2 mt-2">
                      <Timer className="h-4 w-4 text-primary animate-pulse" />
                      <span className="text-lg font-mono">{formatTime(callDuration)}</span>
                    </div>
                  )}
                </div>
                {mode === 'preview' && !callStartTime && (
                  <Button onClick={() => makeCall(currentContact)} size="lg">
                    <Phone className="mr-2 h-5 w-5" />
                    Call Now
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                {currentContact.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span>{currentContact.phone}</span>
                  </div>
                )}
                {currentContact.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{currentContact.email}</span>
                  </div>
                )}
                {currentContact.address && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{currentContact.address}</span>
                  </div>
                )}
              </div>

              <Textarea
                placeholder="Call notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mb-4"
                rows={3}
              />

              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <Button onClick={() => handleDisposition('answered')} variant="outline">
                  Answered
                </Button>
                <Button onClick={() => handleDisposition('no_answer')} variant="outline">
                  No Answer
                </Button>
                <Button onClick={() => handleDisposition('voicemail')} variant="outline">
                  Voicemail
                </Button>
                <Button onClick={() => handleDisposition('interested')} variant="default">
                  Interested
                </Button>
                <Button onClick={() => handleDisposition('not_interested')} variant="destructive">
                  Not Interested
                </Button>
              </div>
            </Card>
          )}

          {/* Session Controls */}
          <div className="flex gap-2">
            {status === 'active' ? (
              <Button onClick={pauseSession} variant="outline" size="lg">
                <Pause className="mr-2 h-5 w-5" />
                Pause
              </Button>
            ) : (
              <Button onClick={resumeSession} variant="outline" size="lg">
                <Play className="mr-2 h-5 w-5" />
                Resume
              </Button>
            )}
            <Button onClick={stopSession} variant="destructive" size="lg">
              <Square className="mr-2 h-5 w-5" />
              Stop Session
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

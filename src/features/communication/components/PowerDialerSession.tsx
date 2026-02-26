import React, { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Phone, PhoneOff, Mic, MicOff, SkipForward,
  Square, Clock, Loader2, AlertCircle
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { telnyxService, CallState } from "@/services/telnyxService";
import { useToast } from "@/hooks/use-toast";
import { MiniLeadPanel, LeadDetails } from "./MiniLeadPanel";
import { QuickSMSDialog } from "@/components/communication/QuickSMSDialog";
import { QuickEmailDialog } from "@/components/communication/QuickEmailDialog";

interface QueueItem {
  id: string;
  phone: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  contact_id?: string;
  status: string;
}

interface PowerDialerSessionProps {
  campaignId: string;
  campaignName: string;
  listId: string;
  callerId: string;
  onStopSession: () => void;
}

export const PowerDialerSession: React.FC<PowerDialerSessionProps> = ({
  campaignId,
  campaignName,
  listId,
  callerId,
  onStopSession,
}) => {
  const { toast } = useToast();

  // Queue state
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [queueLoading, setQueueLoading] = useState(true);

  // Call state
  const [callState, setCallState] = useState<CallState>(telnyxService.getCallState());
  const [isMuted, setIsMuted] = useState(false);
  const [telnyxReady, setTelnyxReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Lead panel
  const [leadDetails, setLeadDetails] = useState<LeadDetails | null>(null);
  const [leadLoading, setLeadLoading] = useState(false);

  // Disposition
  const [showDisposition, setShowDisposition] = useState(false);
  const [dispositions, setDispositions] = useState<Array<{ id: string; name: string; is_positive: boolean }>>([]);
  const [selectedDisposition, setSelectedDisposition] = useState("");
  const [dispositionNotes, setDispositionNotes] = useState("");

  // Quick actions
  const [smsOpen, setSmsOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  // Initialize Telnyx + load queue + dispositions
  useEffect(() => {
    const init = async () => {
      // Init Telnyx WebRTC
      const result = await telnyxService.initialize({
        connectionId: "",
        outboundCallerId: callerId,
        apiKey: "",
      });

      if (!result.success) {
        setInitError("Failed to initialize Telnyx WebRTC. Check your configuration.");
        console.error("Telnyx init failed:", result.error);
      } else {
        setTelnyxReady(true);
      }

      // Load queue
      await loadQueue();

      // Load dispositions
      const { data: disps } = await supabase
        .from("dialer_dispositions")
        .select("id, name, is_positive")
        .eq("is_active", true)
        .order("name");
      if (disps) setDispositions(disps);
    };

    init();

    // Subscribe to call state
    const unsub = telnyxService.onStateChange((state) => {
      setCallState(state);
      if (state.status === "ended") {
        stopTimer();
        setShowDisposition(true);
      }
      if (state.status === "active") {
        startTimer();
      }
    });

    return () => {
      unsub();
      stopTimer();
    };
  }, []);

  const loadQueue = async () => {
    setQueueLoading(true);
    const { data, error } = await supabase
      .from("dialer_list_items")
      .select("id, phone, first_name, last_name, email, contact_id, status")
      .eq("list_id", listId)
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Failed to load queue:", error);
      toast({ title: "Failed to load call queue", variant: "destructive" });
    } else {
      setQueue(data || []);
      if (data && data.length > 0) {
        loadLeadDetails(data[0]);
      }
    }
    setQueueLoading(false);
  };

  // Load lead details for current queue item
  const loadLeadDetails = async (item: QueueItem) => {
    setLeadLoading(true);
    try {
      let contactData: LeadDetails["contact"] | null = null;
      let pipelineData: LeadDetails["pipeline"] | undefined;
      let notes: LeadDetails["recentNotes"] = [];
      let calls: LeadDetails["recentCalls"] = [];

      if (item.contact_id) {
        // Fetch real contact
        const { data: contact } = await supabase
          .from("contacts")
          .select("id, first_name, last_name, phone, email, address_street, address_city, address_state, address_zip, qualification_status, lead_score, type")
          .eq("id", item.contact_id)
          .single();

        if (contact) {
          contactData = contact as any;

          // Pipeline entry
          const { data: pe } = await supabase
            .from("pipeline_entries")
            .select("id, status, priority, estimated_value, assigned_to")
            .eq("contact_id", contact.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (pe) {
            let assignedName: string | undefined;
            if (pe.assigned_to) {
              const { data: assignee } = await supabase
                .from("profiles")
                .select("first_name, last_name")
                .eq("id", pe.assigned_to)
                .single();
              assignedName = assignee ? `${assignee.first_name || ""} ${assignee.last_name || ""}`.trim() : undefined;
            }
            pipelineData = {
              id: pe.id,
              stage_name: pe.status,
              priority: pe.priority,
              estimated_value: pe.estimated_value,
              assigned_to_name: assignedName,
            };

            // Recent notes (via pipeline_entry_id)
            const { data: notesData } = await supabase
              .from("internal_notes")
              .select("id, content, created_at, author_id")
              .eq("pipeline_entry_id", pe.id)
              .order("created_at", { ascending: false })
              .limit(3);
            notes = (notesData || []).map((n: any) => ({
              id: n.id,
              content: n.content,
              created_at: n.created_at,
            }));
          }

          // Recent calls
          const { data: callsData } = await supabase
            .from("calls")
            .select("id, direction, status, duration_seconds, created_at")
            .eq("contact_id", contact.id)
            .order("created_at", { ascending: false })
            .limit(3);
          calls = (callsData || []) as any;
        }
      }

      // Fallback to list item data if no contact_id
      if (!contactData) {
        contactData = {
          id: item.id,
          first_name: item.first_name || "",
          last_name: item.last_name || "",
          phone: item.phone,
          email: item.email,
        };
      }

      setLeadDetails({
        contact: contactData,
        pipeline: pipelineData,
        recentNotes: notes,
        recentCalls: calls,
      });
    } catch (err) {
      console.error("Failed to load lead details:", err);
    } finally {
      setLeadLoading(false);
    }
  };

  // Timer
  const startTimer = () => {
    stopTimer();
    setElapsedSeconds(0);
    timerRef.current = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // Call controls
  const handleDial = useCallback(async () => {
    const item = queue[currentIndex];
    if (!item) return;

    try {
      const result = await telnyxService.makeCall(item.phone, item.contact_id);
      if (!result.success) {
        toast({ title: "Call failed", description: String(result.error), variant: "destructive" });
      }
    } catch (err) {
      console.error("Dial error:", err);
      toast({ title: "Call failed", variant: "destructive" });
    }
  }, [queue, currentIndex, toast]);

  const handleHangup = useCallback(async () => {
    await telnyxService.endCall();
  }, []);

  const handleMuteToggle = useCallback(() => {
    if (isMuted) {
      telnyxService.unmuteCall();
    } else {
      telnyxService.muteCall();
    }
    setIsMuted(!isMuted);
  }, [isMuted]);

  const handleSkip = useCallback(async () => {
    // Mark current as skipped
    const item = queue[currentIndex];
    if (item) {
      await supabase
        .from("dialer_list_items")
        .update({ status: "skipped" } as any)
        .eq("id", item.id);
    }
    advanceToNext();
  }, [queue, currentIndex]);

  // Disposition save + advance
  const handleSaveDisposition = async () => {
    const item = queue[currentIndex];
    if (!item || !selectedDisposition) return;

    try {
      // Mark item as called
      await supabase
        .from("dialer_list_items")
        .update({ status: "called" } as any)
        .eq("id", item.id);

      // Log the call disposition
      const { data: userData } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", userData.user?.id)
        .single();

      if (profile?.tenant_id) {
        await supabase.from("call_logs").insert({
          caller_id: callerId,
          callee_number: item.phone,
          status: "completed",
          duration: elapsedSeconds,
          disposition: selectedDisposition,
          notes: dispositionNotes || null,
        } as any);
      }

      toast({ title: "Disposition saved" });
    } catch (err) {
      console.error("Failed to save disposition:", err);
    }

    // Reset and advance
    setShowDisposition(false);
    setSelectedDisposition("");
    setDispositionNotes("");
    setElapsedSeconds(0);
    advanceToNext();
  };

  const advanceToNext = () => {
    const nextIdx = currentIndex + 1;
    if (nextIdx >= queue.length) {
      toast({ title: "Queue Complete", description: "All leads have been called." });
      onStopSession();
      return;
    }
    setCurrentIndex(nextIdx);
    setIsMuted(false);
    loadLeadDetails(queue[nextIdx]);
  };

  // Current item
  const currentItem = queue[currentIndex];
  const isIdle = callState.status === "idle" || callState.status === "ended";
  const isActive = callState.status === "active";
  const isConnecting = callState.status === "connecting" || callState.status === "ringing";
  const progress = queue.length > 0 ? ((currentIndex + 1) / queue.length) * 100 : 0;

  const contactForDialogs = leadDetails?.contact
    ? {
        id: leadDetails.contact.id,
        name: `${leadDetails.contact.first_name} ${leadDetails.contact.last_name}`.trim(),
        phone: leadDetails.contact.phone,
        email: leadDetails.contact.email,
      }
    : null;

  if (queueLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading call queue...</span>
      </div>
    );
  }

  if (initError) {
    return (
      <Card className="border-destructive">
        <CardContent className="p-6 flex items-center gap-3">
          <AlertCircle className="h-6 w-6 text-destructive" />
          <div>
            <p className="font-medium">WebRTC Initialization Failed</p>
            <p className="text-sm text-muted-foreground">{initError}</p>
          </div>
          <Button variant="outline" className="ml-auto" onClick={onStopSession}>
            Back to Dialer
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Session Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Power Dialer Session</h2>
          <p className="text-muted-foreground">Campaign: {campaignName}</p>
        </div>
        <Button variant="destructive" onClick={onStopSession}>
          <Square className="h-4 w-4 mr-2" />
          Stop Campaign
        </Button>
      </div>

      {/* Queue Progress */}
      <Card>
        <CardContent className="py-3 px-4 flex items-center gap-4">
          <span className="text-sm font-medium whitespace-nowrap">
            {currentIndex + 1} of {queue.length}
          </span>
          <Progress value={progress} className="flex-1" />
          <Badge variant="outline">{queue.length - currentIndex - 1} remaining</Badge>
        </CardContent>
      </Card>

      {/* Main Layout: Controls + Lead Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Call Controls — left side */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardContent className="p-6 space-y-6">
              {/* Current Contact Name */}
              <div className="text-center">
                <h3 className="text-xl font-semibold">
                  {currentItem
                    ? `${currentItem.first_name || ""} ${currentItem.last_name || ""}`.trim() || "Unknown"
                    : "No Contact"}
                </h3>
                <p className="text-muted-foreground">{currentItem?.phone}</p>
              </div>

              {/* Timer */}
              <div className="text-center">
                <span className="font-mono text-4xl tabular-nums">
                  {formatTime(elapsedSeconds)}
                </span>
                <div className="mt-1">
                  {isConnecting && (
                    <Badge className="bg-yellow-500/20 text-yellow-700 border-yellow-500/30">
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      Connecting...
                    </Badge>
                  )}
                  {isActive && (
                    <Badge className="bg-green-500/20 text-green-700 border-green-500/30">
                      Live
                    </Badge>
                  )}
                  {isIdle && (
                    <Badge variant="secondary">Ready</Badge>
                  )}
                </div>
              </div>

              {/* Call Buttons */}
              <div className="grid grid-cols-2 gap-3">
                {isIdle ? (
                  <Button
                    className="col-span-2 h-14 text-lg bg-green-600 hover:bg-green-700"
                    onClick={handleDial}
                    disabled={!currentItem || !telnyxReady}
                  >
                    <Phone className="h-5 w-5 mr-2" />
                    Dial
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="destructive"
                      className="h-14 text-lg"
                      onClick={handleHangup}
                    >
                      <PhoneOff className="h-5 w-5 mr-2" />
                      Hangup
                    </Button>
                    <Button
                      variant={isMuted ? "default" : "outline"}
                      className="h-14"
                      onClick={handleMuteToggle}
                      disabled={!isActive}
                    >
                      {isMuted ? <MicOff className="h-5 w-5 mr-2" /> : <Mic className="h-5 w-5 mr-2" />}
                      {isMuted ? "Unmute" : "Mute"}
                    </Button>
                  </>
                )}

                <Button
                  variant="outline"
                  className="col-span-2"
                  onClick={handleSkip}
                  disabled={!isIdle}
                >
                  <SkipForward className="h-4 w-4 mr-2" />
                  Skip to Next
                </Button>
              </div>

              {/* Caller ID display */}
              <div className="text-center text-xs text-muted-foreground">
                <Phone className="h-3 w-3 inline mr-1" />
                Calling from: {callerId}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Mini Lead Panel — right side */}
        <div className="lg:col-span-2">
          <MiniLeadPanel
            lead={leadDetails}
            loading={leadLoading}
            onSmsClick={() => setSmsOpen(true)}
            onEmailClick={() => setEmailOpen(true)}
          />
        </div>
      </div>

      {/* SMS / Email Dialogs */}
      {contactForDialogs && (
        <>
          <QuickSMSDialog open={smsOpen} onOpenChange={setSmsOpen} contact={contactForDialogs} />
          <QuickEmailDialog open={emailOpen} onOpenChange={setEmailOpen} contact={contactForDialogs} />
        </>
      )}

      {/* Disposition Dialog */}
      <Dialog open={showDisposition} onOpenChange={setShowDisposition}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Call Disposition</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Result</Label>
              <Select value={selectedDisposition} onValueChange={setSelectedDisposition}>
                <SelectTrigger>
                  <SelectValue placeholder="Select outcome" />
                </SelectTrigger>
                <SelectContent>
                  {dispositions.map((d) => (
                    <SelectItem key={d.id} value={d.name}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                value={dispositionNotes}
                onChange={(e) => setDispositionNotes(e.target.value)}
                placeholder="Add call notes..."
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSaveDisposition} disabled={!selectedDisposition}>
                Save & Next
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowDisposition(false);
                  advanceToNext();
                }}
              >
                Skip Disposition
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

/**
 * Telnyx WebRTC Service
 * Manages Telnyx WebRTC connection and call control
 */

import { supabase } from '@/integrations/supabase/client';
import { whisperASR } from './whisperASR';

export interface CallState {
  callId: string | null;
  status: 'idle' | 'connecting' | 'ringing' | 'active' | 'ended';
  direction: 'inbound' | 'outbound';
  remoteNumber: string | null;
  contactId: string | null;
  startTime: Date | null;
  duration: number;
}

export interface TelnyxConfig {
  connectionId: string;
  outboundCallerId: string;
  apiKey: string;
}

class TelnyxService {
  private client: any = null;
  private currentCall: any = null;
  private config: TelnyxConfig | null = null;
  private callState: CallState = {
    callId: null,
    status: 'idle',
    direction: 'outbound',
    remoteNumber: null,
    contactId: null,
    startTime: null,
    duration: 0,
  };
  private listeners: Array<(state: CallState) => void> = [];
  private durationInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize Telnyx WebRTC client
   */
  async initialize(config?: TelnyxConfig) {
    try {
      // Store config for later use
      if (config) {
        this.config = config;
      }
      
      // Dynamic import of Telnyx SDK (only load when needed)
      const TelnyxRTC = await import('@telnyx/webrtc') as any;
      
      // Get JWT token from Edge Function
      const { data: tokenData, error: tokenError } = await supabase.functions.invoke('telnyx-mint-jwt');
      
      if (tokenError) throw tokenError;
      
      // Initialize client with JWT
      this.client = new TelnyxRTC.TelnyxRTC({
        login_token: tokenData.token,
      });

      // Set up event listeners
      this.setupEventListeners();

      // Connect
      await this.client.connect();
      
      return { success: true };
    } catch (error) {
      console.error('Failed to initialize Telnyx:', error);
      return { success: false, error };
    }
  }

  /**
   * Set up WebRTC event listeners
   */
  private setupEventListeners() {
    if (!this.client) return;

    this.client.on('telnyx.ready', () => {
      console.log('Telnyx client ready');
    });

    this.client.on('telnyx.socket.error', (error: any) => {
      console.error('Telnyx socket error:', error);
    });

    this.client.on('telnyx.notification', (notification: any) => {
      console.log('Telnyx notification:', notification);
      this.handleNotification(notification);
    });
  }

  /**
   * Handle call notifications
   */
  private handleNotification(notification: any) {
    const { type, call } = notification;

    switch (type) {
      case 'callUpdate':
        if (call.state === 'ringing') {
          this.updateCallState({ status: 'ringing' });
        } else if (call.state === 'active') {
          this.updateCallState({ 
            status: 'active',
            startTime: new Date()
          });
          this.startDurationTimer();
          // Start ASR if remote stream available
          if (call.remoteStream && this.callState.callId) {
            whisperASR.initialize().then(() => {
              whisperASR.startCapture(call.remoteStream, this.callState.callId!);
            });
          }
        } else if (call.state === 'done') {
          this.updateCallState({ status: 'ended' });
          this.endCall();
        }
        break;
      
      case 'incomingCall':
        this.currentCall = call;
        this.updateCallState({
          callId: call.id,
          status: 'ringing',
          direction: 'inbound',
          remoteNumber: call.remoteCallerNumber,
        });
        break;
    }
  }

  /**
   * Make outbound call
   */
  async makeCall(phoneNumber: string, contactId?: string) {
    if (!this.client) {
      throw new Error('Telnyx client not initialized');
    }

    try {
      // Create call record in DB
      const { data: user } = await supabase.auth.getUser();
      const tenantId = user?.user?.user_metadata?.tenant_id;

      const { data: callRecord, error: dbError } = await supabase
        .from('calls')
        .insert({
          tenant_id: tenantId,
          contact_id: contactId,
          direction: 'outbound',
          from_number: '', // Will be set by Telnyx
          to_number: phoneNumber,
          status: 'initiated',
          handled_by: user?.user?.id,
        })
        .select()
        .single();

      if (dbError) throw dbError;

      // Initiate call via Telnyx
      this.currentCall = await this.client.newCall({
        destinationNumber: phoneNumber,
        callerNumber: this.config?.outboundCallerId || '', // Use configured caller ID
      });

      this.updateCallState({
        callId: callRecord.id,
        status: 'connecting',
        direction: 'outbound',
        remoteNumber: phoneNumber,
        contactId: contactId || null,
      });

      return { success: true, callId: callRecord.id };
    } catch (error) {
      console.error('Failed to make call:', error);
      return { success: false, error };
    }
  }

  /**
   * Answer incoming call
   */
  async answerCall() {
    if (!this.currentCall) return;

    try {
      await this.currentCall.answer();
      this.updateCallState({ status: 'active', startTime: new Date() });
      this.startDurationTimer();
    } catch (error) {
      console.error('Failed to answer call:', error);
    }
  }

  /**
   * End current call
   */
  async endCall() {
    if (this.currentCall) {
      try {
        await this.currentCall.hangup();
      } catch (error) {
        console.error('Failed to hangup call:', error);
      }
    }

    this.stopDurationTimer();
    whisperASR.stopCapture();

    // Update DB
    if (this.callState.callId) {
      await supabase
        .from('calls')
        .update({
          status: 'completed',
          ended_at: new Date().toISOString(),
          duration_seconds: this.callState.duration,
        })
        .eq('id', this.callState.callId);
    }

    this.currentCall = null;
    this.updateCallState({
      callId: null,
      status: 'idle',
      remoteNumber: null,
      contactId: null,
      startTime: null,
      duration: 0,
    });
  }

  /**
   * Start duration timer
   */
  private startDurationTimer() {
    this.stopDurationTimer();
    this.durationInterval = setInterval(() => {
      if (this.callState.startTime) {
        const duration = Math.floor((Date.now() - this.callState.startTime.getTime()) / 1000);
        this.updateCallState({ duration });
      }
    }, 1000);
  }

  /**
   * Stop duration timer
   */
  private stopDurationTimer() {
    if (this.durationInterval) {
      clearInterval(this.durationInterval);
      this.durationInterval = null;
    }
  }

  /**
   * Update call state and notify listeners
   */
  private updateCallState(updates: Partial<CallState>) {
    this.callState = { ...this.callState, ...updates };
    this.notifyListeners();
  }

  /**
   * Subscribe to call state changes
   */
  onStateChange(listener: (state: CallState) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Notify all listeners of state change
   */
  private notifyListeners() {
    this.listeners.forEach(listener => listener(this.callState));
  }

  /**
   * Get current call state
   */
  getCallState(): CallState {
    return { ...this.callState };
  }

  /**
   * Disconnect Telnyx client
   */
  async disconnect() {
    if (this.currentCall) {
      await this.endCall();
    }
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
  }
}

export const telnyxService = new TelnyxService();

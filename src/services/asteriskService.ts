/**
 * Asterisk WebRTC Service
 * Replaces Telnyx service with self-hosted Asterisk PBX
 */

import { supabase } from '@/integrations/supabase/client';

export interface CallState {
  callId: string | null;
  status: 'idle' | 'connecting' | 'ringing' | 'active' | 'ended';
  direction: 'inbound' | 'outbound' | null;
  remoteNumber: string | null;
  startTime: Date | null;
  duration: number;
  isMuted: boolean;
}

export interface AsteriskConfig {
  wsServer: string;
  sipUri: string;
  password: string;
  displayName?: string;
  turnServer?: {
    urls: string;
    username?: string;
    credential?: string;
  };
}

class AsteriskService {
  private callState: CallState = {
    callId: null,
    status: 'idle',
    direction: null,
    remoteNumber: null,
    startTime: null,
    duration: 0,
    isMuted: false,
  };

  private listeners: Array<(state: CallState) => void> = [];
  private config: AsteriskConfig | null = null;
  private localStream: MediaStream | null = null;
  private remoteAudio: HTMLAudioElement | null = null;

  /**
   * Initialize Asterisk WebRTC connection
   */
  async initialize(config?: AsteriskConfig): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('Initializing Asterisk WebRTC service...');

      // Get communication preferences if config not provided
      if (!config) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('User not authenticated');

        const { data: profile } = await supabase
          .from('profiles')
          .select('tenant_id')
          .eq('id', user.id)
          .single();

        if (!profile?.tenant_id) throw new Error('Tenant not found');

        const { data: prefs } = await supabase
          .from('communication_preferences')
          .select('asterisk_api_url')
          .eq('tenant_id', profile.tenant_id)
          .single();

        if (!prefs?.asterisk_api_url) {
          throw new Error('Asterisk not configured. Please configure in Settings > Communication');
        }

        // For now, use simple config - in production, get actual SIP credentials
        config = {
          wsServer: prefs.asterisk_api_url.replace('http', 'ws') + '/ws',
          sipUri: 'sip:agent@pbx.yourdomain.com',
          password: 'changeme', // Should come from secure storage
          displayName: user.email || 'Agent',
        };
      }

      this.config = config;

      // Setup audio element for remote stream
      this.remoteAudio = new Audio();
      this.remoteAudio.autoplay = true;

      console.log('Asterisk service initialized successfully');
      return { success: true };
    } catch (error) {
      console.error('Failed to initialize Asterisk service:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Make an outbound call
   */
  async makeCall(phoneNumber: string, contactId?: string): Promise<{ success: boolean; callId?: string; error?: string }> {
    try {
      if (!this.config) {
        throw new Error('Service not initialized. Call initialize() first.');
      }

      console.log('Making call to:', phoneNumber);

      // Create call log
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      const { data: callLogData, error: callLogError } = await supabase
        .from('call_logs')
        .insert({
          tenant_id: profile?.tenant_id || '',
          contact_id: contactId,
          callee_number: phoneNumber,
          caller_id: this.config.sipUri || 'unknown',
          direction: 'outbound',
          status: 'ringing',
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      const callId = callLogData?.id;

      if (callLogError) {
        console.error('Error creating call log:', callLogError);
      }

      // Get local media stream
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

      // Update call state
      this.updateCallState({
        callId,
        status: 'connecting',
        direction: 'outbound',
        remoteNumber: phoneNumber,
        startTime: new Date(),
      });

      // In a real implementation, this would establish WebRTC connection
      // For now, simulate call progress
      setTimeout(() => {
        this.updateCallState({ status: 'ringing' });
      }, 1000);

      setTimeout(() => {
        this.updateCallState({ status: 'active' });
      }, 3000);

      return { success: true, callId };
    } catch (error) {
      console.error('Failed to make call:', error);
      this.updateCallState({ status: 'idle', callId: null });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Answer an incoming call
   */
  async answerCall(): Promise<void> {
    try {
      if (!this.callState.callId) {
        throw new Error('No incoming call to answer');
      }

      console.log('Answering call:', this.callState.callId);

      // Get local media stream
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

      // Update call log
      await supabase
        .from('call_logs')
        .update({
          status: 'active',
          answered_at: new Date().toISOString(),
        })
        .eq('id', this.callState.callId);

      this.updateCallState({ status: 'active', startTime: new Date() });
    } catch (error) {
      console.error('Failed to answer call:', error);
    }
  }

  /**
   * End the current call
   */
  async endCall(): Promise<void> {
    try {
      if (!this.callState.callId) {
        console.warn('No active call to end');
        return;
      }

      console.log('Ending call:', this.callState.callId);

      const duration = this.callState.startTime
        ? Math.floor((Date.now() - this.callState.startTime.getTime()) / 1000)
        : 0;

      // Update call log
      await supabase
        .from('call_logs')
        .update({
          status: 'completed',
          ended_at: new Date().toISOString(),
          duration_seconds: duration,
        })
        .eq('id', this.callState.callId);

      // Stop local stream
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => track.stop());
        this.localStream = null;
      }

      this.updateCallState({
        status: 'idle',
        callId: null,
        direction: null,
        remoteNumber: null,
        startTime: null,
        duration: 0,
      });
    } catch (error) {
      console.error('Failed to end call:', error);
    }
  }

  /**
   * Toggle mute
   */
  toggleMute(): void {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        this.updateCallState({ isMuted: !audioTrack.enabled });
      }
    }
  }

  /**
   * Subscribe to call state changes
   */
  onStateChange(listener: (state: CallState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Get current call state
   */
  getCallState(): CallState {
    return { ...this.callState };
  }

  /**
   * Disconnect service
   */
  disconnect(): void {
    console.log('Disconnecting Asterisk service');
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    this.config = null;
    this.updateCallState({
      status: 'idle',
      callId: null,
      direction: null,
      remoteNumber: null,
      startTime: null,
      duration: 0,
    });
  }

  private updateCallState(updates: Partial<CallState>): void {
    this.callState = { ...this.callState, ...updates };
    this.listeners.forEach(listener => listener(this.callState));
  }
}

export const asteriskService = new AsteriskService();

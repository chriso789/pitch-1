/**
 * Marketing & Product Tracking Service
 * Handles session management, consent, event dispatch, and UTM parsing
 * Uses edge functions to bypass RLS issues across all company profiles
 */

import { supabase } from '@/integrations/supabase/client';

const SESSION_KEY_STORAGE = 'pitch_session_key';
const CONSENT_STORAGE = 'pitch_consent';
const SESSION_EXPIRY_HOURS = 24;

export interface TrackingConsent {
  essential: boolean;
  analytics: boolean;
  marketing: boolean;
  version: string;
  grantedAt: string;
}

export interface TrackingEvent {
  eventType: string;
  path?: string;
  elementId?: string;
  elementText?: string;
  metadata?: Record<string, any>;
  scrollDepth?: number;
  timeOnPage?: number;
}

export interface UTMParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
}

class TrackingService {
  private sessionKey: string | null = null;
  private sessionId: string | null = null;
  private consent: TrackingConsent | null = null;
  private pageLoadTime: number = Date.now();
  private scrollDepthTracked: Set<number> = new Set();

  constructor() {
    if (typeof window !== 'undefined') {
      this.loadSession();
      this.loadConsent();
    }
  }

  // Session Management
  private generateSessionKey(): string {
    return `ps_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  private loadSession(): void {
    const stored = localStorage.getItem(SESSION_KEY_STORAGE);
    if (stored) {
      try {
        const { key, timestamp } = JSON.parse(stored);
        const hoursSinceCreation = (Date.now() - timestamp) / (1000 * 60 * 60);
        if (hoursSinceCreation < SESSION_EXPIRY_HOURS) {
          this.sessionKey = key;
          return;
        }
      } catch {
        // Invalid storage, create new session
      }
    }
    this.createNewSession();
  }

  private createNewSession(): void {
    this.sessionKey = this.generateSessionKey();
    localStorage.setItem(SESSION_KEY_STORAGE, JSON.stringify({
      key: this.sessionKey,
      timestamp: Date.now()
    }));
  }

  getSessionKey(): string {
    if (!this.sessionKey) {
      this.loadSession();
    }
    return this.sessionKey!;
  }

  // Consent Management
  loadConsent(): TrackingConsent | null {
    const stored = localStorage.getItem(CONSENT_STORAGE);
    if (stored) {
      try {
        this.consent = JSON.parse(stored);
        return this.consent;
      } catch {
        return null;
      }
    }
    return null;
  }

  setConsent(consent: Partial<TrackingConsent>): void {
    this.consent = {
      essential: true, // Always true
      analytics: consent.analytics ?? false,
      marketing: consent.marketing ?? false,
      version: '1.0',
      grantedAt: new Date().toISOString()
    };
    localStorage.setItem(CONSENT_STORAGE, JSON.stringify(this.consent));
    
    // Log consent to database
    this.logConsent();
  }

  hasAnalyticsConsent(): boolean {
    return this.consent?.analytics ?? false;
  }

  hasMarketingConsent(): boolean {
    return this.consent?.marketing ?? false;
  }

  hasAnyConsent(): boolean {
    return this.consent !== null;
  }

  private async logConsent(): Promise<void> {
    if (!this.consent) return;

    const consentTypes = ['essential', 'analytics', 'marketing'] as const;
    
    for (const type of consentTypes) {
      try {
        await supabase.from('visitor_consents').insert({
          session_id: this.sessionId,
          consent_type: type,
          granted: this.consent[type],
          version: this.consent.version,
          ip_address: null, // Will be set by edge function
          user_agent: navigator.userAgent,
          source: 'web'
        });
      } catch (error) {
        console.error('Failed to log consent:', error);
      }
    }
  }

  // UTM Parameter Extraction
  getUTMParams(): UTMParams {
    if (typeof window === 'undefined') return {};
    
    const params = new URLSearchParams(window.location.search);
    return {
      utm_source: params.get('utm_source') || undefined,
      utm_medium: params.get('utm_medium') || undefined,
      utm_campaign: params.get('utm_campaign') || undefined,
      utm_content: params.get('utm_content') || undefined,
      utm_term: params.get('utm_term') || undefined
    };
  }

  // Device Detection
  getDeviceType(): 'desktop' | 'mobile' | 'tablet' {
    if (typeof window === 'undefined') return 'desktop';
    
    const ua = navigator.userAgent.toLowerCase();
    if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
      return 'tablet';
    }
    if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) {
      return 'mobile';
    }
    return 'desktop';
  }

  // Session Initialization - Uses edge function to bypass RLS
  async initSession(): Promise<string | null> {
    if (this.sessionId) return this.sessionId;

    const sessionKey = this.getSessionKey();
    const utmParams = this.getUTMParams();
    
    try {
      // Use edge function to create/get session - bypasses RLS issues
      const { data, error } = await supabase.functions.invoke('track-marketing-session', {
        body: {
          action: 'create',
          session_key: sessionKey,
          data: {
            channel: 'MARKETING_SITE',
            site_domain: 'pitch-crm.ai',
            referrer: document.referrer || undefined,
            landing_page: window.location.pathname,
            user_agent: navigator.userAgent,
            device_type: this.getDeviceType(),
            ...utmParams
          }
        }
      });

      if (error) {
        console.error('[TrackingService] Edge function failed, falling back to direct insert:', error);
        return await this.initSessionFallback(sessionKey, utmParams);
      }

      if (data?.success && data?.session_id) {
        this.sessionId = data.session_id;
        return this.sessionId;
      }

      // Fallback if edge function didn't return expected data
      return await this.initSessionFallback(sessionKey, utmParams);
    } catch (error) {
      console.error('[TrackingService] Failed to init session:', error);
      return await this.initSessionFallback(sessionKey, utmParams);
    }
  }

  // Fallback for direct database access (uses new RLS policies)
  private async initSessionFallback(sessionKey: string, utmParams: UTMParams): Promise<string | null> {
    try {
      // Check if session already exists
      const { data: existing } = await supabase
        .from('marketing_sessions')
        .select('id')
        .eq('session_key', sessionKey)
        .single();

      if (existing) {
        this.sessionId = existing.id;
        // Update last activity
        await supabase
          .from('marketing_sessions')
          .update({ last_activity_at: new Date().toISOString() })
          .eq('id', this.sessionId);
        return this.sessionId;
      }

      // Create new session
      const { data, error } = await supabase
        .from('marketing_sessions')
        .insert({
          session_key: sessionKey,
          channel: 'MARKETING_SITE',
          site_domain: 'pitch-crm.ai',
          referrer: document.referrer || null,
          landing_page: window.location.pathname,
          user_agent: navigator.userAgent,
          device_type: this.getDeviceType(),
          analytics_consent: this.hasAnalyticsConsent(),
          marketing_consent: this.hasMarketingConsent(),
          ...utmParams
        })
        .select('id')
        .single();

      if (error) throw error;
      this.sessionId = data.id;
      return this.sessionId;
    } catch (error) {
      console.error('[TrackingService] Fallback session init failed:', error);
      return null;
    }
  }

  // Event Tracking
  async trackEvent(event: TrackingEvent): Promise<void> {
    // Always track essential events, check consent for analytics
    if (event.eventType !== 'PAGE_VIEW' && !this.hasAnalyticsConsent()) {
      return;
    }

    const sessionId = await this.initSession();
    if (!sessionId) return;

    try {
      // Insert event directly to tracking_events table
      await supabase.from('tracking_events').insert({
        session_id: sessionId,
        channel: 'MARKETING_SITE',
        event_type: event.eventType,
        path: event.path || window.location.pathname,
        referrer: document.referrer || null,
        element_id: event.elementId,
        element_text: event.elementText,
        metadata: event.metadata || {},
        scroll_depth: event.scrollDepth,
        time_on_page: event.timeOnPage,
        user_agent: navigator.userAgent
      });

      // Update session counters
      if (event.eventType === 'PAGE_VIEW') {
        await supabase.functions.invoke('track-marketing-session', {
          body: {
            action: 'update',
            session_key: this.getSessionKey(),
            data: {}
          }
        });
      }
    } catch (error) {
      console.error('[TrackingService] Failed to track event:', error);
    }
  }

  // Page View Tracking
  async trackPageView(path?: string): Promise<void> {
    this.pageLoadTime = Date.now();
    this.scrollDepthTracked.clear();
    
    await this.trackEvent({
      eventType: 'PAGE_VIEW',
      path: path || window.location.pathname,
      metadata: {
        title: document.title,
        referrer: document.referrer,
        ...this.getUTMParams()
      }
    });
  }

  // Scroll Depth Tracking
  trackScrollDepth(depth: number): void {
    const thresholds = [25, 50, 75, 100];
    const threshold = thresholds.find(t => depth >= t && !this.scrollDepthTracked.has(t));
    
    if (threshold) {
      this.scrollDepthTracked.add(threshold);
      this.trackEvent({
        eventType: 'SCROLL_DEPTH',
        scrollDepth: threshold,
        timeOnPage: Math.floor((Date.now() - this.pageLoadTime) / 1000),
        metadata: { depth_percent: threshold }
      });
    }
  }

  // CTA Click Tracking
  trackCTAClick(elementId: string, elementText?: string, metadata?: Record<string, any>): void {
    this.trackEvent({
      eventType: 'CTA_CLICK',
      elementId,
      elementText,
      timeOnPage: Math.floor((Date.now() - this.pageLoadTime) / 1000),
      metadata
    });
  }

  // Form Submit Tracking
  trackFormSubmit(formType: string, metadata?: Record<string, any>): void {
    this.trackEvent({
      eventType: 'FORM_SUBMIT',
      elementId: formType,
      timeOnPage: Math.floor((Date.now() - this.pageLoadTime) / 1000),
      metadata: { form_type: formType, ...metadata }
    });
  }

  // Link Marketing Session to User (after signup/login) - Uses edge function
  async linkToUser(userId: string): Promise<void> {
    if (!this.sessionKey) return;

    try {
      // Use edge function to convert session
      const { error } = await supabase.functions.invoke('track-marketing-session', {
        body: {
          action: 'convert',
          session_key: this.getSessionKey(),
          data: { user_id: userId }
        }
      });

      if (error) {
        console.error('[TrackingService] Edge function failed for conversion, falling back:', error);
        // Fallback to direct update
        if (this.sessionId) {
          await supabase
            .from('marketing_sessions')
            .update({ 
              user_id: userId, 
              converted: true,
              converted_at: new Date().toISOString()
            })
            .eq('id', this.sessionId);

          await supabase
            .from('tracking_events')
            .update({ user_id: userId })
            .eq('session_id', this.sessionId);
        }
      }
    } catch (error) {
      console.error('[TrackingService] Failed to link session to user:', error);
    }
  }
}

export const trackingService = new TrackingService();

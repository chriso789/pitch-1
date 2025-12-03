import { supabase } from '@/integrations/supabase/client';

interface ActivityEvent {
  action_type: string;
  action_category?: string;
  action_details?: Record<string, any>;
  page_url?: string;
}

class ActivityTracker {
  private queue: ActivityEvent[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private sessionId: string;
  private tenantId: string | null = null;
  private userId: string | null = null;
  private keystrokeCount = 0;
  private lastKeystrokeTime = 0;
  private keystrokeFlushTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.sessionId = this.generateSessionId();
    this.initializeUser();
    this.startAutoFlush();
  }

  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private async initializeUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      this.userId = user.id;
      // Get tenant ID from profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();
      if (profile) {
        this.tenantId = profile.tenant_id;
      }
    }

    // Listen for auth changes
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        this.userId = session.user.id;
        const { data: profile } = await supabase
          .from('profiles')
          .select('tenant_id')
          .eq('id', session.user.id)
          .single();
        if (profile) {
          this.tenantId = profile.tenant_id;
        }
      } else {
        this.userId = null;
        this.tenantId = null;
      }
    });
  }

  private startAutoFlush() {
    // Flush every 30 seconds
    this.flushInterval = setInterval(() => {
      this.flush();
    }, 30000);

    // Also flush on page unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.flush();
      });
    }
  }

  trackPageView(path: string, pageName?: string) {
    this.addEvent({
      action_type: 'page_view',
      action_category: 'navigation',
      action_details: { page_name: pageName || path },
      page_url: path,
    });
  }

  trackButtonClick(elementId: string, context?: Record<string, any>) {
    this.addEvent({
      action_type: 'button_click',
      action_category: 'interaction',
      action_details: { element_id: elementId, ...context },
      page_url: typeof window !== 'undefined' ? window.location.pathname : undefined,
    });
  }

  trackFormSubmit(formType: string, success: boolean, context?: Record<string, any>) {
    this.addEvent({
      action_type: 'form_submit',
      action_category: 'form',
      action_details: { form_type: formType, success, ...context },
      page_url: typeof window !== 'undefined' ? window.location.pathname : undefined,
    });
  }

  trackDataChange(table: string, operation: 'create' | 'update' | 'delete', recordId?: string) {
    this.addEvent({
      action_type: 'data_change',
      action_category: 'crm',
      action_details: { table, operation, record_id: recordId },
      page_url: typeof window !== 'undefined' ? window.location.pathname : undefined,
    });
  }

  trackKeystroke() {
    this.keystrokeCount++;
    this.lastKeystrokeTime = Date.now();

    // Debounce keystroke batching - flush after 5 seconds of inactivity
    if (this.keystrokeFlushTimeout) {
      clearTimeout(this.keystrokeFlushTimeout);
    }
    this.keystrokeFlushTimeout = setTimeout(() => {
      this.flushKeystrokes();
    }, 5000);
  }

  private flushKeystrokes() {
    if (this.keystrokeCount > 0) {
      this.addEvent({
        action_type: 'keystroke_batch',
        action_category: 'input',
        action_details: { 
          keystroke_count: this.keystrokeCount,
          timestamp: this.lastKeystrokeTime 
        },
        page_url: typeof window !== 'undefined' ? window.location.pathname : undefined,
      });
      this.keystrokeCount = 0;
    }
  }

  trackSearch(query: string, resultsCount: number) {
    this.addEvent({
      action_type: 'search',
      action_category: 'navigation',
      action_details: { query_length: query.length, results_count: resultsCount },
      page_url: typeof window !== 'undefined' ? window.location.pathname : undefined,
    });
  }

  private addEvent(event: ActivityEvent) {
    if (!this.userId || !this.tenantId) return;
    this.queue.push(event);

    // Auto-flush if queue gets too large
    if (this.queue.length >= 50) {
      this.flush();
    }
  }

  async flush() {
    // Also flush any pending keystrokes
    this.flushKeystrokes();

    if (this.queue.length === 0 || !this.userId || !this.tenantId) return;

    const events = [...this.queue];
    this.queue = [];

    try {
      const records = events.map(event => ({
        tenant_id: this.tenantId,
        user_id: this.userId,
        action_type: event.action_type,
        action_category: event.action_category,
        action_details: event.action_details,
        page_url: event.page_url,
        session_id: this.sessionId,
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      }));

      // Use service role via edge function for inserts
      const { error } = await supabase.functions.invoke('log-activity', {
        body: { events: records }
      });

      if (error) {
        console.error('Error logging activity:', error);
        // Put events back in queue for retry
        this.queue = [...events, ...this.queue];
      }
    } catch (error) {
      console.error('Error flushing activity:', error);
      // Put events back in queue
      this.queue = [...events, ...this.queue];
    }
  }

  destroy() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    if (this.keystrokeFlushTimeout) {
      clearTimeout(this.keystrokeFlushTimeout);
    }
    this.flush();
  }
}

// Singleton instance
export const activityTracker = new ActivityTracker();

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
  private sessionId: string | null = null;
  private tenantId: string | null = null;
  private userId: string | null = null;
  private keystrokeCount = 0;
  private lastKeystrokeTime = 0;
  private keystrokeFlushTimeout: NodeJS.Timeout | null = null;
  private initialized = false;

  constructor() {
    // Lazy initialization - don't start anything in constructor
  }

  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private async ensureInitialized() {
    if (this.initialized) return;
    this.initialized = true;
    
    this.sessionId = this.generateSessionId();
    
    // Get current user once
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      this.userId = user.id;
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();
      if (profile) {
        this.tenantId = profile.tenant_id;
      }
    }

    // Start auto-flush only after initialization (every 60 seconds instead of 30)
    this.flushInterval = setInterval(() => {
      this.flush();
    }, 60000);

    // Flush on page unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.flush();
      });
    }
  }

  async trackPageView(path: string, pageName?: string) {
    await this.ensureInitialized();
    this.addEvent({
      action_type: 'page_view',
      action_category: 'navigation',
      action_details: { page_name: pageName || path },
      page_url: path,
    });
  }

  async trackButtonClick(elementId: string, context?: Record<string, any>) {
    await this.ensureInitialized();
    this.addEvent({
      action_type: 'button_click',
      action_category: 'interaction',
      action_details: { element_id: elementId, ...context },
      page_url: typeof window !== 'undefined' ? window.location.pathname : undefined,
    });
  }

  async trackFormSubmit(formType: string, success: boolean, context?: Record<string, any>) {
    await this.ensureInitialized();
    this.addEvent({
      action_type: 'form_submit',
      action_category: 'form',
      action_details: { form_type: formType, success, ...context },
      page_url: typeof window !== 'undefined' ? window.location.pathname : undefined,
    });
  }

  async trackDataChange(table: string, operation: 'create' | 'update' | 'delete', recordId?: string) {
    await this.ensureInitialized();
    this.addEvent({
      action_type: 'data_change',
      action_category: 'crm',
      action_details: { table, operation, record_id: recordId },
      page_url: typeof window !== 'undefined' ? window.location.pathname : undefined,
    });
  }

  trackKeystroke() {
    // Just increment counter - no async initialization needed for simple counting
    this.keystrokeCount++;
    this.lastKeystrokeTime = Date.now();

    // Debounce keystroke batching - flush after 10 seconds of inactivity
    if (this.keystrokeFlushTimeout) {
      clearTimeout(this.keystrokeFlushTimeout);
    }
    this.keystrokeFlushTimeout = setTimeout(() => {
      this.flushKeystrokes();
    }, 10000);
  }

  private async flushKeystrokes() {
    if (this.keystrokeCount > 0) {
      await this.ensureInitialized();
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

  async trackSearch(query: string, resultsCount: number) {
    await this.ensureInitialized();
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

    // Auto-flush if queue gets too large (increased threshold)
    if (this.queue.length >= 100) {
      this.flush();
    }
  }

  async flush() {
    // Also flush any pending keystrokes
    await this.flushKeystrokes();

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
        // Don't retry - just drop failed events to avoid memory buildup
      }
    } catch (error) {
      console.error('Error flushing activity:', error);
      // Don't retry - just drop failed events
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

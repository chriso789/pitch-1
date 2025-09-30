import { supabase } from "@/integrations/supabase/client";
import { locationService } from "./locationService";

interface AuditContext {
  ipAddress?: string;
  userAgent?: string;
  location?: any;
  sessionId?: string;
}

class AuditService {
  private context: AuditContext = {};
  private sessionId: string;

  constructor() {
    this.sessionId = this.generateSessionId();
    this.initializeContext();
  }

  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private async initializeContext() {
    try {
      // Get user location
      const location = await locationService.getCurrentLocation();
      this.context.location = location;

      // Get user agent
      this.context.userAgent = navigator.userAgent;

      // Session ID
      this.context.sessionId = this.sessionId;
    } catch (error) {
      console.error('Error initializing audit context:', error);
    }
  }

  async captureAuditContext(): Promise<void> {
    try {
      const location = await locationService.getCurrentLocation();
      this.context.location = location;
    } catch (error) {
      console.warn('Could not capture location for audit:', error);
    }
  }

  async logChange(
    table: string,
    action: 'INSERT' | 'UPDATE' | 'DELETE',
    recordId: string,
    oldData?: any,
    newData?: any,
    additionalMetadata?: any
  ): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .maybeSingle();

      if (!profile) return;

      await supabase.from('audit_log').insert({
        tenant_id: profile.tenant_id,
        table_name: table,
        record_id: recordId,
        action: action,
        old_values: oldData,
        new_values: newData,
        changed_by: user.id,
        user_agent: this.context.userAgent,
        location_data: this.context.location,
        session_id: this.context.sessionId,
        ...additionalMetadata
      });
    } catch (error) {
      console.error('Error logging audit:', error);
    }
  }

  async getAuditTrail(recordId: string, tableName: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('audit_log')
        .select(`
          *,
          changed_by_profile:profiles!audit_log_changed_by_fkey(
            first_name,
            last_name,
            email
          )
        `)
        .eq('record_id', recordId)
        .eq('table_name', tableName)
        .order('changed_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching audit trail:', error);
      return [];
    }
  }

  async exportAuditLog(filters?: {
    tableName?: string;
    startDate?: Date;
    endDate?: Date;
    userId?: string;
  }): Promise<string> {
    try {
      let query = supabase
        .from('audit_log')
        .select(`
          *,
          changed_by_profile:profiles!audit_log_changed_by_fkey(
            first_name,
            last_name,
            email
          )
        `)
        .order('changed_at', { ascending: false });

      if (filters?.tableName) {
        query = query.eq('table_name', filters.tableName);
      }
      if (filters?.startDate) {
        query = query.gte('changed_at', filters.startDate.toISOString());
      }
      if (filters?.endDate) {
        query = query.lte('changed_at', filters.endDate.toISOString());
      }
      if (filters?.userId) {
        query = query.eq('changed_by', filters.userId);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Convert to CSV
      const headers = ['Date', 'User', 'Table', 'Action', 'Record ID', 'IP Address', 'Location'];
      const csvRows = [headers.join(',')];

      data?.forEach(entry => {
        const row = [
          new Date(entry.changed_at).toLocaleString(),
          entry.changed_by_profile 
            ? `${entry.changed_by_profile.first_name} ${entry.changed_by_profile.last_name}`
            : 'Unknown',
          entry.table_name,
          entry.action,
          entry.record_id,
          entry.ip_address || 'N/A',
          (typeof entry.location_data === 'object' && entry.location_data && 'address' in entry.location_data 
            ? String(entry.location_data.address) 
            : 'N/A')
        ];
        csvRows.push(row.map(cell => `"${cell}"`).join(','));
      });

      return csvRows.join('\n');
    } catch (error) {
      console.error('Error exporting audit log:', error);
      throw error;
    }
  }

  getFieldDiff(oldData: any, newData: any): Array<{ field: string; oldValue: any; newValue: any }> {
    const changes: Array<{ field: string; oldValue: any; newValue: any }> = [];

    const allKeys = new Set([
      ...Object.keys(oldData || {}),
      ...Object.keys(newData || {})
    ]);

    allKeys.forEach(key => {
      const oldValue = oldData?.[key];
      const newValue = newData?.[key];

      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes.push({
          field: key,
          oldValue,
          newValue
        });
      }
    });

    return changes;
  }
}

export const auditService = new AuditService();
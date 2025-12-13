import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface CompanyActivityLog {
  id: string;
  tenant_id: string;
  user_id: string;
  action_type: string;
  action_description: string;
  resource_type?: string;
  resource_id?: string;
  ip_address?: string;
  user_agent?: string;
  location_info?: any;
  metadata?: any;
  severity: 'info' | 'warning' | 'critical';
  created_at: string;
  user_email?: string;
  user_name?: string;
  tenant_name?: string;
}

interface UseCompanyActivityLogOptions {
  tenantId?: string;
  actionType?: string;
  severity?: string;
  limit?: number;
}

export const useCompanyActivityLog = (options: UseCompanyActivityLogOptions = {}) => {
  const [logs, setLogs] = useState<CompanyActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchLogs();
  }, [options.tenantId, options.actionType, options.severity]);

  const fetchLogs = async () => {
    try {
      setLoading(true);

      let query = supabase
        .from('company_activity_log')
        .select(`
          *,
          profiles!company_activity_log_user_id_fkey(email, first_name, last_name),
          tenants!company_activity_log_tenant_id_fkey(name)
        `)
        .order('created_at', { ascending: false })
        .limit(options.limit || 100);

      if (options.tenantId) {
        query = query.eq('tenant_id', options.tenantId);
      }

      if (options.actionType) {
        query = query.eq('action_type', options.actionType);
      }

      if (options.severity) {
        query = query.eq('severity', options.severity);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Transform data to include user and tenant info
      const transformedLogs: CompanyActivityLog[] = (data || []).map((log: any) => ({
        ...log,
        user_email: log.profiles?.email,
        user_name: log.profiles 
          ? `${log.profiles.first_name || ''} ${log.profiles.last_name || ''}`.trim() || null
          : null,
        tenant_name: log.tenants?.name,
      }));

      setLogs(transformedLogs);
    } catch (error: any) {
      console.error('Error fetching company activity logs:', error);
      toast({
        title: "Error Loading Logs",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const exportLogs = async (format: 'json' | 'csv' = 'csv') => {
    try {
      if (format === 'csv') {
        const headers = ['Timestamp', 'Company', 'User', 'Action Type', 'Description', 'Severity', 'Resource Type', 'Metadata'];
        const rows = logs.map(log => [
          new Date(log.created_at).toLocaleString(),
          log.tenant_name || 'N/A',
          log.user_email || 'N/A',
          log.action_type,
          log.action_description,
          log.severity,
          log.resource_type || 'N/A',
          JSON.stringify(log.metadata || {})
        ]);

        const csvContent = [
          headers.join(','),
          ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `company-activity-log-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `company-activity-log-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }

      toast({
        title: "Export Successful",
        description: `Logs exported as ${format.toUpperCase()}`,
      });
    } catch (error: any) {
      toast({
        title: "Export Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return {
    logs,
    loading,
    refetch: fetchLogs,
    exportLogs,
  };
};

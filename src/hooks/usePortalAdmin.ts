/**
 * Hooks for Homeowner Portal Admin functionality
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompanySwitcher } from "@/hooks/useCompanySwitcher";

export interface PortalUser {
  id: string;
  contact_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  project_id: string | null;
  project_name: string | null;
  project_address: string | null;
  session_count: number;
  last_login: string | null;
  first_login: string | null;
  is_online: boolean;
  permissions: PortalPermissions | null;
}

export interface PortalPermissions {
  id: string;
  contact_id: string;
  can_view_project_status: boolean;
  can_view_timeline: boolean;
  can_view_photos: boolean;
  can_view_documents: boolean;
  can_download_documents: boolean;
  can_view_estimates: boolean;
  can_view_payments: boolean;
  can_send_messages: boolean;
  can_approve_change_orders: boolean;
  can_use_ai_chat: boolean;
  visible_document_categories: string[];
  visible_photo_categories: string[];
}

export interface PortalActivity {
  id: string;
  contact_id: string;
  contact_name: string;
  project_id: string | null;
  project_name: string | null;
  action_type: string;
  action_details: Record<string, any>;
  device_type: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface PortalStats {
  total_users: number;
  active_today: number;
  online_now: number;
  actions_this_week: number;
}

export const DEFAULT_PERMISSIONS: Omit<PortalPermissions, 'id' | 'contact_id'> = {
  can_view_project_status: true,
  can_view_timeline: true,
  can_view_photos: true,
  can_view_documents: true,
  can_download_documents: true,
  can_view_estimates: false,
  can_view_payments: true,
  can_send_messages: true,
  can_approve_change_orders: true,
  can_use_ai_chat: true,
  visible_document_categories: ['contracts', 'invoices', 'photos'],
  visible_photo_categories: ['progress', 'before', 'after'],
};

export function usePortalStats() {
  const { activeCompanyId } = useCompanySwitcher();

  return useQuery({
    queryKey: ['portal-stats', activeCompanyId],
    queryFn: async (): Promise<PortalStats> => {
      if (!activeCompanyId) throw new Error('No company selected');

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const onlineThreshold = new Date(now.getTime() - 5 * 60 * 1000).toISOString(); // 5 min

      // Total users = contacts with portal access enabled (not just session count)
      const { count: totalUsers } = await supabase
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', activeCompanyId)
        .eq('portal_access_enabled', true);

      // Get active today (sessions active today)
      const { count: activeToday } = await supabase
        .from('homeowner_portal_sessions')
        .select('contact_id', { count: 'exact', head: true })
        .eq('tenant_id', activeCompanyId)
        .gte('last_active_at', todayStart);

      // Get online now (active in last 5 minutes)
      const { count: onlineNow } = await supabase
        .from('homeowner_portal_sessions')
        .select('contact_id', { count: 'exact', head: true })
        .eq('tenant_id', activeCompanyId)
        .gte('last_active_at', onlineThreshold)
        .gt('expires_at', now.toISOString());

      // Get actions this week
      const { count: actionsThisWeek } = await supabase
        .from('homeowner_portal_activity')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', activeCompanyId)
        .gte('created_at', weekAgo);

      return {
        total_users: totalUsers || 0,
        active_today: activeToday || 0,
        online_now: onlineNow || 0,
        actions_this_week: actionsThisWeek || 0,
      };
    },
    enabled: !!activeCompanyId,
    refetchInterval: 30000,
  });
}

export function usePortalUsers() {
  const { activeCompanyId } = useCompanySwitcher();

  return useQuery({
    queryKey: ['portal-users', activeCompanyId],
    queryFn: async (): Promise<PortalUser[]> => {
      if (!activeCompanyId) throw new Error('No company selected');

      const now = new Date();
      const onlineThreshold = new Date(now.getTime() - 5 * 60 * 1000).toISOString();

      // 1) All contacts with portal access enabled (source of truth)
      const { data: enabledContacts, error: contactsError } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, email, phone, portal_last_login_at, portal_access_granted_at')
        .eq('tenant_id', activeCompanyId)
        .eq('portal_access_enabled', true);

      if (contactsError) throw contactsError;

      const contactIds = (enabledContacts || []).map(c => c.id);

      // 2) Sessions for those contacts (for project + online status)
      const { data: sessions } = contactIds.length
        ? await supabase
            .from('homeowner_portal_sessions')
            .select('id, contact_id, project_id, expires_at, last_active_at, created_at')
            .eq('tenant_id', activeCompanyId)
            .in('contact_id', contactIds)
            .order('last_active_at', { ascending: false })
        : { data: [] as any[] };

      const sessionsByContact = new Map<string, any[]>();
      for (const s of sessions || []) {
        const arr = sessionsByContact.get(s.contact_id) || [];
        arr.push(s);
        sessionsByContact.set(s.contact_id, arr);
      }

      // 3) Latest project per contact (fallback when no session yet)
      let contactProjects: any[] = [];
      if (contactIds.length) {
        const res = await (supabase as any)
          .from('projects')
          .select('id, name, contact_id, created_at')
          .eq('tenant_id', activeCompanyId)
          .in('contact_id', contactIds)
          .order('created_at', { ascending: false });
        contactProjects = res.data || [];
      }

      const latestProjectByContact = new Map<string, any>();
      for (const p of contactProjects || []) {
        if (!latestProjectByContact.has(p.contact_id)) {
          latestProjectByContact.set(p.contact_id, p);
        }
      }

      const sessionProjectIds = Array.from(
        new Set((sessions || []).map(s => s.project_id).filter(Boolean))
      );
      const allProjectIds = Array.from(
        new Set([...sessionProjectIds, ...(contactProjects || []).map(p => p.id)])
      );

      const { data: projects } = allProjectIds.length
        ? await supabase.from('projects').select('id, name').in('id', allProjectIds)
        : { data: [] as any[] };
      const projectMap = new Map((projects || []).map((p: any) => [p.id, p]));

      // 4) Permissions
      const { data: permissions } = contactIds.length
        ? await supabase
            .from('homeowner_portal_permissions')
            .select('*')
            .in('contact_id', contactIds)
        : { data: [] as any[] };
      const permissionsMap = new Map((permissions || []).map((p: any) => [p.contact_id, p]));

      // 5) Build list
      const users: PortalUser[] = (enabledContacts || []).map((c: any) => {
        const cSessions = sessionsByContact.get(c.id) || [];
        const latestSession = cSessions[0];
        const projectId =
          latestSession?.project_id || latestProjectByContact.get(c.id)?.id || null;
        const project = projectId ? (projectMap.get(projectId) as any) : null;
        const isOnline = cSessions.some(
          (s: any) => s.last_active_at >= onlineThreshold && s.expires_at > now.toISOString()
        );
        const lastLogin = cSessions[0]?.last_active_at || c.portal_last_login_at || null;
        const firstLogin =
          cSessions[cSessions.length - 1]?.created_at || c.portal_access_granted_at || null;

        return {
          id: c.id,
          contact_id: c.id,
          first_name: c.first_name,
          last_name: c.last_name,
          email: c.email,
          phone: c.phone,
          project_id: projectId,
          project_name: project?.name || null,
          project_address: null,
          session_count: cSessions.length,
          last_login: lastLogin,
          first_login: firstLogin,
          is_online: isOnline,
          permissions: permissionsMap.get(c.id) || null,
        };
      });

      return users;
    },
    enabled: !!activeCompanyId,
  });
}

export function usePortalActivity(contactId?: string, limit = 50) {
  const { activeCompanyId } = useCompanySwitcher();

  return useQuery({
    queryKey: ['portal-activity', activeCompanyId, contactId, limit],
    queryFn: async (): Promise<PortalActivity[]> => {
      if (!activeCompanyId) throw new Error('No company selected');

      let query = supabase
        .from('homeowner_portal_activity')
        .select(`
          id,
          contact_id,
          project_id,
          action_type,
          action_details,
          device_type,
          user_agent,
          created_at,
          contact:contacts!inner(first_name, last_name)
        `)
        .eq('tenant_id', activeCompanyId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (contactId) {
        query = query.eq('contact_id', contactId);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Get project names
      const projectIds = (data || [])
        .map(a => a.project_id)
        .filter(Boolean);

      const { data: projects } = await supabase
        .from('projects')
        .select('id, name')
        .in('id', projectIds.length > 0 ? projectIds : ['00000000-0000-0000-0000-000000000000']);

      const projectMap = new Map(projects?.map(p => [p.id, p.name]) || []);

      return (data || []).map(a => ({
        id: a.id,
        contact_id: a.contact_id,
        contact_name: `${(a.contact as any)?.first_name || ''} ${(a.contact as any)?.last_name || ''}`.trim(),
        project_id: a.project_id,
        project_name: a.project_id ? projectMap.get(a.project_id) || null : null,
        action_type: a.action_type,
        action_details: a.action_details as Record<string, any>,
        device_type: a.device_type,
        user_agent: a.user_agent,
        created_at: a.created_at,
      }));
    },
    enabled: !!activeCompanyId,
  });
}

export function useUpdatePortalPermissions() {
  const queryClient = useQueryClient();
  const { activeCompanyId } = useCompanySwitcher();

  return useMutation({
    mutationFn: async ({
      contactId,
      permissions,
    }: {
      contactId: string;
      permissions: Partial<Omit<PortalPermissions, 'id' | 'contact_id'>>;
    }) => {
      if (!activeCompanyId) throw new Error('No company selected');

      const { data, error } = await supabase
        .from('homeowner_portal_permissions')
        .upsert({
          tenant_id: activeCompanyId,
          contact_id: contactId,
          ...permissions,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'contact_id',
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-users'] });
    },
  });
}

export function useRevokePortalAccess() {
  const queryClient = useQueryClient();
  const { activeCompanyId } = useCompanySwitcher();

  return useMutation({
    mutationFn: async (contactId: string) => {
      if (!activeCompanyId) throw new Error('No company selected');

      // Delete all sessions for this contact
      const { error } = await supabase
        .from('homeowner_portal_sessions')
        .delete()
        .eq('contact_id', contactId)
        .eq('tenant_id', activeCompanyId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-users'] });
      queryClient.invalidateQueries({ queryKey: ['portal-stats'] });
    },
  });
}

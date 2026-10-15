import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

const ADMIN_ROLES = ['master', 'owner', 'corporate', 'office_admin'] as const;

/**
 * Admin-only route. Role is verified server-side through the `has_role`
 * database function (user_roles table) — never from client storage.
 * Database RLS remains the real enforcement; this only blocks the UI.
 */
const AdminGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { data: allowed, isLoading } = useQuery({
    queryKey: ['server-admin-check'],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return false;
      const results = await Promise.all(
        ADMIN_ROLES.map((role) =>
          supabase.rpc('has_role', { _user_id: uid, _role: role as never }),
        ),
      );
      return results.some((r) => r.data === true);
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }
  if (!allowed) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
};

export const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ProtectedRoute>
    <AdminGuard>{children}</AdminGuard>
  </ProtectedRoute>
);

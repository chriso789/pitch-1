import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Settings, Users, Shield } from 'lucide-react';

interface FeaturePermission {
  id: string;
  tenant_id: string;
  role: 'master' | 'corporate' | 'office_admin' | 'regional_manager' | 'sales_manager' | 'project_manager';
  feature_key: string;
  is_enabled: boolean;
}

interface RolePermissions {
  [key: string]: { [feature: string]: boolean };
}

const FEATURES = [
  { key: 'pipeline', name: 'Pipeline Management', description: 'Access to lead and opportunity pipeline' },
  { key: 'estimates', name: 'Estimates', description: 'Create and manage estimates' },
  { key: 'projects', name: 'Project Management', description: 'View and manage active projects' },
  { key: 'contacts', name: 'Contact Management', description: 'Manage customer contacts' },
  { key: 'production', name: 'Production Dashboard', description: 'View production metrics and reports' },
  { key: 'leaderboard', name: 'Leaderboard', description: 'View team performance rankings' },
  { key: 'payments', name: 'Payment Processing', description: 'Handle customer payments' },
  { key: 'dialer', name: 'Auto Dialer', description: 'Use automated calling features' },
  { key: 'smart_docs', name: 'Smart Documents', description: 'Create and manage document templates' },
  { key: 'settings', name: 'System Settings', description: 'Configure system preferences' }
];

const ROLES = [
  { key: 'master', name: 'COB', color: 'destructive' },
  { key: 'corporate', name: 'Corporate', color: 'destructive' },
  { key: 'office_admin', name: 'Office Admin', color: 'default' },
  { key: 'regional_manager', name: 'Regional Manager', color: 'default' },
  { key: 'sales_manager', name: 'Sales Manager', color: 'default' },
  { key: 'project_manager', name: 'Project Manager', color: 'secondary' }
];

const FeaturePermissions: React.FC = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [permissions, setPermissions] = useState<RolePermissions>({});
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPermissions();
    loadCurrentUser();
  }, []);

  const loadCurrentUser = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        
        setCurrentUser(profile);
      }
    } catch (error) {
      console.error('Error loading current user:', error);
    }
  };

  const loadPermissions = async () => {
    try {
      const { data: permissionsData, error } = await supabase
        .from('feature_permissions')
        .select('*');

      if (error) throw error;

      // Organize permissions by role and feature
      const organized: RolePermissions = {};
      
      ROLES.forEach(role => {
        organized[role.key] = {};
        FEATURES.forEach(feature => {
          const permission = permissionsData?.find(
            p => p.feature_key === feature.key
          );
          organized[role.key][feature.key] = permission?.is_enabled ?? true;
        });
      });

      setPermissions(organized);
    } catch (error) {
      console.error('Error loading permissions:', error);
      toast({
        title: "Error loading permissions",
        description: "Unable to load feature permissions",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const updatePermission = async (role: string, featureKey: string, enabled: boolean) => {
    if (!currentUser) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('feature_permissions')
        .upsert({
          tenant_id: currentUser.tenant_id,
          role: role as any,
          feature_key: featureKey,
          is_enabled: enabled
        }, {
          onConflict: 'tenant_id,role,feature_key'
        });

      if (error) throw error;

      // Update local state
      setPermissions(prev => ({
        ...prev,
        [role]: {
          ...prev[role],
          [featureKey]: enabled
        }
      }));

      toast({
        title: "Permission updated",
        description: `Feature access for ${role} role has been ${enabled ? 'enabled' : 'disabled'}`,
      });
    } catch (error) {
      console.error('Error updating permission:', error);
      toast({
        title: "Error updating permission",
        description: "Unable to update feature permission",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = async () => {
    if (!currentUser) return;

    setSaving(true);
    try {
      // Delete all current permissions for this tenant
      const { error: deleteError } = await supabase
        .from('feature_permissions')
        .delete()
        .eq('tenant_id', currentUser.tenant_id);

      if (deleteError) throw deleteError;

      // Reload permissions (will show defaults)
      await loadPermissions();

      toast({
        title: "Permissions reset",
        description: "All feature permissions have been reset to default values",
      });
    } catch (error) {
      console.error('Error resetting permissions:', error);
      toast({
        title: "Error resetting permissions",
        description: "Unable to reset feature permissions",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  // Check if user has permission to manage feature permissions
  const canManage = currentUser && (
    currentUser.role === 'master' || 
    currentUser.role === 'corporate' || 
    currentUser.role === 'office_admin'
  );

  if (!canManage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Feature Permissions
          </CardTitle>
          <CardDescription>
            You don't have permission to manage feature access controls.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Feature Permissions Management
          </CardTitle>
          <CardDescription>
            Control which features are available to different user roles. Changes take effect immediately.
          </CardDescription>
          <div className="flex justify-end">
            <Button 
              onClick={resetToDefaults} 
              variant="outline" 
              disabled={saving}
              size="sm"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Reset to Defaults'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {FEATURES.map(feature => (
              <div key={feature.key} className="space-y-3">
                <div className="border-b pb-2">
                  <h4 className="font-medium">{feature.name}</h4>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {ROLES.map(role => (
                    <div 
                      key={role.key}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant={role.color as any} className="text-xs">
                          {role.name}
                        </Badge>
                      </div>
                      <Switch
                        checked={permissions[role.key]?.[feature.key] ?? true}
                        onCheckedChange={(checked) => 
                          updatePermission(role.key, feature.key, checked)
                        }
                        disabled={saving}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Role Permissions Summary
          </CardTitle>
          <CardDescription>
            Quick overview of what each role can access
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {ROLES.map(role => (
              <div key={role.key} className="space-y-2">
                <Badge variant={role.color as any} className="mb-2">
                  {role.name} Role
                </Badge>
                <div className="space-y-1">
                  {FEATURES.map(feature => (
                    <div 
                      key={feature.key}
                      className={`text-sm p-1 rounded ${
                        permissions[role.key]?.[feature.key] 
                          ? 'text-green-700 bg-green-50' 
                          : 'text-red-700 bg-red-50'
                      }`}
                    >
                      {permissions[role.key]?.[feature.key] ? '✓' : '✗'} {feature.name}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default FeaturePermissions;
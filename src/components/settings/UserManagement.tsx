import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Users, Plus, Edit2, Trash2, Settings, Eye, EyeOff, MapPin, Ban, CheckCircle, Building2, Phone, AlertCircle, Mail, RefreshCw, Activity, Clock } from "lucide-react";
import { UserLoginStatusBadge } from "./UserLoginStatusBadge";
import { UserActivityDashboard } from "./UserActivityDashboard";
import { ProfileStatusBadge } from "./ProfileStatusBadge";

import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import FeaturePermissions from './FeaturePermissions';
import { EnhancedUserProfile } from './EnhancedUserProfile';
import { UserLocationAssignments } from './UserLocationAssignments';
import { RepPayStructureConfig } from './RepPayStructureConfig';
import { EmailHealthCheck } from './EmailHealthCheck';
import { ActionsSelector } from "@/components/ui/actions-selector";
import { auditService } from "@/services/auditService";
import { useAvailableCompanies } from "@/hooks/useAvailableCompanies";
import { useCompanySwitcher } from "@/hooks/useCompanySwitcher";

interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  company_name: string;
  resolved_company_name?: string;
  tenant_id?: string;
  title: string;
  is_active: boolean;
  created_at: string;
  phone?: string;
  pay_type?: string;
  last_login?: string | null;
  is_activated?: boolean;
  is_hidden?: boolean;
  hidden_by?: string;
  hidden_at?: string;
}

interface Location {
  id: string;
  name: string;
  address_city?: string;
  address_state?: string;
}

export const UserManagement = () => {
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resendingInvite, setResendingInvite] = useState<string | null>(null);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [openInEditMode, setOpenInEditMode] = useState(false);
  const [locationsForTenant, setLocationsForTenant] = useState<Location[]>([]);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [newUser, setNewUser] = useState({
    email: "",
    first_name: "",
    last_name: "",
    phone: "",
    role: "project_manager",
    company_name: "",
    selected_tenant_id: "",
    title: "",
    pay_type: "commission" as 'hourly' | 'commission'
  });

  const [payStructure, setPayStructure] = useState({
    pay_type: 'commission' as 'hourly' | 'commission',
    hourly_rate: 25,
    overhead_rate: 5,
    commission_structure: 'profit_split' as 'profit_split' | 'sales_percentage',
    commission_rate: 50
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { companies: availableCompanies, isLoading: companiesLoading } = useAvailableCompanies();
  const { activeCompanyId } = useCompanySwitcher();

  const { data: userData, isLoading: loading } = useQuery({
    queryKey: ['user-management-data', activeCompanyId],
    queryFn: async () => {
      const [authResult, rolesResult, tenantsResult, accessResult] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('user_roles').select('user_id, role, tenant_id').order('role', { ascending: true }),
        supabase.from('tenants').select('id, name'),
        supabase.from('user_company_access').select('user_id, tenant_id, is_active'),
      ]);

      // If activeCompanyId is set, filter profiles to that tenant
      let profilesQuery = supabase.from('profiles').select('*').neq('role', 'master').order('created_at', { ascending: false });
      if (activeCompanyId) {
        profilesQuery = profilesQuery.eq('tenant_id', activeCompanyId);
      }
      const profilesResult = await profilesQuery;

      if (profilesResult.error) throw profilesResult.error;

      const user = authResult.data?.user;
      let currentUserData = null;

      const tenantMap = new Map(tenantsResult.data?.map(t => [t.id, t.name]) || []);

      // Get login stats for all users in a single query
      const userIds = profilesResult.data?.map(p => p.id) || [];
      let loginStatsMap = new Map<string, { last_login: string | null; is_activated: boolean }>();
      
      if (userIds.length > 0) {
        const { data: loginData } = await supabase
          .from('session_activity_log')
          .select('user_id, created_at')
          .in('user_id', userIds)
          .in('event_type', ['login_success', 'session_start'])
          .order('created_at', { ascending: false });
        
        // Group by user_id and get latest + count
        const userLogins = new Map<string, { latest: string; count: number }>();
        loginData?.forEach(log => {
          const existing = userLogins.get(log.user_id);
          if (!existing) {
            userLogins.set(log.user_id, { latest: log.created_at, count: 1 });
          } else {
            existing.count++;
          }
        });
        
        userLogins.forEach((value, key) => {
          loginStatsMap.set(key, {
            last_login: value.latest,
            is_activated: value.count > 0
          });
        });
      }

      if (user) {
        const currentProfile = profilesResult.data?.find(p => p.id === user.id);
        const currentUserRole = rolesResult.data?.find(r => r.user_id === user.id);
        const loginStats = loginStatsMap.get(user.id);
        currentUserData = {
          ...currentProfile,
          role: currentUserRole?.role || currentProfile?.role,
          resolved_company_name: currentProfile?.tenant_id ? tenantMap.get(currentProfile.tenant_id) : null,
          last_login: loginStats?.last_login || null,
          is_activated: loginStats?.is_activated ?? false
        };
      }

      // Get role from user_roles table, matching tenant_id if available
      const roleMap = new Map<string, string>();
      rolesResult.data?.forEach(ur => {
        // If activeCompanyId is set, prefer roles from that tenant
        if (activeCompanyId && ur.tenant_id === activeCompanyId) {
          roleMap.set(ur.user_id, ur.role);
        } else if (!roleMap.has(ur.user_id)) {
          roleMap.set(ur.user_id, ur.role);
        }
      });

      const usersWithRoles = profilesResult.data?.map(profile => {
        const loginStats = loginStatsMap.get(profile.id);
        return {
          ...profile,
          role: roleMap.get(profile.id) || profile.role,
          resolved_company_name: profile.tenant_id ? tenantMap.get(profile.tenant_id) : profile.company_name,
          last_login: loginStats?.last_login || null,
          is_activated: loginStats?.is_activated ?? false
        };
      }) || [];

      return { users: usersWithRoles, currentUser: currentUserData };
    },
    staleTime: 60 * 1000,
  });

  const users = userData?.users || [];
  const currentUser = userData?.currentUser;

  // Auto-set tenant for non-master users when dialog opens
  useEffect(() => {
    if (isAddUserOpen && currentUser?.role !== 'master' && currentUser?.tenant_id) {
      setNewUser(prev => ({
        ...prev,
        selected_tenant_id: currentUser.tenant_id
      }));
    }
  }, [isAddUserOpen, currentUser]);

  // Fetch locations when tenant changes
  useEffect(() => {
    const fetchLocations = async () => {
      const tenantId = newUser.selected_tenant_id;
      if (!tenantId) {
        setLocationsForTenant([]);
        setSelectedLocationIds([]);
        return;
      }

      setLoadingLocations(true);
      try {
        const { data, error } = await supabase
          .from('locations')
          .select('id, name, address_city, address_state')
          .eq('tenant_id', tenantId)
          .eq('is_active', true)
          .order('name');

        if (error) throw error;

        const locations = data || [];
        setLocationsForTenant(locations);
        
        // Auto-select if only one location
        if (locations.length === 1) {
          setSelectedLocationIds([locations[0].id]);
        } else {
          setSelectedLocationIds([]);
        }
      } catch (err) {
        console.error('Error fetching locations:', err);
        setLocationsForTenant([]);
      } finally {
        setLoadingLocations(false);
      }
    };

    fetchLocations();
  }, [newUser.selected_tenant_id]);

  const loadUsers = () => {
    queryClient.invalidateQueries({ queryKey: ['user-management-data'] });
  };

  const toggleLocationSelection = (locationId: string) => {
    setSelectedLocationIds(prev => 
      prev.includes(locationId)
        ? prev.filter(id => id !== locationId)
        : [...prev, locationId]
    );
  };

  const toggleAllLocations = () => {
    if (selectedLocationIds.length === locationsForTenant.length) {
      setSelectedLocationIds([]);
    } else {
      setSelectedLocationIds(locationsForTenant.map(l => l.id));
    }
  };

  const createUser = async () => {
    if (isCreating) return;
    
    try {
      setIsCreating(true);

      // Validate email
      if (!newUser.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newUser.email)) {
        toast({
          title: "Invalid Email",
          description: "Please enter a valid email address",
          variant: "destructive",
        });
        return;
      }

      // Validate required fields
      if (!newUser.first_name || !newUser.last_name) {
        toast({
          title: "Missing Information",
          description: "Please enter first and last name",
          variant: "destructive",
        });
        return;
      }

      // Validate location selection if company has locations
      if (locationsForTenant.length > 0 && selectedLocationIds.length === 0) {
        toast({
          title: "Location Required",
          description: "Please select at least one location for this user",
          variant: "destructive",
        });
        return;
      }

      // Call the admin edge function - no password required now
      const { data, error } = await supabase.functions.invoke('admin-create-user', {
        body: {
          email: newUser.email,
          firstName: newUser.first_name,
          lastName: newUser.last_name,
          phone: newUser.phone || undefined,
          role: newUser.role,
          companyName: newUser.company_name,
          assignedTenantId: newUser.selected_tenant_id || undefined,
          title: newUser.title,
          payType: payStructure.pay_type,
          hourlyRate: payStructure.pay_type === 'hourly' ? payStructure.hourly_rate : undefined,
          payStructure: payStructure.pay_type === 'commission' && ['sales_manager', 'regional_manager'].includes(newUser.role) 
            ? {
                overhead_rate: payStructure.overhead_rate,
                commission_structure: payStructure.commission_structure,
                commission_rate: payStructure.commission_rate
              } 
            : undefined,
          locationIds: selectedLocationIds.length > 0 ? selectedLocationIds : undefined
        }
      });

      if (error) {
        throw new Error(error.message || "Failed to create user");
      }

      toast({
        title: "User Created Successfully",
        description: `${newUser.first_name} ${newUser.last_name} has been added. An onboarding email with password setup link has been sent.`,
      });

      setIsAddUserOpen(false);
      setNewUser({
        email: "",
        first_name: "",
        last_name: "",
        phone: "",
        role: "project_manager",
        company_name: "",
        selected_tenant_id: "",
        title: "",
        pay_type: "commission"
      });

      setSelectedLocationIds([]);
      setLocationsForTenant([]);
      
      setPayStructure({
        pay_type: 'commission',
        hourly_rate: 25,
        overhead_rate: 5,
        commission_structure: 'profit_split',
        commission_rate: 50
      });
      
      loadUsers();
    } catch (error: unknown) {
      console.error('Error creating user:', error);
      const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred";
      toast({
        title: "Error Creating User",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const toggleUserStatus = async (userId: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: !isActive })
        .eq('id', userId);

      if (error) throw error;

      toast({
        title: "User Updated",
        description: `User has been ${!isActive ? 'activated' : 'deactivated'}.`,
      });

      await auditService.logChange(
        'profiles',
        'UPDATE',
        userId,
        { is_active: isActive },
        { is_active: !isActive }
      );

      loadUsers();
    } catch (error) {
      console.error('Error updating user:', error);
      toast({
        title: "Error",
        description: "Failed to update user status.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;

    try {
      setDeleting(true);

      const { error } = await supabase.functions.invoke('admin-delete-user', {
        body: { userId: userToDelete.id }
      });

      if (error) throw error;

      toast({
        title: "User Deleted",
        description: `${userToDelete.first_name} ${userToDelete.last_name} has been removed.`,
      });

      setShowDeleteDialog(false);
      setUserToDelete(null);
      loadUsers();
    } catch (error: unknown) {
      console.error('Error deleting user:', error);
      const errorMessage = error instanceof Error ? error.message : "Failed to delete user";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const confirmDeleteUser = (user: User) => {
    setUserToDelete(user);
    setShowDeleteDialog(true);
  };

  const resendInvite = async (user: User) => {
    setResendingInvite(user.id);
    try {
      const { data, error } = await supabase.functions.invoke('resend-user-invitation', {
        body: { userId: user.id }
      });

      if (error) {
        throw new Error(error.message || 'Failed to resend invitation');
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      toast({
        title: "Invitation Sent",
        description: `Invitation email resent to ${user.email}`,
      });
    } catch (error) {
      console.error('Error resending invite:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to resend invitation';
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setResendingInvite(null);
    }
  };

  const toggleHiddenStatus = async (userId: string, isCurrentlyHidden: boolean) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ 
          is_hidden: !isCurrentlyHidden,
          hidden_by: !isCurrentlyHidden ? currentUser?.id : null,
          hidden_at: !isCurrentlyHidden ? new Date().toISOString() : null
        })
        .eq('id', userId);

      if (error) throw error;

      toast({
        title: isCurrentlyHidden ? "User Now Visible" : "User Hidden",
        description: isCurrentlyHidden 
          ? "This user is now visible to the entire team" 
          : "This user is now hidden from the team and all reports",
      });

      await auditService.logChange(
        'profiles',
        'UPDATE',
        userId,
        { is_hidden: isCurrentlyHidden },
        { is_hidden: !isCurrentlyHidden }
      );

      loadUsers();
    } catch (error) {
      console.error('Error updating user visibility:', error);
      toast({
        title: "Error",
        description: "Failed to update user visibility",
        variant: "destructive",
      });
    }
  };

  const getActionsForUser = (user: User) => {
    const actions = [];

    if (!currentUser) {
      return [{
        label: 'View Profile',
        icon: Eye,
        onClick: () => setSelectedUserId(user.id)
      }];
    }

    actions.push({
      label: 'View Profile',
      icon: Eye,
      onClick: () => setSelectedUserId(user.id)
    });

    const roleHierarchy: Record<string, number> = {
      master: 1,
      owner: 2,
      corporate: 3,
      office_admin: 4,
      regional_manager: 5,
      sales_manager: 6,
      project_manager: 7
    };
    
    const currentLevel = roleHierarchy[currentUser.role] || 999;
    const targetLevel = roleHierarchy[user.role] || 999;
    
    const canEdit = currentUser.role === 'master' || currentLevel < targetLevel || currentUser.id === user.id;

    if (canEdit) {
      actions.push({
        label: 'Edit Profile',
        icon: Edit2,
        onClick: () => {
          setOpenInEditMode(true);
          setSelectedUserId(user.id);
        }
      });
    }

    actions.push({
      label: user.is_active ? 'Deactivate' : 'Activate',
      icon: user.is_active ? Ban : CheckCircle,
      onClick: () => toggleUserStatus(user.id, user.is_active),
      separator: true
    });

    // Add resend invite action (for all users, as they may need password reset)
    actions.push({
      label: resendingInvite === user.id ? 'Sending...' : 'Resend Invite',
      icon: Mail,
      onClick: () => resendInvite(user),
      disabled: resendingInvite === user.id
    });

    // Add hide/unhide action for master/owner only
    if (currentUser.role === 'master' || currentUser.role === 'owner') {
      actions.push({
        label: user.is_hidden ? 'Show to Team' : 'Hide from Team',
        icon: user.is_hidden ? Eye : EyeOff,
        onClick: () => toggleHiddenStatus(user.id, !!user.is_hidden),
        separator: true
      });
    }

    const canDelete = currentUser.role === 'master' || currentLevel < targetLevel;

    if (canDelete && user.id !== currentUser.id) {
      actions.push({
        label: 'Delete User',
        icon: Trash2,
        variant: 'destructive' as const,
        onClick: () => confirmDeleteUser(user),
        disabled: user.id === currentUser.id
      });
    }

    return actions;
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'master': return 'destructive';
      case 'owner': return 'destructive';
      case 'corporate': return 'destructive';
      case 'office_admin': return 'default';
      case 'regional_manager': return 'default';
      case 'sales_manager': return 'secondary';
      case 'project_manager': return 'outline';
      default: return 'outline';
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-10 w-28" />
            </div>
            <Skeleton className="h-10 w-80" />
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-4">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-32" />
                      <Skeleton className="h-4 w-48" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-6 w-24" />
                    <Skeleton className="h-8 w-8" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (selectedUserId) {
    return (
      <EnhancedUserProfile 
        userId={selectedUserId} 
        onClose={() => {
          setSelectedUserId(null);
          setOpenInEditMode(false);
        }}
        initialEditMode={openInEditMode}
        onProfileUpdated={() => {
          queryClient.invalidateQueries({ queryKey: ['user-management-data'] });
        }}
      />
    );
  }

  return (
    <>
    <Tabs defaultValue="users" className="space-y-6">
      <TabsList>
        <TabsTrigger value="users" className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          User Management
        </TabsTrigger>
        {['master', 'corporate', 'owner', 'office_admin'].includes(currentUser?.role) && (
          <TabsTrigger value="activity" className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            User Activity
          </TabsTrigger>
        )}
        <TabsTrigger value="locations" className="flex items-center gap-2">
          <MapPin className="h-4 w-4" />
          Location Access
        </TabsTrigger>
        <TabsTrigger value="permissions" className="flex items-center gap-2">
          <Settings className="h-4 w-4" />
          Feature Permissions
        </TabsTrigger>
        <TabsTrigger value="email" className="flex items-center gap-2">
          <Mail className="h-4 w-4" />
          Email Health
        </TabsTrigger>
      </TabsList>

      <TabsContent value="users">
        
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                User Management
              </CardTitle>
              <Dialog open={isAddUserOpen} onOpenChange={setIsAddUserOpen}>
                <DialogTrigger asChild>
                  <Button className="flex items-center gap-2">
                    <Plus className="h-4 w-4" />
                    Add User
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Add New User</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="first_name">First Name *</Label>
                        <Input
                          id="first_name"
                          value={newUser.first_name}
                          onChange={(e) => setNewUser({ ...newUser, first_name: e.target.value })}
                          placeholder="John"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="last_name">Last Name *</Label>
                        <Input
                          id="last_name"
                          value={newUser.last_name}
                          onChange={(e) => setNewUser({ ...newUser, last_name: e.target.value })}
                          placeholder="Smith"
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="email">Email *</Label>
                      <Input
                        id="email"
                        type="email"
                        value={newUser.email}
                        onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                        placeholder="john.smith@company.com"
                      />
                      <p className="text-xs text-muted-foreground">
                        An email with password setup link will be sent to this address
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="phone" className="flex items-center gap-2">
                        <Phone className="h-4 w-4" />
                        Phone Number
                      </Label>
                      <Input
                        id="phone"
                        type="tel"
                        value={newUser.phone}
                        onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                        placeholder="(555) 123-4567"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="role">Role *</Label>
                        <Select value={newUser.role} onValueChange={(value) => setNewUser({ ...newUser, role: value })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="project_manager">Project Manager</SelectItem>
                            <SelectItem value="sales_manager">Sales Manager</SelectItem>
                            <SelectItem value="regional_manager">Regional Manager</SelectItem>
                            <SelectItem value="office_admin">Office Admin</SelectItem>
                            <SelectItem value="corporate">Corporate</SelectItem>
                            <SelectItem value="owner">Owner</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="title">Title</Label>
                        <Input
                          id="title"
                          value={newUser.title}
                          onChange={(e) => setNewUser({ ...newUser, title: e.target.value })}
                          placeholder="Sales Representative"
                        />
                      </div>
                    </div>

                    {/* Company Assignment - Master users only see dropdown */}
                    {currentUser?.role === 'master' ? (
                      <div className="space-y-2">
                        <Label htmlFor="company">Assign to Company</Label>
                        <Select 
                          value={newUser.selected_tenant_id} 
                          onValueChange={(value) => {
                            const company = availableCompanies.find(c => c.id === value);
                            setNewUser({ 
                              ...newUser, 
                              selected_tenant_id: value,
                              company_name: company?.name || ''
                            });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select a company..." />
                          </SelectTrigger>
                          <SelectContent>
                            {companiesLoading ? (
                              <SelectItem value="loading" disabled>Loading companies...</SelectItem>
                            ) : availableCompanies.length === 0 ? (
                              <SelectItem value="none" disabled>No companies available</SelectItem>
                            ) : (
                              availableCompanies.map((company) => (
                                <SelectItem key={company.id} value={company.id}>
                                  <div className="flex items-center gap-2">
                                    <Building2 className="h-4 w-4 text-muted-foreground" />
                                    <span>{company.name}</span>
                                    {company.subdomain && (
                                      <span className="text-xs text-muted-foreground">
                                        ({company.subdomain})
                                      </span>
                                    )}
                                  </div>
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          User will only appear in this company's directory
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label>Company</Label>
                        <div className="flex items-center gap-2 p-2 border rounded-md bg-muted">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{currentUser?.resolved_company_name || 'Your Company'}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          New user will be added to your company
                        </p>
                      </div>
                    )}

                    {/* Location Assignment */}
                    {newUser.selected_tenant_id && (
                      <div className="space-y-2">
                        <Label className="flex items-center gap-2">
                          <MapPin className="h-4 w-4" />
                          Assign to Locations *
                        </Label>
                        {loadingLocations ? (
                          <div className="p-3 border rounded-md">
                            <Skeleton className="h-5 w-40" />
                          </div>
                        ) : locationsForTenant.length === 0 ? (
                          <div className="p-3 border rounded-md bg-muted/50 text-sm text-muted-foreground">
                            No locations configured for this company
                          </div>
                        ) : (
                          <div className="border rounded-md divide-y">
                            {/* Select All option */}
                            <div 
                              className="flex items-center gap-3 p-3 hover:bg-muted/50 cursor-pointer"
                              onClick={toggleAllLocations}
                            >
                              <Checkbox 
                                checked={selectedLocationIds.length === locationsForTenant.length}
                                onCheckedChange={toggleAllLocations}
                              />
                              <span className="font-medium text-sm">Select All Locations</span>
                            </div>
                            {/* Individual locations */}
                            {locationsForTenant.map((location) => (
                              <div 
                                key={location.id}
                                className="flex items-center gap-3 p-3 hover:bg-muted/50 cursor-pointer"
                                onClick={() => toggleLocationSelection(location.id)}
                              >
                                <Checkbox 
                                  checked={selectedLocationIds.includes(location.id)}
                                  onCheckedChange={() => toggleLocationSelection(location.id)}
                                />
                                <div>
                                  <div className="font-medium text-sm">{location.name}</div>
                                  {(location.address_city || location.address_state) && (
                                    <div className="text-xs text-muted-foreground">
                                      {[location.address_city, location.address_state].filter(Boolean).join(', ')}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {locationsForTenant.length > 0 && selectedLocationIds.length === 0 && (
                          <p className="text-xs text-destructive flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            At least one location must be selected
                          </p>
                        )}
                        {locationsForTenant.length > 0 && selectedLocationIds.length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            User will have access to {selectedLocationIds.length} location{selectedLocationIds.length !== 1 ? 's' : ''}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Pay Structure Configuration for Sales Reps */}
                    {['sales_manager', 'regional_manager'].includes(newUser.role) && (
                      <RepPayStructureConfig
                        role={newUser.role}
                        onChange={(config) => setPayStructure(config)}
                        currentUser={currentUser}
                        initialPayType={payStructure.pay_type}
                      />
                    )}

                    <Button onClick={createUser} className="w-full" disabled={isCreating}>
                      {isCreating ? "Creating User..." : "Create User"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Last Login</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {user.first_name} {user.last_name}
                        {user.is_hidden && (
                          <Badge variant="outline" className="text-xs bg-muted/50 text-muted-foreground">
                            <EyeOff className="h-3 w-3 mr-1" />
                            Hidden
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge variant={getRoleBadgeVariant(user.role)}>
                        {user.role?.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.resolved_company_name ? (
                        <div className="flex items-center gap-1.5">
                          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{user.resolved_company_name}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <UserLoginStatusBadge 
                        lastLogin={user.last_login || null} 
                        isActivated={user.is_activated || false}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.is_active ? "default" : "secondary"}>
                        {user.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <ActionsSelector actions={getActionsForUser(user)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      {['master', 'corporate', 'owner', 'office_admin'].includes(currentUser?.role) && (
        <TabsContent value="activity">
          <UserActivityDashboard 
            tenantFilter={['master', 'corporate'].includes(currentUser?.role) ? undefined : currentUser?.tenant_id}
            showCompanyColumn={['master', 'corporate'].includes(currentUser?.role)}
          />
        </TabsContent>
      )}

      <TabsContent value="locations">
        <UserLocationAssignments />
      </TabsContent>

      <TabsContent value="permissions">
        <FeaturePermissions />
      </TabsContent>

      <TabsContent value="email">
        <EmailHealthCheck />
      </TabsContent>
    </Tabs>

    {/* Delete Confirmation Dialog */}
    <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete User</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete <strong>{userToDelete?.first_name} {userToDelete?.last_name}</strong> ({userToDelete?.email})?
            <br /><br />
            This action will deactivate the user and they will no longer be able to access the system.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDeleteUser}
            disabled={deleting}
            className="bg-destructive hover:bg-destructive/90"
          >
            {deleting ? "Deleting..." : "Delete User"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
};
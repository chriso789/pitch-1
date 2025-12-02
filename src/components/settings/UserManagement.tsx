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
import { Users, Plus, Edit2, Trash2, Shield, Settings, Eye, MapPin, EyeOff, Ban, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import FeaturePermissions from './FeaturePermissions';
import { EnhancedUserProfile } from './EnhancedUserProfile';
import { UserLocationAssignments } from './UserLocationAssignments';
import { RepPayStructureConfig } from './RepPayStructureConfig';
import { ActionsSelector } from "@/components/ui/actions-selector";
import { auditService } from "@/services/auditService";

interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  company_name: string;
  title: string;
  is_active: boolean;
  is_developer: boolean;
  created_at: string;
}

export const UserManagement = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [openInEditMode, setOpenInEditMode] = useState(false);
  const [newUser, setNewUser] = useState({
    email: "",
    first_name: "",
    last_name: "",
    role: "project_manager",
    company_name: "",
    title: "",
    is_developer: false,
    password: "",
    password_confirm: ""
  });

  const [payStructure, setPayStructure] = useState({
    overhead_rate: 5,
    commission_structure: 'profit_split' as 'profit_split' | 'sales_percentage',
    commission_rate: 50
  });
  const { toast } = useToast();

  useEffect(() => {
    loadUsers();
    getCurrentUser();
  }, []);

  const getCurrentUser = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Fetch profile data
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        
        // Fetch user role from user_roles table (secure)
        const { data: userRole } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .order('role', { ascending: true })
          .limit(1)
          .single();
        
        setCurrentUser({
          ...profile,
          role: userRole?.role || profile?.role
        });
      }
    } catch (error) {
      console.error('Error getting current user:', error);
    }
  };

  const loadUsers = async () => {
    try {
      // Fetch profiles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;

      // Fetch roles from user_roles table for all users
      const { data: userRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .order('role', { ascending: true });

      if (rolesError) {
        console.warn('Error loading user roles, falling back to profiles.role:', rolesError);
      }

      // Create a map of user_id to role from user_roles table
      const roleMap = new Map(
        userRoles?.map(ur => [ur.user_id, ur.role]) || []
      );

      // Merge profiles with roles from user_roles table
      const usersWithRoles = profiles?.map(profile => ({
        ...profile,
        role: roleMap.get(profile.id) || profile.role // Fallback to profile.role if not in user_roles
      })) || [];

      setUsers(usersWithRoles);
    } catch (error) {
      console.error('Error loading users:', error);
      toast({
        title: "Error",
        description: "Failed to load users.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const validatePassword = (password: string): string | null => {
    if (password.length < 8) {
      return "Password must be at least 8 characters long";
    }
    if (!/[A-Z]/.test(password)) {
      return "Password must contain at least one uppercase letter";
    }
    if (!/[a-z]/.test(password)) {
      return "Password must contain at least one lowercase letter";
    }
    if (!/[0-9]/.test(password)) {
      return "Password must contain at least one number";
    }
    if (!/[!@#$%^&*]/.test(password)) {
      return "Password must contain at least one special character (!@#$%^&*)";
    }
    return null;
  };

  const createUser = async () => {
    if (isCreating) return;
    
    try {
      setIsCreating(true);
      
      // Validate password
      const passwordError = validatePassword(newUser.password);
      if (passwordError) {
        toast({
          title: "Invalid Password",
          description: passwordError,
          variant: "destructive",
        });
        return;
      }

      // Check password confirmation
      if (newUser.password !== newUser.password_confirm) {
        toast({
          title: "Password Mismatch",
          description: "Passwords do not match",
          variant: "destructive",
        });
        return;
      }

      // Validate email
      if (!newUser.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newUser.email)) {
        toast({
          title: "Invalid Email",
          description: "Please enter a valid email address",
          variant: "destructive",
        });
        return;
      }

      // Call the admin edge function to create user
      const { data, error } = await supabase.functions.invoke('admin-create-user', {
        body: {
          email: newUser.email,
          password: newUser.password,
          firstName: newUser.first_name,
          lastName: newUser.last_name,
          role: newUser.role,
          companyName: newUser.company_name,
          title: newUser.title,
          isDeveloper: newUser.is_developer,
          payStructure: ['sales_manager', 'regional_manager'].includes(newUser.role) ? payStructure : undefined
        }
      });

      if (error) {
        throw new Error(error.message || "Failed to create user");
      }

      toast({
        title: "User Created Successfully",
        description: `${newUser.first_name} ${newUser.last_name} has been added. A welcome email has been sent. Please provide them with the password you set.`,
      });

      setIsAddUserOpen(false);
      setNewUser({
        email: "",
        first_name: "",
        last_name: "",
        role: "project_manager",
        company_name: "",
        title: "",
        is_developer: false,
        password: "",
        password_confirm: ""
      });
      
      setPayStructure({
        overhead_rate: 5,
        commission_structure: 'profit_split',
        commission_rate: 50
      });
      
      loadUsers();
    } catch (error: any) {
      console.error('Error creating user:', error);
      toast({
        title: "Error Creating User",
        description: error.message || "An unexpected error occurred. Please try again.",
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

      // Log the audit
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
    } catch (error: any) {
      console.error('Error deleting user:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete user.",
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

  const getActionsForUser = (user: User) => {
    const actions = [];

    // Early return with view-only if currentUser is not loaded
    if (!currentUser) {
      console.warn('⚠️ currentUser not loaded, showing view-only action');
      return [{
        label: 'View Profile',
        icon: Eye,
        onClick: () => setSelectedUserId(user.id)
      }];
    }

    console.log('🔍 Getting actions for user:', {
      userName: `${user.first_name} ${user.last_name}`,
      userRole: user.role,
      currentUserRole: currentUser.role,
      currentUserId: currentUser.id,
      targetUserId: user.id
    });

    // View action - available to all
    actions.push({
      label: 'View Profile',
      icon: Eye,
      onClick: () => setSelectedUserId(user.id)
    });

    // Edit action - role-based permissions using hierarchy
    const roleHierarchy = {
      master: 1,
      corporate: 2,
      office_admin: 3,
      regional_manager: 4,
      sales_manager: 5,
      project_manager: 6
    };
    
    const currentLevel = roleHierarchy[currentUser.role] || 999;
    const targetLevel = roleHierarchy[user.role] || 999;
    
    const canEdit =
      currentUser.role === 'master' || // Master can edit all
      currentLevel < targetLevel || // Can edit users below in hierarchy
      currentUser.id === user.id; // Users can edit themselves

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

    // Activate/Deactivate - with separator
    actions.push({
      label: user.is_active ? 'Deactivate' : 'Activate',
      icon: user.is_active ? Ban : CheckCircle,
      onClick: () => toggleUserStatus(user.id, user.is_active),
      separator: true
    });

    // Delete action - role-based permissions using hierarchy
    const canDelete =
      currentUser.role === 'master' || // Master can delete all
      currentLevel < targetLevel; // Can delete users below in hierarchy

    console.log('🗑️ Delete permission check:', {
      canDelete,
      currentRole: currentUser.role,
      currentLevel,
      targetRole: user.role,
      targetLevel,
      isSelf: user.id === currentUser.id,
      willShowDelete: canDelete && user.id !== currentUser.id
    });

    if (canDelete && user.id !== currentUser.id) { // Can't delete yourself
      const deleteLabel = 'Delete User';
      console.log('✅ Adding delete button for user:', user.first_name, 'with label:', deleteLabel);
      actions.push({
        label: deleteLabel,
        icon: Trash2,
        variant: 'destructive' as const,
        onClick: () => confirmDeleteUser(user),
        disabled: user.id === currentUser.id
      });
    } else {
      console.log('❌ Not adding delete button - reason:', {
        canDelete,
        isSelf: user.id === currentUser.id
      });
    }

    console.log('📋 Final actions:', actions.map(a => a.label));
    return actions;
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'master': return 'destructive';
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
          <div className="text-center py-8 text-muted-foreground">
            Loading users...
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show user profile if one is selected
  if (selectedUserId) {
    return (
      <EnhancedUserProfile 
        userId={selectedUserId} 
        onClose={() => {
          setSelectedUserId(null);
          setOpenInEditMode(false);
        }}
        initialEditMode={openInEditMode}
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
        <TabsTrigger value="locations" className="flex items-center gap-2">
          <MapPin className="h-4 w-4" />
          Location Access
        </TabsTrigger>
        <TabsTrigger value="permissions" className="flex items-center gap-2">
          <Settings className="h-4 w-4" />
          Feature Permissions
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
                        <Label htmlFor="first_name">First Name</Label>
                        <Input
                          id="first_name"
                          value={newUser.first_name}
                          onChange={(e) => setNewUser({ ...newUser, first_name: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="last_name">Last Name</Label>
                        <Input
                          id="last_name"
                          value={newUser.last_name}
                          onChange={(e) => setNewUser({ ...newUser, last_name: e.target.value })}
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        value={newUser.email}
                        onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="password">Password *</Label>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          value={newUser.password}
                          onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                          placeholder="Min 8 chars, uppercase, number, special char"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="password_confirm">Confirm Password *</Label>
                      <div className="relative">
                        <Input
                          id="password_confirm"
                          type={showPasswordConfirm ? "text" : "password"}
                          value={newUser.password_confirm}
                          onChange={(e) => setNewUser({ ...newUser, password_confirm: e.target.value })}
                          placeholder="Re-enter password"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3"
                          onClick={() => setShowPasswordConfirm(!showPasswordConfirm)}
                        >
                          {showPasswordConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="role">Role</Label>
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
                            {currentUser?.role === 'master' && <SelectItem value="master">Master</SelectItem>}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="title">Title</Label>
                        <Input
                          id="title"
                          value={newUser.title}
                          onChange={(e) => setNewUser({ ...newUser, title: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="company_name">Company Name</Label>
                      <Input
                        id="company_name"
                        value={newUser.company_name}
                        onChange={(e) => setNewUser({ ...newUser, company_name: e.target.value })}
                      />
                    </div>

                    {currentUser?.role === 'master' && (
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="is_developer"
                          checked={newUser.is_developer}
                          onChange={(e) => setNewUser({ ...newUser, is_developer: e.target.checked })}
                          className="h-4 w-4"
                        />
                        <Label htmlFor="is_developer" className="flex items-center gap-2">
                          <Shield className="h-4 w-4" />
                          Developer Access
                        </Label>
                      </div>
                    )}

                    {/* Pay Structure Configuration for Sales Reps */}
                    {['admin', 'manager'].includes(newUser.role) && (
                      <RepPayStructureConfig
                        role={newUser.role}
                        onChange={setPayStructure}
                        currentUser={currentUser}
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
                  <TableHead>Title</TableHead>
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
                        {user.is_developer && <Shield className="h-4 w-4 text-primary" />}
                      </div>
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge variant={getRoleBadgeVariant(user.role)}>
                        {user.role}
                      </Badge>
                    </TableCell>
                    <TableCell>{user.company_name}</TableCell>
                    <TableCell>{user.title}</TableCell>
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

      <TabsContent value="locations">
        <UserLocationAssignments />
      </TabsContent>

      <TabsContent value="permissions">
        <FeaturePermissions />
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
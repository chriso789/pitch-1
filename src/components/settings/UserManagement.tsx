import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Plus, Edit, Trash2, Shield, Settings, Eye, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import FeaturePermissions from './FeaturePermissions';
import { EnhancedUserProfile } from './EnhancedUserProfile';
import { UserLocationAssignments } from './UserLocationAssignments';

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
  const [newUser, setNewUser] = useState({
    email: "",
    first_name: "",
    last_name: "",
    role: "user",
    company_name: "",
    title: "",
    is_developer: false
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
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        setCurrentUser(profile);
      }
    } catch (error) {
      console.error('Error getting current user:', error);
    }
  };

  const loadUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUsers(data || []);
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

  const createUser = async () => {
    try {
      // Generate a temporary password
      const temporaryPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8).toUpperCase() + "123!";

      // First create the auth user with temporary password
      const { data, error: authError } = await supabase.auth.signUp({
        email: newUser.email,
        password: temporaryPassword,
        options: {
          emailRedirectTo: `${window.location.origin}/`
        }
      });

      if (authError) {
        // Handle specific auth errors
        if (authError.message.includes('User already registered')) {
          throw new Error('A user with this email already exists');
        }
        throw authError;
      }

      if (data.user) {
        // Create the user profile
        const { error: profileError } = await supabase
          .from('profiles')
          .insert({
            id: data.user.id,
            email: newUser.email,
            first_name: newUser.first_name,
            last_name: newUser.last_name,
            role: newUser.role as any,
            company_name: newUser.company_name,
            title: newUser.title,
            is_developer: newUser.is_developer,
            tenant_id: currentUser?.tenant_id
          });

        if (profileError) throw profileError;

        // Send invitation email with credentials
        try {
          const { error: emailError } = await supabase.functions.invoke('send-user-invitation', {
            body: {
              email: newUser.email,
              firstName: newUser.first_name,
              lastName: newUser.last_name,
              role: newUser.role,
              companyName: newUser.company_name,
              temporaryPassword
            }
          });

          if (emailError) {
            console.warn('Email sending failed:', emailError);
            toast({
              title: "User created but email failed",
              description: `${newUser.first_name} ${newUser.last_name} has been added. Please provide them with these credentials:\nEmail: ${newUser.email}\nTemporary Password: ${temporaryPassword}`,
              variant: "destructive",
            });
          } else {
            toast({
              title: "User created successfully",
              description: `${newUser.first_name} ${newUser.last_name} has been added and an invitation email has been sent with login instructions.`,
            });
          }
        } catch (emailError) {
          console.warn('Email sending failed:', emailError);
          toast({
            title: "User created but email failed", 
            description: `${newUser.first_name} ${newUser.last_name} has been added. Please provide them with these credentials:\nEmail: ${newUser.email}\nTemporary Password: ${temporaryPassword}`,
            variant: "destructive",
          });
        }

        setIsAddUserOpen(false);
        setNewUser({
          email: "",
          first_name: "",
          last_name: "",
          role: "user",
          company_name: "",
          title: "",
          is_developer: false
        });
        loadUsers();
      }
    } catch (error: any) {
      console.error('Error creating user:', error);
      toast({
        title: "Error creating user",
        description: error.message || "An unexpected error occurred",
        variant: "destructive",
      });
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

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'master': return 'destructive';
      case 'admin': return 'default';
      case 'manager': return 'secondary';
      case 'user': return 'outline';
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
      <UserProfile 
        userId={selectedUserId} 
        onClose={() => setSelectedUserId(null)} 
      />
    );
  }

  return (
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
                <DialogContent className="sm:max-w-md">
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

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="role">Role</Label>
                        <Select value={newUser.role} onValueChange={(value) => setNewUser({ ...newUser, role: value })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="user">User</SelectItem>
                            <SelectItem value="manager">Manager</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
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

                    <Button onClick={createUser} className="w-full">
                      Create User
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
                    <TableCell className="space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedUserId(user.id)}
                        className="flex items-center gap-1"
                      >
                        <Eye className="h-3 w-3" />
                        View
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleUserStatus(user.id, user.is_active)}
                      >
                        {user.is_active ? "Deactivate" : "Activate"}
                      </Button>
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
  );
};
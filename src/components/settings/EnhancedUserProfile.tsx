import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAvailableCompanies } from "@/hooks/useAvailableCompanies";
import { UserCommissionSettings } from "./UserCommissionSettings";
import { UserActivityTab } from "./UserActivityTab";
import { 
  User, 
  Phone, 
  Mail, 
  Building, 
  Camera, 
  ArrowLeft,
  Edit3,
  Save,
  X,
  DollarSign,
  TrendingUp,
  Target,
  Key,
  Upload,
  Shield,
  FileImage,
  Calendar,
  Activity
} from "lucide-react";
import { format } from "date-fns";

interface EnhancedUserProfileProps {
  userId: string;
  onClose: () => void;
  initialEditMode?: boolean;
}

export const EnhancedUserProfile: React.FC<EnhancedUserProfileProps> = ({ userId, onClose, initialEditMode = false }) => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(initialEditMode);
  const [commissionHistory, setCommissionHistory] = useState<any[]>([]);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [checkingPermissions, setCheckingPermissions] = useState(true);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { companies } = useAvailableCompanies();

  useEffect(() => {
    loadUserProfile();
    getCurrentUser();
  }, [userId]);

  const getCurrentUser = async () => {
    try {
      setCheckingPermissions(true);
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', authUser.id)
          .single();
        setCurrentUser(profile);
        console.log('Current user loaded:', profile);
      }
    } catch (error) {
      console.error('Error getting current user:', error);
    } finally {
      setCheckingPermissions(false);
    }
  };

  // Check if current user has permission to edit this profile
  const canEditProfile = () => {
    console.log('Permission check:', {
      hasCurrentUser: !!currentUser,
      hasUser: !!user,
      currentUserRole: currentUser?.role,
      currentUserId: currentUser?.id,
      targetUserRole: user?.role,
      targetUserId: user?.id
    });

    if (!currentUser || !user) {
      console.warn('Missing user data for permission check');
      return false;
    }

    // Role hierarchy for permission checks
    const roleHierarchy = {
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

    // Master can edit all
    if (currentUser.role === 'master') {
      console.log('✓ Permission granted: Master role');
      return true;
    }

    // Can edit users below in hierarchy
    if (currentLevel < targetLevel) {
      console.log('✓ Permission granted: Higher role in hierarchy');
      return true;
    }

    // Users can edit themselves
    if (currentUser.id === user.id) {
      console.log('✓ Permission granted: Self-edit');
      return true;
    }

    console.log('✗ Permission denied');
    return false;
  };

  const loadUserProfile = async () => {
    try {
      setLoading(true);
      
      const [userResult, commissionResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single(),
        supabase
          .from('commission_calculations')
          .select('*')
          .eq('sales_rep_id', userId)
          .order('calculated_at', { ascending: false })
          .limit(5)
      ]);

      if (userResult.error) throw userResult.error;
      setUser(userResult.data);
      setCommissionHistory(commissionResult.data || []);
    } catch (error) {
      console.error('Error loading user profile:', error);
      toast({
        title: "Error",
        description: "Failed to load user profile",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Format tenure display from created_at date
  const formatTenure = (createdAt: string) => {
    if (!createdAt) return 'Unknown';
    
    const startDate = new Date(createdAt);
    const now = new Date();
    const diffMs = now.getTime() - startDate.getTime();
    const years = Math.floor(diffMs / (365.25 * 24 * 60 * 60 * 1000));
    const months = Math.floor((diffMs % (365.25 * 24 * 60 * 60 * 1000)) / (30.44 * 24 * 60 * 60 * 1000));
    
    if (years > 0) {
      return `${format(startDate, 'MMM yyyy')} (${years}y ${months}mo)`;
    } else if (months > 0) {
      return `${format(startDate, 'MMM yyyy')} (${months} months)`;
    }
    return format(startDate, 'MMM d, yyyy') + ' (New)';
  };

  const updateUser = async () => {
    if (!user) return;
    try {
      const newTenantId = selectedTenantId || user.tenant_id;
      const oldTenantId = user.tenant_id;
      
      // Get company name for the new tenant
      let companyName = user.company_name;
      if (selectedTenantId && companies.length > 0) {
        const selectedCompany = companies.find(c => c.id === selectedTenantId);
        if (selectedCompany) {
          companyName = selectedCompany.name;
        }
      }
      
      // Update profiles table
      const { error } = await supabase
        .from('profiles')
        .update({
          first_name: user.first_name,
          last_name: user.last_name,
          personal_overhead_rate: user.personal_overhead_rate,
          phone: user.phone,
          email: user.email,
          company_email: user.company_email,
          company_name: companyName,
          tenant_id: newTenantId
        })
        .eq('id', userId);

      if (error) throw error;

      // If company changed, update user_company_access
      if (selectedTenantId && selectedTenantId !== oldTenantId) {
        // Upsert new company access
        const { error: accessError } = await supabase
          .from('user_company_access')
          .upsert({
            user_id: userId,
            tenant_id: selectedTenantId,
            is_active: true,
            access_level: 'full'
          }, { 
            onConflict: 'user_id,tenant_id'
          });
        
        if (accessError) {
          console.error('Error updating company access:', accessError);
        }
      }

      toast({
        title: "Profile Updated",
        description: "User profile has been updated successfully.",
      });
      setEditing(false);
      
      // Reload to reflect changes
      loadUserProfile();
    } catch (error) {
      console.error('Error updating user:', error);
      toast({
        title: "Error",
        description: "Failed to update user profile.",
        variant: "destructive",
      });
    }
  };

  const sendPasswordReset = async () => {
    if (!user?.email) return;
    
    try {
      setSendingReset(true);
      
      // Send password reset email using Supabase auth
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) throw error;

      toast({
        title: "Password Reset Email Sent",
        description: `A password reset link has been sent to ${user.email}`,
      });
    } catch (error) {
      console.error('Error sending password reset:', error);
      toast({
        title: "Error",
        description: "Failed to send password reset email.",
        variant: "destructive",
      });
    } finally {
      setSendingReset(false);
    }
  };

  const updatePasswordDirectly = async () => {
    if (!newPassword || newPassword !== confirmPassword) {
      toast({
        title: "Password Mismatch",
        description: "Passwords do not match or are empty.",
        variant: "destructive",
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        title: "Password Too Short",
        description: "Password must be at least 6 characters long.",
        variant: "destructive",
      });
      return;
    }

    try {
      setUpdatingPassword(true);
      
      // Use the admin function to update the user's password
      const { error } = await supabase.functions.invoke('admin-update-password', {
        body: {
          userId: user.id,
          newPassword: newPassword
        }
      });

      if (error) throw error;

      toast({
        title: "Password Updated",
        description: `Password has been updated successfully for ${user.first_name} ${user.last_name}`,
      });

      setShowPasswordForm(false);
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      console.error('Error updating password:', error);
      toast({
        title: "Error",
        description: "Failed to update password. Please try again.",
        variant: "destructive",
      });
    } finally {
      setUpdatingPassword(false);
    }
  };

  // Check if current user has permission to manually set passwords
  const canManuallySetPassword = () => {
    if (!currentUser) return false;
    
    // Allow for yourself
    if (currentUser.id === user?.id) return true;
    
    // Allow for Chris/Christopher O'Brien variations with manager+ roles to reset any password
    const isCurrentUserChrisVariant = (
      currentUser?.first_name?.toLowerCase().includes('chris') && 
      currentUser?.last_name?.toLowerCase().includes('brien')
    ) || (
      currentUser?.first_name?.toLowerCase().includes('christopher') && 
      currentUser?.last_name?.toLowerCase().includes('brien')
    );
    
    const isCurrentUserManagerOrAbove = ['sales_manager', 'regional_manager', 'office_admin', 'corporate', 'master'].includes(currentUser?.role);
    
    return isCurrentUserChrisVariant && isCurrentUserManagerOrAbove;
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid File Type",
        description: "Please select an image file (JPG, PNG, etc.)",
        variant: "destructive",
      });
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File Too Large",
        description: "Please select an image smaller than 5MB",
        variant: "destructive",
      });
      return;
    }

    try {
      setUploadingAvatar(true);

      // Create unique filename
      const fileExt = file.name.split('.').pop();
      const fileName = `${userId}-${Date.now()}.${fileExt}`;

      // Upload to Supabase storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      // Update user profile with avatar URL
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          avatar_url: urlData.publicUrl,
          photo_url: urlData.publicUrl
        })
        .eq('id', userId);

      if (updateError) throw updateError;

      // Update local state
      setUser({
        ...user,
        avatar_url: urlData.publicUrl,
        photo_url: urlData.publicUrl
      });

      toast({
        title: "Profile Picture Updated",
        description: "Your profile picture has been updated successfully.",
      });
    } catch (error) {
      console.error('Error uploading avatar:', error);
      toast({
        title: "Upload Failed",
        description: "Failed to upload profile picture. Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploadingAvatar(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading profile...</div>;
  }

  if (!user) {
    return <div className="text-center py-8">User not found</div>;
  }

  const totalCommissions = commissionHistory.reduce((sum, comm) => sum + (comm.commission_amount || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onClose} className="flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="flex items-center gap-2">
          {checkingPermissions ? (
            <Button disabled className="flex items-center gap-2">
              <Edit3 className="h-4 w-4" />
              Checking permissions...
            </Button>
          ) : editing ? (
            <>
              <Button onClick={updateUser} className="flex items-center gap-2">
                <Save className="h-4 w-4" />
                Save
              </Button>
              <Button variant="outline" onClick={() => setEditing(false)}>
                <X className="h-4 w-4" />
                Cancel
              </Button>
            </>
          ) : canEditProfile() ? (
            <Button onClick={() => setEditing(true)} className="flex items-center gap-2">
              <Edit3 className="h-4 w-4" />
              Edit Profile
            </Button>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button disabled className="flex items-center gap-2">
                      <Edit3 className="h-4 w-4" />
                      Edit Profile
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>You don't have permission to edit this profile</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>

      <Tabs defaultValue="profile" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="profile" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="commission" className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Commission
          </TabsTrigger>
          <TabsTrigger value="activity" className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Activity
          </TabsTrigger>
          <TabsTrigger value="security" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Security
          </TabsTrigger>
          <TabsTrigger value="avatar" className="flex items-center gap-2">
            <Camera className="h-4 w-4" />
            Avatar
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-4">
                <Avatar className="h-16 w-16">
                  <AvatarImage src={user.photo_url || user.avatar_url} />
                  <AvatarFallback>
                    {user.first_name?.[0]}{user.last_name?.[0]}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h2 className="text-2xl font-bold">
                    {user.first_name} {user.last_name}
                  </h2>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-base font-medium text-muted-foreground capitalize">
                      {user.role?.replace(/_/g, ' ')}
                    </span>
                    <span className="text-muted-foreground">•</span>
                    <Badge variant={user.is_active ? "default" : "secondary"}>
                      {user.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 text-sm text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>Member since {formatTenure(user.created_at)}</span>
                  </div>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="first_name">First Name</Label>
                    <Input
                      id="first_name"
                      value={user.first_name}
                      onChange={(e) => setUser({ ...user, first_name: e.target.value })}
                      disabled={!editing}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="last_name">Last Name</Label>
                    <Input
                      id="last_name"
                      value={user.last_name}
                      onChange={(e) => setUser({ ...user, last_name: e.target.value })}
                      disabled={!editing}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email" className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5" />
                      Personal Email
                    </Label>
                    <Input
                      id="email"
                      value={user.email || ""}
                      onChange={(e) => setUser({ ...user, email: e.target.value })}
                      disabled={!editing}
                      placeholder="Personal login email"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="company_email" className="flex items-center gap-1.5">
                      <Building className="h-3.5 w-3.5" />
                      Company Email
                    </Label>
                    <Input
                      id="company_email"
                      value={user.company_email || ""}
                      onChange={(e) => setUser({ ...user, company_email: e.target.value })}
                      disabled={!editing}
                      placeholder="Company/business email (optional)"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      value={user.phone || ""}
                      onChange={(e) => setUser({ ...user, phone: e.target.value })}
                      disabled={!editing}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="company">Company</Label>
                    <Select
                      value={selectedTenantId || user.tenant_id || ""}
                      onValueChange={(value) => {
                        setSelectedTenantId(value);
                        const company = companies.find(c => c.id === value);
                        if (company) {
                          setUser({ ...user, company_name: company.name, tenant_id: value });
                        }
                      }}
                      disabled={!editing}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select company..." />
                      </SelectTrigger>
                      <SelectContent className="bg-popover z-50">
                        {companies.map((company) => (
                          <SelectItem key={company.id} value={company.id}>
                            <div className="flex items-center gap-2">
                              <Building className="h-4 w-4 text-muted-foreground" />
                              <div className="flex flex-col">
                                <span className="font-medium">{company.name}</span>
                                {company.phone && (
                                  <span className="text-xs text-muted-foreground">{company.phone}</span>
                                )}
                              </div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {user.role === 'sales_manager' && (
                <>
                  <hr />
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <DollarSign className="h-5 w-5" />
                      Commission Performance
                    </h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Card>
                        <CardContent className="p-4">
                          <div className="flex items-center gap-2">
                            <Target className="h-4 w-4 text-primary" />
                            <div>
                              <p className="text-sm text-muted-foreground">Total Commissions</p>
                              <p className="text-lg font-bold">${totalCommissions.toLocaleString()}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                      
                      <Card>
                        <CardContent className="p-4">
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-info" />
                            <div>
                              <p className="text-sm text-muted-foreground">Recent Commissions</p>
                              <p className="text-lg font-bold">{commissionHistory.length}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="commission">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Commission Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <UserCommissionSettings 
                userId={userId} 
                user={user}
                canEdit={canEditProfile()}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <UserActivityTab userId={userId} />
        </TabsContent>

        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Password & Security Management
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Manual Password Override Section - Priority Access */}
              {canManuallySetPassword() && (
                <div className="p-6 border-2 border-orange-200 rounded-lg bg-gradient-to-r from-orange-50 to-yellow-50">
                  <div className="flex items-start justify-between mb-4">
                    <div className="space-y-2">
                      <h3 className="text-lg font-semibold text-orange-800 flex items-center gap-2">
                        <Key className="h-5 w-5" />
                        Manual Password Override
                      </h3>
                      <p className="text-sm text-orange-700">
                        Admin access to directly set new passwords. Available for Chris O'Brien accounts and self-management.
                      </p>
                    </div>
                  </div>
                  
                  <div className="grid gap-4">
                    <div className="space-y-3">
                      <Label htmlFor="manual-new-password" className="text-sm font-medium text-orange-800">
                        New Password (minimum 6 characters)
                      </Label>
                      <Input
                        id="manual-new-password"
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Enter new password"
                        className="border-orange-200 focus:border-orange-400"
                      />
                    </div>
                    
                    <div className="space-y-3">
                      <Label htmlFor="manual-confirm-password" className="text-sm font-medium text-orange-800">
                        Confirm New Password
                      </Label>
                      <Input
                        id="manual-confirm-password"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Confirm new password"
                        className="border-orange-200 focus:border-orange-400"
                      />
                    </div>
                    
                    {newPassword && newPassword !== confirmPassword && (
                      <p className="text-sm text-red-600">Passwords do not match</p>
                    )}
                    
                    <div className="flex gap-3">
                      <Button 
                        onClick={updatePasswordDirectly} 
                        disabled={updatingPassword || !newPassword || newPassword !== confirmPassword || newPassword.length < 6}
                        className="bg-orange-600 hover:bg-orange-700 text-white"
                      >
                        {updatingPassword ? "Updating Password..." : "Set New Password"}
                      </Button>
                      
                      <Button 
                        variant="outline" 
                        onClick={() => {
                          setNewPassword('');
                          setConfirmPassword('');
                        }}
                        className="border-orange-300 text-orange-700 hover:bg-orange-50"
                      >
                        Clear Fields
                      </Button>
                    </div>
                    
                    <div className="p-3 bg-orange-100 border border-orange-200 rounded-lg">
                      <p className="text-xs text-orange-800">
                        <strong>Security Note:</strong> This action immediately updates the user's password and invalidates all previous passwords and sessions. 
                        Ensure you communicate the new password securely to the user.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Standard Password Reset Section */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Standard Password Reset</h3>
                
                <div className="flex items-start justify-between p-4 border rounded-lg">
                  <div className="space-y-1">
                    <h4 className="font-medium">Email Reset Link</h4>
                    <p className="text-sm text-muted-foreground">
                      Send a secure password reset email to {user.email}. The user will receive a link to create a new password.
                    </p>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" className="flex items-center gap-2">
                        <Mail className="h-4 w-4" />
                        Send Reset Email
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Send Password Reset Email</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will send a password reset email to <strong>{user.email}</strong>. 
                          The user will receive a secure link that allows them to create a new password.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={sendPasswordReset} disabled={sendingReset}>
                          {sendingReset ? "Sending..." : "Send Reset Email"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>

                {/* Account Status Section */}
                <div className="flex items-start justify-between p-4 border rounded-lg">
                  <div className="space-y-1">
                    <h4 className="font-medium">Account Status</h4>
                    <p className="text-sm text-muted-foreground">
                      Current account status and role information.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant={user.is_active ? "default" : "secondary"}>
                      {user.is_active ? "Active" : "Inactive"}
                    </Badge>
                    <Badge variant="outline">{user.role}</Badge>
                    {user.is_developer && <Badge variant="destructive">Developer</Badge>}
                  </div>
                </div>

                {/* Security Information */}
                <div className="p-4 bg-muted/50 rounded-lg">
                  <h4 className="font-medium mb-2">Security Policies</h4>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• Password resets are valid for 24 hours</li>
                    <li>• Manual password updates invalidate all existing sessions</li>
                    <li>• Users must verify their email address for reset links</li>
                    <li>• Account access is controlled by role permissions</li>
                    <li>• All password changes are logged for security auditing</li>
                    <li>• Manual overrides are restricted to authorized administrators</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="avatar">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Camera className="h-5 w-5" />
                Profile Picture
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-start gap-6">
                <div className="flex flex-col items-center gap-4">
                  <Avatar className="h-32 w-32">
                    <AvatarImage src={user.photo_url || user.avatar_url} />
                    <AvatarFallback className="text-2xl">
                      {user.first_name?.[0]}{user.last_name?.[0]}
                    </AvatarFallback>
                  </Avatar>
                  
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingAvatar}
                      className="flex items-center gap-2"
                    >
                      {uploadingAvatar ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4" />
                          Upload New
                        </>
                      )}
                    </Button>
                  </div>
                  
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarUpload}
                    className="hidden"
                  />
                </div>

                <div className="flex-1 space-y-4">
                  <div>
                    <h4 className="font-medium mb-2">Upload Guidelines</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>• Recommended size: 400x400 pixels or larger</li>
                      <li>• Supported formats: JPG, PNG, GIF</li>
                      <li>• Maximum file size: 5MB</li>
                      <li>• Square images work best for profile pictures</li>
                    </ul>
                  </div>

                  <div className="p-4 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <FileImage className="h-4 w-4" />
                      <span className="text-sm font-medium">Current Image</span>
                    </div>
                    {user.photo_url || user.avatar_url ? (
                      <p className="text-xs text-muted-foreground break-all">
                        {user.photo_url || user.avatar_url}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">No profile picture uploaded</p>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
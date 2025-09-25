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
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
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
  FileImage
} from "lucide-react";

interface EnhancedUserProfileProps {
  userId: string;
  onClose: () => void;
}

export const EnhancedUserProfile: React.FC<EnhancedUserProfileProps> = ({ userId, onClose }) => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [commissionHistory, setCommissionHistory] = useState<any[]>([]);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadUserProfile();
  }, [userId]);

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

  const updateUser = async () => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          first_name: user.first_name,
          last_name: user.last_name,
          personal_overhead_rate: user.personal_overhead_rate,
          phone: user.phone,
          title: user.title
        })
        .eq('id', userId);

      if (error) throw error;

      toast({
        title: "Profile Updated",
        description: "User profile has been updated successfully.",
      });
      setEditing(false);
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
          {editing ? (
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
          ) : (
            <Button onClick={() => setEditing(true)} className="flex items-center gap-2">
              <Edit3 className="h-4 w-4" />
              Edit Profile
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="profile" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="profile" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            Profile
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
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant={user.is_active ? "default" : "secondary"}>
                      {user.is_active ? "Active" : "Inactive"}
                    </Badge>
                    <Badge variant="outline">{user.role}</Badge>
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
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      value={user.email}
                      disabled
                      className="bg-muted"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="title">Title</Label>
                    <Input
                      id="title"
                      value={user.title || ""}
                      onChange={(e) => setUser({ ...user, title: e.target.value })}
                      disabled={!editing}
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
                    <Input
                      id="company"
                      value={user.company_name || ""}
                      disabled
                      className="bg-muted"
                    />
                  </div>

                  {user.role === 'rep' && (
                    <div className="space-y-2">
                      <Label htmlFor="overhead_rate">Personal Overhead Rate (%)</Label>
                      <Input
                        id="overhead_rate"
                        type="number"
                        step="0.1"
                        value={user.personal_overhead_rate || 0}
                        onChange={(e) => setUser({ ...user, personal_overhead_rate: parseFloat(e.target.value) || 0 })}
                        disabled={!editing}
                      />
                      <p className="text-xs text-muted-foreground">
                        Applied to commission calculations
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {user.role === 'rep' && (
                <>
                  <hr />
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <DollarSign className="h-5 w-5" />
                      Commission Performance
                    </h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                            <TrendingUp className="h-4 w-4 text-success" />
                            <div>
                              <p className="text-sm text-muted-foreground">Overhead Rate</p>
                              <p className="text-lg font-bold">{user.personal_overhead_rate || 0}%</p>
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

        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Password & Security
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-start justify-between p-4 border rounded-lg">
                  <div className="space-y-1">
                    <h4 className="font-medium">Password Reset</h4>
                    <p className="text-sm text-muted-foreground">
                      Send a password reset email to {user.email}. The user will receive a secure link to create a new password.
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

                <div className="p-4 bg-muted/50 rounded-lg">
                  <h4 className="font-medium mb-2">Security Information</h4>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• Password resets are valid for 24 hours</li>
                    <li>• Users must verify their email address</li>
                    <li>• Account access is controlled by role permissions</li>
                    <li>• All password changes are logged for security</li>
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
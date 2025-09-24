import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
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
  Target
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
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={user.phone}
                  onChange={(e) => setUser({ ...user, phone: e.target.value })}
                  disabled={!editing}
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
                          <p className="text-sm text-muted-foreground">Active Projects</p>
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
    </div>
  );
};
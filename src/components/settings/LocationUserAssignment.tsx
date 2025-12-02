import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { User, Save, Loader2 } from "lucide-react";

interface LocationUserAssignmentProps {
  locationId: string;
  tenantId: string;
  onClose: () => void;
}

interface UserProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  title: string | null;
}

export const LocationUserAssignment = ({ locationId, tenantId, onClose }: LocationUserAssignmentProps) => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, [locationId, tenantId]);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Load all users for the tenant
      const { data: usersData, error: usersError } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, email, role, title')
        .eq('tenant_id', tenantId)
        .order('last_name');

      if (usersError) throw usersError;
      setUsers(usersData || []);

      // Load current assignments for this location
      const { data: assignmentsData, error: assignmentsError } = await supabase
        .from('user_location_assignments')
        .select('user_id')
        .eq('location_id', locationId);

      if (assignmentsError) throw assignmentsError;
      setAssignedUserIds((assignmentsData || []).map(a => a.user_id));
    } catch (error: any) {
      console.error('Error loading data:', error);
      toast({
        title: "Error loading users",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleUser = (userId: string) => {
    setAssignedUserIds(prev => 
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const handleSave = async () => {
    try {
      setSaving(true);

      // Delete all existing assignments for this location
      const { error: deleteError } = await supabase
        .from('user_location_assignments')
        .delete()
        .eq('location_id', locationId);

      if (deleteError) throw deleteError;

      // Insert new assignments
      if (assignedUserIds.length > 0) {
        const { error: insertError } = await supabase
          .from('user_location_assignments')
          .insert(
            assignedUserIds.map(userId => ({
              user_id: userId,
              location_id: locationId,
              tenant_id: tenantId
            }))
          );

        if (insertError) throw insertError;
      }

      toast({
        title: "Assignments saved",
        description: `${assignedUserIds.length} user(s) assigned to this location`
      });

      onClose();
    } catch (error: any) {
      console.error('Error saving assignments:', error);
      toast({
        title: "Error saving assignments",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Select users to assign to this location. Assigned users will have access to leads and jobs at this location.
      </p>

      <div className="max-h-[400px] overflow-y-auto space-y-2">
        {users.length === 0 ? (
          <p className="text-center py-4 text-muted-foreground">No users found for this company</p>
        ) : (
          users.map(user => (
            <div 
              key={user.id}
              className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                assignedUserIds.includes(user.id) ? 'bg-primary/5 border-primary/20' : 'hover:bg-muted/50'
              }`}
            >
              <div className="flex items-center gap-3">
                <Checkbox
                  id={`user-${user.id}`}
                  checked={assignedUserIds.includes(user.id)}
                  onCheckedChange={() => toggleUser(user.id)}
                />
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <Label htmlFor={`user-${user.id}`} className="font-medium cursor-pointer">
                      {user.first_name} {user.last_name}
                    </Label>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">{user.role}</Badge>
                {user.title && (
                  <span className="text-xs text-muted-foreground">{user.title}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between pt-4 border-t">
        <p className="text-sm text-muted-foreground">
          {assignedUserIds.length} user(s) selected
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Save Assignments
          </Button>
        </div>
      </div>
    </div>
  );
};

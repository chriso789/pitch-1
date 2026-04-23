import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { MapPin, Users, Settings, Building2 } from "lucide-react";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";

interface User {
  id: string;
  first_name?: string;
  last_name?: string;
  email: string;
  role: string;
  locations?: string[];
}

interface Location {
  id: string;
  name: string;
  address_city?: string;
  address_state?: string;
}

interface UserLocationAssignmentsProps {
  selectedUserId?: string;
}

export const UserLocationAssignments = ({ selectedUserId }: UserLocationAssignmentsProps) => {
  const [users, setUsers] = useState<User[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [userLocations, setUserLocations] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [tempAssignments, setTempAssignments] = useState<string[]>([]);
  const effectiveTenantId = useEffectiveTenantId();

  useEffect(() => {
    if (effectiveTenantId) fetchData();
  }, [effectiveTenantId]);

  const fetchData = async () => {
    if (!effectiveTenantId) return;
    try {
      setLoading(true);

      // Get user IDs that have access to the active tenant (home tenant or via user_company_access)
      const [homeProfilesRes, accessRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, first_name, last_name, email, role')
          .eq('tenant_id', effectiveTenantId)
          .neq('role', 'master'),
        supabase
          .from('user_company_access')
          .select('user_id')
          .eq('tenant_id', effectiveTenantId)
          .eq('is_active', true),
      ]);

      if (homeProfilesRes.error) throw homeProfilesRes.error;
      if (accessRes.error) throw accessRes.error;

      const homeProfiles = homeProfilesRes.data || [];
      const homeIds = new Set(homeProfiles.map(p => p.id));
      const extraIds = (accessRes.data || [])
        .map((r: any) => r.user_id)
        .filter((id: string) => !homeIds.has(id));

      let extraProfiles: any[] = [];
      if (extraIds.length > 0) {
        const { data: extras, error: extrasErr } = await supabase
          .from('profiles')
          .select('id, first_name, last_name, email, role')
          .in('id', extraIds)
          .neq('role', 'master');
        if (extrasErr) throw extrasErr;
        extraProfiles = extras || [];
      }

      const usersData = [...homeProfiles, ...extraProfiles].sort((a, b) =>
        (a.first_name || '').localeCompare(b.first_name || '')
      );

      const usersError = null;
      if (usersError) throw usersError;

      // Fetch locations (active tenant only)
      const { data: locationsData, error: locationsError } = await supabase
        .from('locations')
        .select('id, name, address_city, address_state')
        .eq('is_active', true)
        .eq('tenant_id', effectiveTenantId)
        .order('name');

      if (locationsError) throw locationsError;

      // Fetch user-location assignments (active tenant only)
      const { data: assignmentsData, error: assignmentsError } = await supabase
        .from('user_location_assignments')
        .select('user_id, location_id')
        .eq('is_active', true)
        .eq('tenant_id', effectiveTenantId);

      if (assignmentsError) throw assignmentsError;

      // Group assignments by user
      const userLocationMap: Record<string, string[]> = {};
      assignmentsData?.forEach(assignment => {
        if (!userLocationMap[assignment.user_id]) {
          userLocationMap[assignment.user_id] = [];
        }
        userLocationMap[assignment.user_id].push(assignment.location_id);
      });

      setUsers(usersData || []);
      setLocations(locationsData || []);
      setUserLocations(userLocationMap);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast({
        title: "Error",
        description: "Failed to load user location assignments",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEditAssignments = (user: User) => {
    setSelectedUser(user);
    setTempAssignments(userLocations[user.id] || []);
    setDialogOpen(true);
  };

  const handleLocationToggle = (locationId: string, checked: boolean) => {
    if (checked) {
      setTempAssignments(prev => [...prev, locationId]);
    } else {
      setTempAssignments(prev => prev.filter(id => id !== locationId));
    }
  };

  const handleSaveAssignments = async () => {
    if (!selectedUser) return;

    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) throw new Error('Not authenticated');
      if (!effectiveTenantId) throw new Error('No active tenant');

      // First, deactivate all existing assignments for this user in this tenant
      const { error: deactivateError } = await supabase
        .from('user_location_assignments')
        .update({ is_active: false })
        .eq('user_id', selectedUser.id)
        .eq('tenant_id', effectiveTenantId);

      if (deactivateError) throw deactivateError;

      // Then, create new assignments
      if (tempAssignments.length > 0) {
        const assignments = tempAssignments.map(locationId => ({
          tenant_id: effectiveTenantId,
          user_id: selectedUser.id,
          location_id: locationId,
          assigned_by: currentUser.id,
          is_active: true
        }));

        const { error: insertError } = await supabase
          .from('user_location_assignments')
          .insert(assignments);

        if (insertError) throw insertError;
      }

      toast({
        title: "Success",
        description: "Location assignments updated successfully",
      });

      setDialogOpen(false);
      setSelectedUser(null);
      fetchData();
    } catch (error) {
      console.error('Error saving assignments:', error);
      toast({
        title: "Error",
        description: "Failed to update location assignments",
        variant: "destructive",
      });
    }
  };

  const getUserLocationNames = (userId: string): string[] => {
    const locationIds = userLocations[userId] || [];
    return locationIds.map(id => {
      const location = locations.find(l => l.id === id);
      return location?.name || 'Unknown Location';
    });
  };

  if (loading) {
    return <div className="p-6">Loading user location assignments...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          User Location Assignments
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {locations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">No locations available</p>
              <p className="text-sm">Create locations first to assign users to them</p>
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">No users found</p>
            </div>
          ) : (
            users.map((user) => (
              <Card key={user.id} className="border">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold">
                          {user.first_name && user.last_name 
                            ? `${user.first_name} ${user.last_name}` 
                            : user.email}
                        </h3>
                        <Badge variant="outline">{user.role}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">{user.email}</p>
                      <div className="flex items-center gap-1 flex-wrap">
                        {getUserLocationNames(user.id).length > 0 ? (
                          getUserLocationNames(user.id).map((locationName, index) => (
                            <Badge key={index} variant="secondary" className="text-xs">
                              <MapPin className="h-3 w-3 mr-1" />
                              {locationName}
                            </Badge>
                          ))
                        ) : (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            No locations assigned
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEditAssignments(user)}
                      className="flex items-center gap-1"
                    >
                      <Settings className="h-4 w-4" />
                      Manage
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Manage Location Access - {selectedUser?.first_name && selectedUser?.last_name 
                  ? `${selectedUser.first_name} ${selectedUser.last_name}` 
                  : selectedUser?.email}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Select which locations this user can access. Users can only see data from their assigned locations.
              </p>
              {locations.map((location) => (
                <div key={location.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={location.id}
                    checked={tempAssignments.includes(location.id)}
                    onCheckedChange={(checked) => handleLocationToggle(location.id, !!checked)}
                  />
                  <label htmlFor={location.id} className="flex-1 cursor-pointer">
                    <div className="font-medium">{location.name}</div>
                    {(location.address_city || location.address_state) && (
                      <div className="text-xs text-muted-foreground">
                        {[location.address_city, location.address_state].filter(Boolean).join(', ')}
                      </div>
                    )}
                  </label>
                </div>
              ))}
              <div className="flex justify-end gap-2 pt-4">
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setDialogOpen(false);
                    setSelectedUser(null);
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={handleSaveAssignments}>
                  Save Changes
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
};
import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { MapPin, Users, UserPlus, X, Building2, Calendar, Shield } from "lucide-react";
import { useCompanySwitcher } from "@/hooks/useCompanySwitcher";
import { format } from "date-fns";

interface Location {
  id: string;
  name: string;
  address_city?: string;
  address_state?: string;
  created_at: string;
}

interface User {
  id: string;
  first_name?: string;
  last_name?: string;
  email: string;
  role: string;
}

interface Assignment {
  id: string;
  user_id: string;
  location_id: string;
  assigned_by: string;
  created_at: string;
  user?: User;
  assigner?: User;
}

export const LocationUserDetails = () => {
  const [locations, setLocations] = useState<Location[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const { activeCompanyId } = useCompanySwitcher();

  useEffect(() => {
    if (activeCompanyId) {
      fetchData();
    }
  }, [activeCompanyId]);

  const fetchData = async () => {
    try {
      setLoading(true);

      // Fetch locations
      const { data: locationsData, error: locationsError } = await supabase
        .from('locations')
        .select('id, name, address_city, address_state, created_at')
        .eq('tenant_id', activeCompanyId)
        .eq('is_active', true)
        .order('name');

      if (locationsError) throw locationsError;

      // Fetch users for this tenant
      const { data: usersData, error: usersError } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, email, role')
        .eq('tenant_id', activeCompanyId)
        .eq('is_active', true)
        .order('first_name');

      if (usersError) throw usersError;

      // Fetch assignments
      const { data: assignmentsData, error: assignmentsError } = await supabase
        .from('user_location_assignments')
        .select('id, user_id, location_id, assigned_by, assigned_at')
        .eq('tenant_id', activeCompanyId)
        .eq('is_active', true);

      if (assignmentsError) throw assignmentsError;

      // Map assigned_at to created_at for consistency
      const mappedAssignments = (assignmentsData || []).map(a => ({
        ...a,
        created_at: a.assigned_at || new Date().toISOString()
      }));

      setLocations(locationsData || []);
      setUsers(usersData || []);
      setAssignments(mappedAssignments);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast({
        title: "Error",
        description: "Failed to load location assignments",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getLocationAssignments = (locationId: string) => {
    return assignments.filter(a => a.location_id === locationId);
  };

  const getUserById = (userId: string) => {
    return users.find(u => u.id === userId);
  };

  const getUserLocationCount = (userId: string) => {
    return assignments.filter(a => a.user_id === userId).length;
  };

  const openAssignDialog = (location: Location) => {
    setSelectedLocation(location);
    const currentAssignments = getLocationAssignments(location.id);
    setSelectedUsers(currentAssignments.map(a => a.user_id));
    setDialogOpen(true);
  };

  const handleUserToggle = (userId: string) => {
    setSelectedUsers(prev => 
      prev.includes(userId) 
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const handleSaveAssignments = async () => {
    if (!selectedLocation) return;

    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) throw new Error('Not authenticated');

      // Deactivate all existing assignments for this location
      const { error: deactivateError } = await supabase
        .from('user_location_assignments')
        .update({ is_active: false })
        .eq('location_id', selectedLocation.id);

      if (deactivateError) throw deactivateError;

      // Create new assignments
      if (selectedUsers.length > 0) {
        const newAssignments = selectedUsers.map(userId => ({
          tenant_id: activeCompanyId,
          user_id: userId,
          location_id: selectedLocation.id,
          assigned_by: currentUser.id,
          is_active: true
        }));

        const { error: insertError } = await supabase
          .from('user_location_assignments')
          .insert(newAssignments);

        if (insertError) throw insertError;
      }

      toast({
        title: "Success",
        description: "Location assignments updated",
      });

      setDialogOpen(false);
      setSelectedLocation(null);
      fetchData();
    } catch (error) {
      console.error('Error saving assignments:', error);
      toast({
        title: "Error",
        description: "Failed to update assignments",
        variant: "destructive",
      });
    }
  };

  const handleRemoveUser = async (assignmentId: string) => {
    try {
      const { error } = await supabase
        .from('user_location_assignments')
        .update({ is_active: false })
        .eq('id', assignmentId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "User removed from location",
      });
      fetchData();
    } catch (error) {
      console.error('Error removing user:', error);
      toast({
        title: "Error",
        description: "Failed to remove user",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">Loading location assignments...</div>
        </CardContent>
      </Card>
    );
  }

  if (locations.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            User-Location Assignments
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium mb-2">No locations configured</p>
            <p className="text-sm">Create locations first to manage user assignments</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          User-Location Assignments
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {locations.map((location) => {
          const locationAssignments = getLocationAssignments(location.id);
          
          return (
            <div key={location.id} className="border rounded-lg overflow-hidden">
              {/* Location Header */}
              <div className="bg-muted/50 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <MapPin className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{location.name}</h3>
                    {(location.address_city || location.address_state) && (
                      <p className="text-sm text-muted-foreground">
                        {[location.address_city, location.address_state].filter(Boolean).join(', ')}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">
                    {locationAssignments.length} user{locationAssignments.length !== 1 ? 's' : ''}
                  </Badge>
                  <Button 
                    size="sm" 
                    onClick={() => openAssignDialog(location)}
                    className="gap-1"
                  >
                    <UserPlus className="h-4 w-4" />
                    Assign Users
                  </Button>
                </div>
              </div>

              {/* Assignments Table */}
              {locationAssignments.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead>User</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Assigned</TableHead>
                      <TableHead>Assigned By</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {locationAssignments.map((assignment) => {
                      const user = getUserById(assignment.user_id);
                      const assigner = getUserById(assignment.assigned_by);
                      const isMultiLocation = getUserLocationCount(assignment.user_id) > 1;

                      if (!user) return null;

                      return (
                        <TableRow key={assignment.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">
                                {user.first_name} {user.last_name}
                              </span>
                              {isMultiLocation && (
                                <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                                  Multi-Location
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">{user.email}</p>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="capitalize">
                              <Shield className="h-3 w-3 mr-1" />
                              {user.role?.replace('_', ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              {format(new Date(assignment.created_at), 'MMM d, yyyy')}
                            </div>
                          </TableCell>
                          <TableCell>
                            {assigner ? (
                              <span className="text-sm text-muted-foreground">
                                {assigner.first_name} {assigner.last_name}
                              </span>
                            ) : (
                              <span className="text-sm text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveUser(assignment.id)}
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="px-4 py-6 text-center text-muted-foreground text-sm">
                  No users assigned to this location
                </div>
              )}
            </div>
          );
        })}

        {/* Assign Users Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary" />
                Assign Users to {selectedLocation?.name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Select users who should have access to this location. Users can be assigned to multiple locations.
              </p>
              <div className="space-y-2 max-h-80 overflow-y-auto border rounded-md p-3">
                {users.map((user) => (
                  <div 
                    key={user.id} 
                    className="flex items-center space-x-3 p-2 rounded hover:bg-muted/50 cursor-pointer"
                    onClick={() => handleUserToggle(user.id)}
                  >
                    <Checkbox
                      id={`user-${user.id}`}
                      checked={selectedUsers.includes(user.id)}
                      onCheckedChange={() => handleUserToggle(user.id)}
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {user.first_name} {user.last_name}
                        </span>
                        <Badge variant="outline" className="text-xs capitalize">
                          {user.role?.replace('_', ' ')}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                    </div>
                  </div>
                ))}
                {users.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No users available to assign
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSaveAssignments}>
                  Save Assignments
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
};

export default LocationUserDetails;

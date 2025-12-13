import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { MapPin, Plus, Edit, Trash2, Building2, CheckCircle } from "lucide-react";
import { useCompanySwitcher } from "@/hooks/useCompanySwitcher";
import AddressVerification from "@/shared/components/forms/AddressVerification";

interface LocationManagementProps {
  tenantId?: string;
}

interface Location {
  id: string;
  name: string;
  address_street?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  phone?: string;
  email?: string;
  manager_id?: string;
  is_active: boolean;
  created_at: string;
  latitude?: number;
  longitude?: number;
  place_id?: string;
  formatted_address?: string;
  verified_address?: any;
  address_verified_at?: string;
}

interface FormData {
  name: string;
  address_street: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  phone: string;
  email: string;
  latitude: number | null;
  longitude: number | null;
  place_id: string;
  formatted_address: string;
  verified_address: any;
  address_verified_at: string | null;
}

const initialFormData: FormData = {
  name: '',
  address_street: '',
  address_city: '',
  address_state: '',
  address_zip: '',
  phone: '',
  email: '',
  latitude: null,
  longitude: null,
  place_id: '',
  formatted_address: '',
  verified_address: null,
  address_verified_at: null
};

export const LocationManagement = ({ tenantId }: LocationManagementProps = {}) => {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const { activeCompanyId } = useCompanySwitcher();

  useEffect(() => {
    fetchLocations();
  }, [tenantId, activeCompanyId]);

  const fetchLocations = async () => {
    try {
      setLoading(true);
      const effectiveTenantId = tenantId || activeCompanyId;
      
      if (!effectiveTenantId) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .eq('tenant_id', effectiveTenantId)
        .order('name');

      if (error) throw error;
      setLocations(data || []);
    } catch (error) {
      console.error('Error fetching locations:', error);
      toast({
        title: "Error",
        description: "Failed to load locations",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddressVerified = (addressData: any, verificationData: any) => {
    setFormData(prev => ({
      ...prev,
      address_street: addressData.street || '',
      address_city: addressData.city || '',
      address_state: addressData.state || '',
      address_zip: addressData.zip || '',
      latitude: addressData.lat || null,
      longitude: addressData.lng || null,
      place_id: addressData.place_id || '',
      formatted_address: addressData.formatted_address || '',
      verified_address: verificationData,
      address_verified_at: new Date().toISOString()
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile) throw new Error('Profile not found');

      const locationData = {
        name: formData.name,
        address_street: formData.address_street,
        address_city: formData.address_city,
        address_state: formData.address_state,
        address_zip: formData.address_zip,
        phone: formData.phone,
        email: formData.email,
        latitude: formData.latitude,
        longitude: formData.longitude,
        place_id: formData.place_id,
        formatted_address: formData.formatted_address,
        verified_address: formData.verified_address,
        address_verified_at: formData.address_verified_at
      };

      if (editingLocation) {
        const { error } = await supabase
          .from('locations')
          .update(locationData)
          .eq('id', editingLocation.id);

        if (error) throw error;
        toast({
          title: "Success",
          description: "Location updated successfully",
        });
      } else {
        const { error } = await supabase
          .from('locations')
          .insert({
            ...locationData,
            tenant_id: profile.tenant_id,
            created_by: user.id
          });

        if (error) throw error;
        toast({
          title: "Success",
          description: "Location created successfully",
        });
      }

      setDialogOpen(false);
      setEditingLocation(null);
      setFormData(initialFormData);
      fetchLocations();
    } catch (error) {
      console.error('Error saving location:', error);
      toast({
        title: "Error",
        description: "Failed to save location",
        variant: "destructive",
      });
    }
  };

  const handleEdit = (location: Location) => {
    setEditingLocation(location);
    setFormData({
      name: location.name,
      address_street: location.address_street || '',
      address_city: location.address_city || '',
      address_state: location.address_state || '',
      address_zip: location.address_zip || '',
      phone: location.phone || '',
      email: location.email || '',
      latitude: location.latitude || null,
      longitude: location.longitude || null,
      place_id: location.place_id || '',
      formatted_address: location.formatted_address || '',
      verified_address: location.verified_address || null,
      address_verified_at: location.address_verified_at || null
    });
    setDialogOpen(true);
  };

  const handleDelete = async (locationId: string) => {
    if (!confirm('Are you sure you want to delete this location?')) return;

    try {
      const { error } = await supabase
        .from('locations')
        .update({ is_active: false })
        .eq('id', locationId);

      if (error) throw error;
      
      toast({
        title: "Success",
        description: "Location deactivated successfully",
      });
      fetchLocations();
    } catch (error) {
      console.error('Error deleting location:', error);
      toast({
        title: "Error",
        description: "Failed to delete location",
        variant: "destructive",
      });
    }
  };

  const resetForm = () => {
    setDialogOpen(false);
    setEditingLocation(null);
    setFormData(initialFormData);
  };

  if (loading) {
    return <div className="p-6">Loading locations...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Location Management
          </CardTitle>
          <Dialog open={dialogOpen} onOpenChange={(open) => {
            if (!open) resetForm();
            else setDialogOpen(true);
          }}>
            <DialogTrigger asChild>
              <Button className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add Location
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  {editingLocation ? 'Edit Location' : 'Add New Location'}
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="name">Location Name *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    placeholder="Main Office, Branch A, etc."
                  />
                </div>

                {/* Google-Verified Address */}
                <AddressVerification
                  label="Location Address"
                  onAddressVerified={handleAddressVerified}
                  initialAddress={{
                    street: formData.address_street,
                    city: formData.address_city,
                    state: formData.address_state,
                    zip: formData.address_zip,
                    lat: formData.latitude || undefined,
                    lng: formData.longitude || undefined,
                    place_id: formData.place_id || undefined,
                    formatted_address: formData.formatted_address || undefined
                  }}
                />

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="(555) 123-4567"
                    />
                  </div>
                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="location@company.com"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={resetForm}>
                    Cancel
                  </Button>
                  <Button type="submit">
                    {editingLocation ? 'Update' : 'Create'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {locations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">No locations configured</p>
              <p className="text-sm">Add your first location to enable multi-location features</p>
            </div>
          ) : (
            locations.map((location) => (
              <Card key={location.id} className="border">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold">{location.name}</h3>
                        <Badge variant={location.is_active ? "default" : "secondary"}>
                          {location.is_active ? "Active" : "Inactive"}
                        </Badge>
                        {location.address_verified_at && (
                          <Badge variant="outline" className="text-green-600 border-green-600">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Verified
                          </Badge>
                        )}
                      </div>
                      {(location.formatted_address || location.address_street || location.address_city) && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                          <MapPin className="h-4 w-4" />
                          <span>
                            {location.formatted_address || 
                              [location.address_street, location.address_city, location.address_state]
                                .filter(Boolean)
                                .join(', ') + (location.address_zip ? ` ${location.address_zip}` : '')
                            }
                          </span>
                        </div>
                      )}
                      {location.created_at && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                          <span>📅 Created: {new Date(location.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                        </div>
                      )}
                      {location.latitude && location.longitude && (
                        <p className="text-xs text-muted-foreground mb-1">
                          📍 {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                        </p>
                      )}
                      {location.phone && (
                        <p className="text-sm text-muted-foreground">📞 {location.phone}</p>
                      )}
                      {location.email && (
                        <p className="text-sm text-muted-foreground">✉️ {location.email}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEdit(location)}
                        className="flex items-center gap-1"
                      >
                        <Edit className="h-4 w-4" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDelete(location.id)}
                        className="flex items-center gap-1 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
};

import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, MapPin, Check, AlertCircle, Loader2, Users, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { useFormNavigationGuard } from "@/hooks/useFormNavigationGuard";
import { useLocation } from "@/contexts/LocationContext";

interface LeadCreationDialogProps {
  trigger?: React.ReactNode;
  contact?: any;
  onLeadCreated?: (lead: any) => void;
}

interface AddressSuggestion {
  place_id: string;
  formatted_address: string;
  geometry: {
    location: {
      lat: number;
      lng: number;
    };
  };
  address_components: any[];
}

interface SalesRep {
  id: string;
  first_name: string;
  last_name: string;
  role?: string;
}

export const LeadCreationDialog: React.FC<LeadCreationDialogProps> = ({
  trigger,
  contact,
  onLeadCreated,
}) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [addressLoading, setAddressLoading] = useState(false);
  const [salesReps, setSalesReps] = useState<SalesRep[]>([]);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    roofAge: "",
    status: "lead",
    roofType: "",
    priority: "medium",
    estimatedValue: "",
    address: "",
    useSameInfo: false,
    assignedTo: [] as string[],
    notes: "",
  });
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<AddressSuggestion | null>(null);
  const [showAddressPicker, setShowAddressPicker] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { currentLocationId } = useLocation();

  // Initialize form navigation guard
  const {
    hasUnsavedChanges,
    isSubmitting,
    initializeForm,
    checkForChanges,
    markAsSaved,
    markAsSubmitting,
    resetForm
  } = useFormNavigationGuard({
    message: "You have unsaved changes in the lead form. Are you sure you want to close it?",
    onUnsavedChangesAttempt: () => {
      toast({
        title: "Unsaved Changes",
        description: "Please save your lead or cancel to discard changes.",
        variant: "default"
      });
    }
  });

  const pipelineStatuses = [
    { value: "lead", label: "Lead" },
    { value: "legal", label: "Legal Review" },
    { value: "contingency_signed", label: "Contingency Signed" },
    { value: "project", label: "Project" },
  ];

  const roofTypes = [
    { value: "shingle", label: "Asphalt Shingle" },
    { value: "metal", label: "Metal" },
    { value: "tile", label: "Tile" },
    { value: "flat", label: "Flat/Membrane" },
    { value: "slate", label: "Slate" },
    { value: "cedar", label: "Cedar/Wood Shake" },
    { value: "other", label: "Other" },
  ];

  useEffect(() => {
    if (open) {
      loadSalesReps();
      loadUserProfile();
      
      // Initialize form tracking when dialog opens
      let initialFormData = {
        name: "",
        phone: "",
        roofAge: "",
        status: "lead",
        roofType: "",
        priority: "medium",
        estimatedValue: "",
        address: "",
        useSameInfo: false,
        assignedTo: [] as string[],
        notes: "",
      };
      
      // If contact is provided, pre-fill the form
      if (contact) {
        const fullAddress = [
          contact.address_street,
          contact.address_city,
          contact.address_state,
          contact.address_zip
        ].filter(Boolean).join(", ");
        
        initialFormData = {
          ...initialFormData,
          name: `${contact.first_name || ''} ${contact.last_name || ''}`.trim(),
          phone: contact.phone || "",
          address: fullAddress,
          useSameInfo: true,
          assignedTo: contact.assigned_to ? [contact.assigned_to] : []
        };
        
        // Trigger address verification if address exists
        if (fullAddress) {
          setTimeout(() => handleAddressVerification(fullAddress), 100);
        }
      }
      
      setFormData(initialFormData);
      initializeForm(initialFormData);
    }
  }, [open, initializeForm, contact]);

  // Check for changes when form data updates
  useEffect(() => {
    if (open) {
      checkForChanges(formData);
    }
  }, [formData, checkForChanges, open]);

  useEffect(() => {
    if (contact && formData.useSameInfo) {
      const fullAddress = [
        contact.address_street,
        contact.address_city,
        contact.address_state,
        contact.address_zip
      ].filter(Boolean).join(", ");
      
      setFormData(prev => ({ 
        ...prev, 
        name: `${contact.first_name} ${contact.last_name}`,
        phone: contact.phone || "",
        address: fullAddress 
      }));
      
      if (fullAddress) {
        handleAddressVerification(fullAddress);
      }
    }
  }, [formData.useSameInfo, contact]);

  const loadSalesReps = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id, active_tenant_id')
        .eq('id', user.id)
        .maybeSingle();

      // CRITICAL: Use active_tenant_id (switched company) or fall back to tenant_id (home company)
      const effectiveTenantId = profile?.active_tenant_id || profile?.tenant_id;
      if (!effectiveTenantId) return;

      // Use current location from location switcher first, then fall back to contact's location
      const locationId = currentLocationId || contact?.location_id;
      
      // If we have a location, filter reps by location assignments
      let repIds: string[] = [];
      if (locationId) {
        const { data: locationAssignments } = await supabase
          .from('user_location_assignments')
          .select('user_id')
          .eq('location_id', locationId)
          .eq('is_active', true);
        
        repIds = (locationAssignments || []).map(a => a.user_id);
        console.log('[LeadCreationDialog] Location-based reps:', repIds.length, 'for location:', locationId);
      }

      // Build query for profiles - exclude 'master' role from initial query
      let query = supabase
        .from('profiles')
        .select('id, first_name, last_name, role, tenant_id')
        .eq('tenant_id', effectiveTenantId)
        .in('role', ['sales_manager', 'regional_manager', 'corporate', 'owner', 'project_manager', 'office_admin'])
        .eq('is_active', true)
        .order('first_name');

      // If we have location-based rep IDs, filter by them
      if (locationId && repIds.length > 0) {
        query = query.in('id', repIds);
      }

      const { data: profiles, error } = await query;

      if (error) throw error;
      
      // Completely exclude master role from assignments
      const filteredProfiles = (profiles || []).filter(rep => rep.role !== 'master');
      
      setSalesReps(filteredProfiles);
    } catch (error) {
      console.error('Error loading sales reps:', error);
    }
  };

  const loadUserProfile = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

      setUserProfile(profile);
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  };

  const handleAddressVerification = async (address: string) => {
    if (!address.trim()) return;
    
    setAddressLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('google-maps-proxy', {
        body: {
          endpoint: 'autocomplete',
          params: {
            input: address,
            types: 'address'
          }
        }
      });

      if (error) throw error;

      if (data?.predictions) {
        const detailedSuggestions = await Promise.all(
          data.predictions.slice(0, 5).map(async (prediction: any) => {
            const { data: details } = await supabase.functions.invoke('google-maps-proxy', {
              body: {
                endpoint: 'details',
                params: {
                  place_id: prediction.place_id,
                  fields: 'formatted_address,geometry,address_components'
                }
              }
            });
            return details?.result;
          })
        );

        const validSuggestions = detailedSuggestions.filter(Boolean);
        setAddressSuggestions(validSuggestions);
        setShowAddressPicker(true);
        
        // Auto-select first suggestion when pre-filling from a contact
        if (validSuggestions.length > 0 && contact) {
          setSelectedAddress(validSuggestions[0]);
        }
      }
    } catch (error) {
      console.error('Address verification error:', error);
      toast({
        title: "Address Verification Error",
        description: "Unable to verify address. Please check and try again.",
        variant: "destructive",
      });
    } finally {
      setAddressLoading(false);
    }
  };

  const handleAddressSelect = (suggestion: AddressSuggestion) => {
    setSelectedAddress(suggestion);
    setFormData(prev => ({ ...prev, address: suggestion.formatted_address }));
    setShowAddressPicker(false);
  };

  const handleAddRep = (repId: string) => {
    if (formData.assignedTo.length < 2 && !formData.assignedTo.includes(repId)) {
      setFormData(prev => ({
        ...prev,
        assignedTo: [...prev.assignedTo, repId]
      }));
    }
  };

  const handleRemoveRep = (repId: string) => {
    setFormData(prev => ({
      ...prev,
      assignedTo: prev.assignedTo.filter(id => id !== repId)
    }));
  };

  // Enhanced validation with illumination logic - must match validateForm requirements
  const isFormValid = React.useMemo(() => {
    const roofAgeNum = parseInt(formData.roofAge);
    
    // Debug each validation condition individually
    const checks = {
      name: formData.name.trim() !== "",
      phone: formData.phone.trim() !== "",
      selectedAddress: selectedAddress !== null,
      status: formData.status !== "",
      roofAge: formData.roofAge !== "",
      roofType: formData.roofType !== "",
      roofAgeValid: !isNaN(roofAgeNum) && roofAgeNum >= 0 && roofAgeNum <= 100
    };
    
    console.log('🔍 Form Validation Debug:', {
      checks,
      values: {
        name: `"${formData.name}"`,
        phone: `"${formData.phone}"`,
        roofAge: `"${formData.roofAge}"`,
        roofType: `"${formData.roofType}"`,
        status: `"${formData.status}"`,
        hasSelectedAddress: !!selectedAddress
      }
    });
    
    const valid = Object.values(checks).every(Boolean);
    console.log('✅ isFormValid:', valid);
    
    return valid;
  }, [formData, selectedAddress]);

  const validateForm = () => {
    if (!formData.name.trim()) {
      toast({
        title: "Validation Error",
        description: "Name is required",
        variant: "destructive",
      });
      return false;
    }

    if (!formData.phone.trim()) {
      toast({
        title: "Validation Error", 
        description: "Phone number is required",
        variant: "destructive",
      });
      return false;
    }

    if (!formData.roofAge) {
      toast({
        title: "Validation Error",
        description: "Roof age is required",
        variant: "destructive",
      });
      return false;
    }

    if (!formData.roofType) {
      toast({
        title: "Validation Error",
        description: "Roof type is required",
        variant: "destructive",
      });
      return false;
    }

    const roofAgeNum = parseInt(formData.roofAge);
    if (isNaN(roofAgeNum) || roofAgeNum < 0 || roofAgeNum > 100) {
      toast({
        title: "Validation Error",
        description: "Roof age must be between 0 and 100 years",
        variant: "destructive",
      });
      return false;
    }

    if (!selectedAddress) {
      toast({
        title: "Address Required",
        description: "Please select a verified address from the suggestions",
        variant: "destructive",
      });
      return false;
    }

    if (!formData.status) {
      toast({
        title: "Status Required",
        description: "Please select a pipeline status",
        variant: "destructive",
      });
      return false;
    }

    // Sales rep assignment is optional - will auto-assign to creator if none selected

    return true;
  };

  const handleSubmit = async () => {
    console.log('handleSubmit called with form data:', formData);
    console.log('isFormValid:', isFormValid);
    if (!validateForm()) return;

    markAsSubmitting();
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user || !userProfile?.tenant_id) {
        toast({
          title: "Authentication Error",
          description: "Please log in to create leads",
          variant: "destructive",
        });
        return;
      }

      let contactId = contact?.id;

      // Create new contact if not provided
      if (!contactId) {
        const addressComponents = selectedAddress?.address_components || [];
        const getComponent = (type: string) => 
          addressComponents.find(comp => comp.types.includes(type))?.long_name || '';

        const streetAddress = (getComponent('street_number') + ' ' + getComponent('route')).trim();

        // Check for existing contact at same address to prevent duplicates
        const { data: existingContact } = await supabase
          .from('contacts')
          .select('id, first_name, last_name')
          .eq('tenant_id', userProfile.tenant_id)
          .eq('address_street', streetAddress)
          .maybeSingle();

        // Determine the assigned rep - use first selected rep or fall back to current user
        const assignedRep = formData.assignedTo[0] || session.user.id;

        if (existingContact) {
          // Use existing contact instead of creating duplicate
          contactId = existingContact.id;
          
          // Update the existing contact's assigned_to to match the lead's rep
          const { error: updateError } = await supabase
            .from('contacts')
            .update({ assigned_to: assignedRep })
            .eq('id', existingContact.id);
          
          if (updateError) {
            console.error('Failed to update contact assigned_to:', updateError);
          }
          
          toast({
            title: "Using Existing Contact",
            description: `Found existing contact "${existingContact.first_name} ${existingContact.last_name}" at this address.`,
          });
        } else {
          const { data: newContact, error: contactError } = await supabase
            .from('contacts')
            .insert({
              tenant_id: userProfile.tenant_id,
              first_name: formData.name.split(' ')[0],
              last_name: formData.name.split(' ').slice(1).join(' ') || '',
              phone: formData.phone,
              address_street: streetAddress,
              address_city: getComponent('locality'),
              address_state: getComponent('administrative_area_level_1'),
              address_zip: getComponent('postal_code'),
              latitude: selectedAddress?.geometry?.location?.lat,
              longitude: selectedAddress?.geometry?.location?.lng,
              verified_address: selectedAddress,
              created_by: session.user.id,
              assigned_to: assignedRep,  // Set assigned_to on new contacts
              location_id: currentLocationId, // Set location from location switcher
            } as any)
            .select()
            .single();

          if (contactError) throw contactError;
          contactId = newContact.id;
        }
      }

      // Create pipeline entry
      const { data: pipelineEntry, error: pipelineError } = await supabase
        .from('pipeline_entries')
        .insert({
          tenant_id: userProfile.tenant_id,
          contact_id: contactId,
          location_id: currentLocationId, // Set location from location switcher
          status: formData.status,
          roof_type: formData.roofType || null,
          priority: formData.priority,
          estimated_value: formData.estimatedValue ? parseFloat(formData.estimatedValue) : null,
          assigned_to: formData.assignedTo[0] || session.user.id, // Auto-assign to creator if no rep selected
          secondary_assigned_to: formData.assignedTo[1] || null, // Secondary rep if selected
          primary_rep_split_percent: formData.assignedTo.length > 1 ? 50 : 100, // Default 50/50 split if two reps
          notes: formData.notes || null,
          created_by: session.user.id,
          metadata: {
            multiple_reps: formData.assignedTo,
            address_verified: true,
            verified_address: selectedAddress,
            roof_age_years: parseInt(formData.roofAge),
            roof_type: formData.roofType
          }
        } as any)
        .select()
        .single();

      if (pipelineError) throw pipelineError;

      toast({
        title: "Lead Created Successfully!",
        description: `Lead "${formData.name}" has been created and added to the pipeline.`,
      });

      onLeadCreated?.(pipelineEntry);
      
      // Mark form as saved and close
      markAsSaved();
      setOpen(false);
      
      // Always navigate to lead details
      navigate(`/lead/${pipelineEntry.id}`);
      
      // Reset form
      const resetFormData = {
        name: "",
        phone: "",
        roofAge: "",
        status: "lead",
        roofType: "",
        priority: "medium",
        estimatedValue: "",
        address: "",
        useSameInfo: false,
        assignedTo: [],
        notes: "",
      };
      setFormData(resetFormData);
      setSelectedAddress(null);
      setShowAddressPicker(false);
      resetForm();

    } catch (error) {
      console.error('Error creating lead:', error);
      toast({
        title: "Error",
        description: "Failed to create lead. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const defaultTrigger = (
    <Button className="shadow-soft transition-smooth">
      <Plus className="h-4 w-4 mr-2" />
      Create Lead
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || defaultTrigger}
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-primary" />
            Create New Lead
            {contact && (
              <Badge variant="outline">
                for {contact.first_name} {contact.last_name}
              </Badge>
            )}
            {hasUnsavedChanges && (
              <Badge variant="secondary" className="text-orange-600 bg-orange-50">
                • Unsaved changes
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Basic Information */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="name">Lead Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., John Smith"
              />
            </div>
            <div>
              <Label htmlFor="phone">Phone Number *</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="(555) 123-4567"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="roofAge">Roof Age (years) *</Label>
            <Input
              id="roofAge"
              type="number"
              min="0"
              max="100"
              value={formData.roofAge}
              onChange={(e) => setFormData(prev => ({ ...prev, roofAge: e.target.value }))}
              placeholder="e.g., 15"
            />
          </div>

          {contact && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="useSameInfo"
                checked={formData.useSameInfo}
                onCheckedChange={(checked) => 
                  setFormData(prev => ({ ...prev, useSameInfo: checked as boolean }))
                }
              />
              <Label htmlFor="useSameInfo" className="text-sm">
                Use same info as contact ({contact.first_name} {contact.last_name})
              </Label>
            </div>
          )}

          {/* Pipeline Details */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label htmlFor="status">Pipeline Status *</Label>
              <Select value={formData.status} onValueChange={(value) => setFormData(prev => ({ ...prev, status: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {pipelineStatuses.map(status => (
                    <SelectItem key={status.value} value={status.value}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="roofType">Roof Type *</Label>
              <Select value={formData.roofType} onValueChange={(value) => setFormData(prev => ({ ...prev, roofType: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select roof type" />
                </SelectTrigger>
                <SelectContent>
                  {roofTypes.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="priority">Priority</Label>
              <Select value={formData.priority} onValueChange={(value) => setFormData(prev => ({ ...prev, priority: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="estimatedValue">Estimated Value</Label>
            <Input
              id="estimatedValue"
              value={formData.estimatedValue}
              onChange={(e) => setFormData(prev => ({ ...prev, estimatedValue: e.target.value }))}
              placeholder="e.g., 25000"
              type="number"
            />
          </div>

          {/* Address Section */}
          <div>
            <Label htmlFor="address">Address *</Label>
            <Input
              id="address"
              value={formData.address}
              onChange={(e) => {
                const newAddress = e.target.value;
                setFormData(prev => ({ ...prev, address: newAddress }));
                // Only clear selectedAddress if user typed something different
                if (selectedAddress && newAddress !== selectedAddress.formatted_address) {
                  setSelectedAddress(null);
                }
              }}
              placeholder="Start typing address..."
              disabled={formData.useSameInfo}
            />
          </div>

          {showAddressPicker && addressSuggestions.length > 0 && (
            <div className="space-y-2">
              <Label>Select Verified Address:</Label>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {addressSuggestions.map((suggestion, index) => (
                  <Card
                    key={suggestion.place_id || index}
                    className={`cursor-pointer transition-all hover:shadow-md ${
                      selectedAddress?.place_id === suggestion.place_id
                        ? 'border-primary bg-primary/5'
                        : 'border-border'
                    }`}
                    onClick={() => handleAddressSelect(suggestion)}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-start gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground mt-1 flex-shrink-0" />
                          <p className="text-sm">{suggestion.formatted_address}</p>
                        </div>
                        {selectedAddress?.place_id === suggestion.place_id && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {selectedAddress && (
            <div className="flex items-center gap-2 text-sm text-success">
              <Check className="h-4 w-4" />
              Address verified with Google Maps
            </div>
          )}

          {/* Sales Rep Selection - Dropdown with Chips, Max 2 */}
          <div>
            <Label className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4" />
              Assign Sales Representatives (up to 2)
            </Label>
            
            {/* Show selected reps as chips */}
            {formData.assignedTo.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {formData.assignedTo.map(repId => {
                  const rep = salesReps.find(r => r.id === repId);
                  return rep ? (
                    <Badge key={repId} variant="secondary" className="flex items-center gap-1 py-1 px-2">
                      {rep.first_name} {rep.last_name}
                      <X 
                        className="h-3 w-3 cursor-pointer hover:text-destructive" 
                        onClick={() => handleRemoveRep(repId)}
                      />
                    </Badge>
                  ) : null;
                })}
              </div>
            )}
            
            {/* Dropdown to add reps (max 2) */}
            {formData.assignedTo.length < 2 && (
              <Select onValueChange={handleAddRep} value="">
                <SelectTrigger>
                  <SelectValue placeholder={formData.assignedTo.length === 0 ? "Select sales representative..." : "Add another rep..."} />
                </SelectTrigger>
                <SelectContent>
                  {salesReps
                    .filter(rep => !formData.assignedTo.includes(rep.id))
                    .map(rep => (
                      <SelectItem key={rep.id} value={rep.id}>
                        {rep.first_name} {rep.last_name}
                      </SelectItem>
                    ))}
                  {salesReps.filter(rep => !formData.assignedTo.includes(rep.id)).length === 0 && (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">No available reps</div>
                  )}
                </SelectContent>
              </Select>
            )}
            
            {formData.assignedTo.length === 2 && (
              <p className="text-xs text-muted-foreground mt-1">Maximum 2 representatives assigned</p>
            )}
          </div>

          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="Additional notes about this lead..."
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button 
              variant="outline" 
              onClick={() => {
                if (hasUnsavedChanges) {
                  const confirmed = window.confirm("You have unsaved changes. Are you sure you want to cancel?");
                  if (confirmed) {
                    resetForm();
                    setOpen(false);
                  }
                } else {
                  setOpen(false);
                }
              }}
            >
              Cancel
            </Button>
            <Button 
              onClick={(e) => {
                console.log('Button clicked!', { 
                  isFormValid, 
                  loading, 
                  isSubmitting,
                  disabled: loading || !isFormValid || isSubmitting 
                });
                e.preventDefault();
                handleSubmit();
              }} 
              disabled={loading || !isFormValid || isSubmitting}
              className={`transition-all duration-300 ${
                isFormValid 
                  ? 'bg-primary text-primary-foreground shadow-lg hover:shadow-xl transform hover:scale-105 ring-2 ring-primary/20 animate-pulse' 
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              }`}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating Lead...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  {isFormValid ? 'Create Lead & Measure' : 'Complete Required Fields'}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LeadCreationDialog;
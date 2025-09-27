import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, MapPin, Check, AlertCircle, Loader2, User, Briefcase } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface EnhancedJobCreationDialogProps {
  trigger?: React.ReactNode;
  contact?: any;
  onJobCreated?: (job: any) => void;
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
  role: string;
}

export const EnhancedJobCreationDialog: React.FC<EnhancedJobCreationDialogProps> = ({
  trigger,
  contact,
  onJobCreated,
}) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [addressLoading, setAddressLoading] = useState(false);
  const [salesReps, setSalesReps] = useState<SalesRep[]>([]);
  const [userProfile, setUserProfile] = useState<any>(null);
  
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    address: "",
    phone: "",
    status: "",
    priority: "medium" as const,
    estimatedValue: "",
    roofType: "",
    salesReps: [] as string[],
    useSameInfo: false,
  });

  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<AddressSuggestion | null>(null);
  const [showAddressPicker, setShowAddressPicker] = useState(false);
  const { toast } = useToast();

  // Pipeline statuses from the database
  const pipelineStatuses = [
    { value: "lead", label: "Lead" },
    { value: "legal_review", label: "Legal Review" },
    { value: "contingency_signed", label: "Contingency Signed" },
    { value: "project", label: "Project" },
    { value: "completed", label: "Completed" },
    { value: "closed", label: "Closed" },
    { value: "canceled", label: "Canceled" },
    { value: "lost", label: "Lost" },
  ];

  const roofTypes = [
    { value: "shingle", label: "Shingle" },
    { value: "metal", label: "Metal" },
    { value: "tile", label: "Tile" },
    { value: "flat", label: "Flat" },
    { value: "slate", label: "Slate" },
    { value: "cedar", label: "Cedar" },
    { value: "other", label: "Other" },
  ];

  useEffect(() => {
    if (open) {
      loadSalesReps();
      loadUserProfile();
    }
  }, [open]);

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
        address: fullAddress,
        phone: contact.phone || "",
        name: `${contact.first_name} ${contact.last_name} - Roofing Project`
      }));
      
      // Create a mock address object for validation when using contact info
      if (fullAddress) {
        const mockAddress: AddressSuggestion = {
          place_id: `contact_${contact.id}`,
          formatted_address: fullAddress,
          geometry: {
            location: {
              lat: contact.latitude || 0,
              lng: contact.longitude || 0
            }
          },
          address_components: []
        };
        setSelectedAddress(mockAddress);
        handleAddressVerification(fullAddress);
      }
    } else if (!formData.useSameInfo) {
      // Clear address when unchecking useSameInfo
      setSelectedAddress(null);
      setFormData(prev => ({ 
        ...prev, 
        address: "",
        phone: "",
        name: ""
      }));
    }
  }, [formData.useSameInfo, contact]);

  const loadUserProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      setUserProfile(profile);
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  };

  const loadSalesReps = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .maybeSingle();

      if (!profile) return;

      const { data: reps, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, role')
        .eq('tenant_id', profile.tenant_id)
        .in('role', ['admin', 'manager', 'master'])
        .eq('is_active', true)
        .order('first_name');

      if (error) throw error;

      setSalesReps(reps || []);
    } catch (error) {
      console.error('Error loading sales reps:', error);
      toast({
        title: "Error",
        description: "Failed to load sales representatives",
        variant: "destructive",
      });
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

        setAddressSuggestions(detailedSuggestions.filter(Boolean));
        setShowAddressPicker(true);
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

  const handleSalesRepToggle = (repId: string) => {
    setFormData(prev => ({
      ...prev,
      salesReps: prev.salesReps.includes(repId)
        ? prev.salesReps.filter(id => id !== repId)
        : [...prev.salesReps, repId]
    }));
  };

  const validateForm = () => {
    const errors: string[] = [];
    
    if (!formData.name.trim()) errors.push("Job name is required");
    if (!formData.phone.trim()) errors.push("Phone number is required");
    if (!selectedAddress) errors.push("Verified address is required");
    if (!formData.status) errors.push("Status selection is required");
    
    return errors;
  };

  const handleSubmit = async () => {
    const errors = validateForm();
    
    if (errors.length > 0) {
      toast({
        title: "Validation Error",
        description: errors.join(", "),
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No authenticated user");

      // Create or update contact if needed
      let contactId = contact?.id;
      
      if (!contactId) {
        // Create new contact from job form data
        const addressComponents = selectedAddress?.address_components || [];
        const streetNumber = addressComponents.find(c => c.types.includes('street_number'))?.long_name || '';
        const route = addressComponents.find(c => c.types.includes('route'))?.long_name || '';
        const city = addressComponents.find(c => c.types.includes('locality'))?.long_name || '';
        const state = addressComponents.find(c => c.types.includes('administrative_area_level_1'))?.short_name || '';
        const zipCode = addressComponents.find(c => c.types.includes('postal_code'))?.long_name || '';

        const nameParts = formData.name.split(' ');
        const firstName = nameParts[0] || 'Unknown';
        const lastName = nameParts.slice(1).join(' ') || 'Contact';

        const { data: newContact, error: contactError } = await supabase
          .from('contacts')
          .insert({
            tenant_id: userProfile.tenant_id,
            first_name: firstName,
            last_name: lastName,
            phone: formData.phone,
            address_street: `${streetNumber} ${route}`.trim(),
            address_city: city,
            address_state: state,
            address_zip: zipCode,
            type: 'homeowner',
            created_by: user.id,
          })
          .select()
          .single();

        if (contactError) throw contactError;
        contactId = newContact.id;
      }

      // Create pipeline entry first
      const pipelineData = {
        tenant_id: userProfile.tenant_id,
        contact_id: contactId,
        status: (formData.status as "canceled" | "closed" | "completed" | "contingency_signed" | "duplicate" | "hold_mgr_review" | "lead" | "legal_review" | "lost" | "project"),
        priority: formData.priority,
        estimated_value: formData.estimatedValue ? parseFloat(formData.estimatedValue) : null,
        roof_type: (formData.roofType as "cedar" | "flat" | "metal" | "other" | "shingle" | "slate" | "tile") || null,
        assigned_to: formData.salesReps[0] || null, // Assign to first selected rep
        notes: formData.description,
        created_by: user.id,
      };

      const { data: pipelineEntry, error: pipelineError } = await supabase
        .from('pipeline_entries')
        .insert([pipelineData])
        .select()
        .single();

      if (pipelineError) throw pipelineError;

      // Create actual job record in jobs table
      const jobData = {
        tenant_id: userProfile.tenant_id,
        contact_id: contactId,
        pipeline_entry_id: pipelineEntry.id,
        name: formData.name,
        description: formData.description,
        status: 'active',
        priority: formData.priority,
        estimated_value: formData.estimatedValue ? parseFloat(formData.estimatedValue) : null,
        roof_type: formData.roofType || null,
        address_street: selectedAddress?.formatted_address || '',
        created_by: user.id,
      };

      const { data: jobRecord, error: jobError } = await supabase
        .from('jobs')
        .insert([jobData])
        .select()
        .single();

      if (jobError) throw jobError;

      toast({
        title: "Job Created Successfully",
        description: `Job "${formData.name}" has been created and added to the pipeline`,
      });

      onJobCreated?.(jobRecord);
      
      // Navigate to the job details page using the actual job ID
      navigate(`/job/${jobRecord.id}`);
      
      // Reset form
      setOpen(false);
      setFormData({
        name: "",
        description: "",
        address: "",
        phone: "",
        status: "",
        priority: "medium",
        estimatedValue: "",
        roofType: "",
        salesReps: [],
        useSameInfo: false,
      });
      setSelectedAddress(null);
      setShowAddressPicker(false);
      
    } catch (error) {
      console.error('Error creating job:', error);
      toast({
        title: "Error",
        description: "Failed to create job. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const defaultTrigger = (
    <Button className="shadow-soft transition-smooth bg-primary hover:bg-primary/90">
      <Plus className="h-4 w-4 mr-2" />
      Add Job
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
            <Briefcase className="h-5 w-5 text-primary" />
            Add New Job
            {contact && (
              <Badge variant="outline">
                for {contact.first_name} {contact.last_name}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left Column */}
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Job Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Roof Replacement - Smith Residence"
                />
              </div>

              <div>
                <Label htmlFor="phone">Phone Number *</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="(555) 123-4567"
                  disabled={formData.useSameInfo}
                />
              </div>

              <div>
                <Label htmlFor="status">Status *</Label>
                <Select value={formData.status} onValueChange={(value) => setFormData(prev => ({ ...prev, status: value }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelineStatuses.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="roofType">Roof Type</Label>
                <Select value={formData.roofType} onValueChange={(value) => setFormData(prev => ({ ...prev, roofType: value }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select roof type" />
                  </SelectTrigger>
                  <SelectContent>
                    {roofTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="estimatedValue">Estimated Value</Label>
                <Input
                  id="estimatedValue"
                  type="number"
                  value={formData.estimatedValue}
                  onChange={(e) => setFormData(prev => ({ ...prev, estimatedValue: e.target.value }))}
                  placeholder="25000"
                />
              </div>
            </div>

            {/* Right Column */}
            <div className="space-y-4">
              <div>
                <Label htmlFor="address">Job Address *</Label>
                <div className="flex gap-2">
                  <Input
                    id="address"
                    value={formData.address}
                    onChange={(e) => {
                      setFormData(prev => ({ ...prev, address: e.target.value }));
                      setSelectedAddress(null);
                    }}
                    placeholder="Start typing address..."
                    disabled={formData.useSameInfo}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleAddressVerification(formData.address)}
                    disabled={!formData.address.trim() || addressLoading}
                  >
                    {addressLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <MapPin className="h-4 w-4" />
                    )}
                    Verify
                  </Button>
                </div>
              </div>

              <div>
                <Label>Sales Representatives</Label>
                <div className="space-y-2 max-h-32 overflow-y-auto border rounded-md p-2">
                  {salesReps.map((rep) => (
                    <div key={rep.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`rep-${rep.id}`}
                        checked={formData.salesReps.includes(rep.id)}
                        onCheckedChange={() => handleSalesRepToggle(rep.id)}
                      />
                      <Label htmlFor={`rep-${rep.id}`} className="text-sm flex items-center gap-2">
                        <User className="h-3 w-3" />
                        {rep.first_name} {rep.last_name} ({rep.role})
                      </Label>
                    </div>
                  ))}
                  {salesReps.length === 0 && (
                    <p className="text-sm text-muted-foreground">No sales representatives found</p>
                  )}
                </div>
              </div>

              <div>
                <Label htmlFor="description">Description/Notes</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Additional job details, requirements, or notes..."
                  rows={4}
                />
              </div>
            </div>
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

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating Job...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Job
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EnhancedJobCreationDialog;
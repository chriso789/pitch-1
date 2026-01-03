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
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, MapPin, Check, AlertCircle, Loader2, User, Briefcase, Link2, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ContactSearchSelect } from "@/components/ContactSearchSelect";

interface EnhancedLeadCreationDialogProps {
  trigger?: React.ReactNode;
  contact?: any;
  onLeadCreated?: (lead: any) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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

interface SelectedContact {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  address_street?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  latitude?: number;
  longitude?: number;
}

export const EnhancedLeadCreationDialog: React.FC<EnhancedLeadCreationDialogProps> = ({
  trigger,
  contact,
  onLeadCreated,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}) => {
  const navigate = useNavigate();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = (newOpen: boolean) => {
    if (controlledOnOpenChange) {
      controlledOnOpenChange(newOpen);
    } else {
      setInternalOpen(newOpen);
    }
  };
  const [loading, setLoading] = useState(false);
  const [addressLoading, setAddressLoading] = useState(false);
  const [salesReps, setSalesReps] = useState<SalesRep[]>([]);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [selectedContact, setSelectedContact] = useState<SelectedContact | null>(contact || null);
  
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    address: "",
    phone: "",
    roofAge: "",
    status: "lead",
    priority: "medium" as const,
    estimatedValue: "",
    roofType: "",
    salesReps: [] as string[],
    useSameInfo: false,
  });

  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<AddressSuggestion | null>(null);
  const [showAddressPicker, setShowAddressPicker] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [addressVerified, setAddressVerified] = useState(false);
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
        .select('tenant_id, active_tenant_id')
        .eq('id', user.id)
        .maybeSingle();

      if (!profile) return;

      // CRITICAL: Use active_tenant_id (switched company) or fall back to tenant_id (home company)
      const effectiveTenantId = profile.active_tenant_id || profile.tenant_id;
      if (!effectiveTenantId) return;

      const { data: reps, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, role, tenant_id')
        .eq('tenant_id', effectiveTenantId)
        .in('role', ['corporate', 'office_admin', 'regional_manager', 'sales_manager', 'project_manager', 'owner'])
        .eq('is_active', true)
        .order('first_name');

      if (error) throw error;

      // Filter out master users unless they belong to this tenant as their home tenant
      // This prevents master users from appearing in other companies' dropdowns
      const filteredReps = (reps || []).filter(rep => {
        // If rep is a master role, only show if this is their home tenant
        if (rep.role === 'master') {
          return rep.tenant_id === effectiveTenantId;
        }
        return true;
      });

      setSalesReps(filteredReps);
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
    setAddressVerified(true);
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
    const errors: Record<string, string> = {};
    
    // Either need selected contact OR new contact info (name + phone + address text)
    if (!selectedContact && !formData.name.trim()) {
      errors.name = "Lead name is required";
    }
    if (!selectedContact && !formData.phone.trim()) {
      errors.phone = "Phone number is required";
    }
    if (!formData.roofAge) {
      errors.roofAge = "Roof age is required";
    } else {
      const roofAgeNum = parseInt(formData.roofAge);
      if (isNaN(roofAgeNum) || roofAgeNum < 0 || roofAgeNum > 100) {
        errors.roofAge = "Must be between 0 and 100 years";
      }
    }
    // Allow either: verified address, selected contact with address, OR manual address text
    if (!selectedAddress && !selectedContact && !formData.address.trim()) {
      errors.address = "Address is required";
    }
    if (!formData.status) {
      errors.status = "Status is required";
    }
    if (!formData.roofType) {
      errors.roofType = "Roof type is required";
    }
    
    setFieldErrors(errors);
    return errors;
  };

  const handleContactSelect = (contact: SelectedContact | null) => {
    setSelectedContact(contact);
    if (contact) {
      // Auto-fill form from selected contact
      const fullAddress = [
        contact.address_street,
        contact.address_city,
        contact.address_state,
        contact.address_zip
      ].filter(Boolean).join(", ");
      
      setFormData(prev => ({
        ...prev,
        name: `${contact.first_name} ${contact.last_name} - Roofing Project`,
        phone: contact.phone || prev.phone,
        address: fullAddress || prev.address,
      }));
      
      if (fullAddress && contact.latitude && contact.longitude) {
        setSelectedAddress({
          place_id: `contact_${contact.id}`,
          formatted_address: fullAddress,
          geometry: {
            location: {
              lat: contact.latitude,
              lng: contact.longitude
            }
          },
          address_components: []
        });
        setAddressVerified(true);
      }
    }
  };

  const handleSubmit = async () => {
    const errors = validateForm();
    
    if (Object.keys(errors).length > 0) {
      toast({
        title: "Please fix the errors below",
        description: "Some required fields are missing or invalid",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      // Call edge function to handle contact + lead creation
      const { data, error } = await supabase.functions.invoke('create-lead-with-contact', {
        body: {
          name: formData.name,
          phone: formData.phone,
          address: formData.address,
          description: formData.description,
          roofAge: formData.roofAge,
          roofType: formData.roofType,
          status: formData.status || 'lead',
          priority: formData.priority,
          estimatedValue: formData.estimatedValue,
          salesReps: formData.salesReps,
          selectedAddress: selectedAddress,
          existingContactId: selectedContact?.id || contact?.id,
        }
      });

      if (error) {
        console.error('Edge function error:', error);
        throw new Error(error.message || 'Failed to create lead');
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Failed to create lead');
      }

      toast({
        title: "Lead Created Successfully",
        description: `Lead "${formData.name}" has been added to the pipeline`,
      });

      onLeadCreated?.(data.lead);
      
      // Navigate to the pipeline page
      navigate(`/pipeline`);
      
      // Reset form
      setOpen(false);
      setFormData({
        name: "",
        description: "",
        address: "",
        phone: "",
        roofAge: "",
        status: "lead",
        priority: "medium",
        estimatedValue: "",
        roofType: "",
        salesReps: [],
        useSameInfo: false,
      });
      setSelectedAddress(null);
      setSelectedContact(null);
      setShowAddressPicker(false);
      setAddressVerified(false);
      
    } catch (error: any) {
      console.error('Error creating lead:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to create lead. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const defaultTrigger = (
    <Button className="shadow-soft transition-smooth bg-primary hover:bg-primary/90">
      <Plus className="h-4 w-4 mr-2" />
      Add Lead
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
            Add New Lead
            {contact && (
              <Badge variant="outline">
                for {contact.first_name} {contact.last_name}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Contact Search/Link Section */}
          {!contact && (
            <div className="space-y-3">
              <Label className="flex items-center gap-2 text-base font-semibold">
                <Link2 className="h-4 w-4 text-primary" />
                Link to Contact
              </Label>
              <ContactSearchSelect
                selectedContact={selectedContact}
                onContactSelect={handleContactSelect}
                tenantId={userProfile?.tenant_id}
              />
              <Separator className="my-4" />
            </div>
          )}

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
                <Label htmlFor="name" className="flex items-center gap-1">
                  Lead Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => {
                    setFormData(prev => ({ ...prev, name: e.target.value }));
                    if (fieldErrors.name) setFieldErrors(prev => ({ ...prev, name: "" }));
                  }}
                  placeholder="e.g., Roof Replacement - Smith Residence"
                  className={fieldErrors.name ? "border-destructive focus-visible:ring-destructive" : ""}
                />
                {fieldErrors.name && (
                  <p className="text-sm text-destructive mt-1">{fieldErrors.name}</p>
                )}
              </div>

              <div>
                <Label htmlFor="phone" className="flex items-center gap-1">
                  Phone Number <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => {
                    setFormData(prev => ({ ...prev, phone: e.target.value }));
                    if (fieldErrors.phone) setFieldErrors(prev => ({ ...prev, phone: "" }));
                  }}
                  placeholder="Enter phone number"
                  disabled={formData.useSameInfo}
                  className={fieldErrors.phone ? "border-destructive focus-visible:ring-destructive" : ""}
                />
                {fieldErrors.phone && (
                  <p className="text-sm text-destructive mt-1">{fieldErrors.phone}</p>
                )}
              </div>

              <div>
                <Label htmlFor="roofAge" className="flex items-center gap-1">
                  Roof Age (years) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="roofAge"
                  type="number"
                  min="0"
                  max="100"
                  value={formData.roofAge}
                  onChange={(e) => {
                    setFormData(prev => ({ ...prev, roofAge: e.target.value }));
                    if (fieldErrors.roofAge) setFieldErrors(prev => ({ ...prev, roofAge: "" }));
                  }}
                  placeholder="e.g., 15"
                  className={fieldErrors.roofAge ? "border-destructive focus-visible:ring-destructive" : ""}
                />
                {fieldErrors.roofAge && (
                  <p className="text-sm text-destructive mt-1">{fieldErrors.roofAge}</p>
                )}
              </div>

              <div>
                <Label htmlFor="status" className="flex items-center gap-1">
                  Status <span className="text-destructive">*</span>
                </Label>
                <Select 
                  value={formData.status} 
                  onValueChange={(value) => {
                    setFormData(prev => ({ ...prev, status: value }));
                    if (fieldErrors.status) setFieldErrors(prev => ({ ...prev, status: "" }));
                  }}
                >
                  <SelectTrigger className={fieldErrors.status ? "border-destructive focus:ring-destructive" : ""}>
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
                {fieldErrors.status && (
                  <p className="text-sm text-destructive mt-1">{fieldErrors.status}</p>
                )}
              </div>

              <div>
                <Label htmlFor="roofType" className="flex items-center gap-1">
                  Roof Type <span className="text-destructive">*</span>
                </Label>
                <Select 
                  value={formData.roofType} 
                  onValueChange={(value) => {
                    setFormData(prev => ({ ...prev, roofType: value }));
                    if (fieldErrors.roofType) setFieldErrors(prev => ({ ...prev, roofType: "" }));
                  }}
                >
                  <SelectTrigger className={fieldErrors.roofType ? "border-destructive focus:ring-destructive" : ""}>
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
                {fieldErrors.roofType && (
                  <p className="text-sm text-destructive mt-1">{fieldErrors.roofType}</p>
                )}
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
                <div className="flex items-center justify-between mb-1">
                  <Label htmlFor="address" className="flex items-center gap-1">
                    Lead Address <span className="text-destructive">*</span>
                  </Label>
                  {formData.address.trim() && (
                    addressVerified ? (
                      <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Verified
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Manual Entry
                      </Badge>
                    )
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    id="address"
                    value={formData.address}
                    onChange={(e) => {
                      setFormData(prev => ({ ...prev, address: e.target.value }));
                      setSelectedAddress(null);
                      setAddressVerified(false);
                      if (fieldErrors.address) setFieldErrors(prev => ({ ...prev, address: "" }));
                    }}
                    placeholder="Start typing address..."
                    disabled={formData.useSameInfo}
                    className={fieldErrors.address ? "border-destructive focus-visible:ring-destructive" : ""}
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
                {fieldErrors.address && (
                  <p className="text-sm text-destructive mt-1">{fieldErrors.address}</p>
                )}
                {!addressVerified && formData.address.trim() && !fieldErrors.address && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Click "Verify" to validate the address with Google Maps
                  </p>
                )}
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
                  placeholder="Additional lead details, requirements, or notes..."
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
                  Creating Lead...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Lead
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EnhancedLeadCreationDialog;

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { UserPlus, Save, MapPin, Trash2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { default as AddressVerification } from "@/shared/components/forms/AddressVerification";
import { auditService } from "@/services/auditService";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { TEST_IDS } from "../../../../tests/utils/test-ids";
import { useContactDraftPersistence } from "@/hooks/useContactDraftPersistence";
import { useNavigate } from "react-router-dom";

interface ContactFormData {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  secondary_phone?: string;
  additional_phones?: string[];
  company_name?: string;
  type: "homeowner" | "renter" | "business";
  lead_source?: string;
  qualification_status?: string;
  notes?: string;
  tags?: string[];
}

interface ContactFormProps {
  onSubmit?: (contact: any) => void;
  onCancel?: () => void;
  initialData?: Partial<ContactFormData>;
  isGhostAccount?: boolean;
}

const ContactForm: React.FC<ContactFormProps> = ({
  onSubmit,
  onCancel,
  initialData = {},
  isGhostAccount = false,
}) => {
  const { user: currentUser } = useCurrentUser();
  const effectiveTenantId = useEffectiveTenantId();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { 
    hasDraft, 
    draftTimestamp, 
    loadDraft, 
    saveDraft, 
    clearDraft, 
    saveDraftOnError,
    showDraftRestoredNotification 
  } = useContactDraftPersistence();

  const [formData, setFormData] = useState<ContactFormData>({
    first_name: initialData.first_name || "",
    last_name: initialData.last_name || "",
    email: initialData.email || "",
    phone: initialData.phone || "",
    secondary_phone: (initialData as any).secondary_phone || "",
    additional_phones: (initialData as any).additional_phones || [],
    company_name: initialData.company_name || "",
    type: initialData.type || "homeowner",
    lead_source: initialData.lead_source || "",
    qualification_status: "",
    notes: initialData.notes || "",
    tags: initialData.tags || [],
  });

  const [addressData, setAddressData] = useState<any>(null);
  const [addressVerificationData, setAddressVerificationData] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [assignedTo, setAssignedTo] = useState<string>("");
  const [tenantUsers, setTenantUsers] = useState<Array<{ id: string; name: string; email: string }>>([]);
  // Hardcoded lead sources
  const leadSources = [
    { id: "google", name: "Google" },
    { id: "facebook", name: "Facebook" },
    { id: "instagram", name: "Instagram" },
    { id: "sign", name: "Sign" },
    { id: "call_in", name: "Call In" },
    { id: "referral", name: "Referral" },
  ];
  const [draftLoaded, setDraftLoaded] = useState(false);

  // Load draft on mount
  useEffect(() => {
    if (draftLoaded) return;
    
    const draft = loadDraft();
    if (draft) {
      setFormData(draft.formData);
      setAddressData(draft.addressData);
      setAssignedTo(draft.assignedTo);
      setDraftLoaded(true);
      
      // Show notification after a brief delay
      setTimeout(() => {
        showDraftRestoredNotification();
      }, 500);
    }
  }, [loadDraft, showDraftRestoredNotification, draftLoaded]);

  // Auto-save draft when form data changes
  useEffect(() => {
    if (!draftLoaded) return; // Don't save until initial load is complete
    
    // Only save if there's actual data
    if (formData.first_name || formData.last_name || formData.email || formData.phone) {
      saveDraft(formData, addressData, assignedTo);
    }
  }, [formData, addressData, assignedTo, saveDraft, draftLoaded]);

  // Fetch tenant users (sales reps) for assignment dropdown - use effective tenant
  useEffect(() => {
    const fetchTenantUsers = async () => {
      const tenantToUse = effectiveTenantId || currentUser?.tenant_id;
      if (!tenantToUse) return;

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, first_name, last_name, email')
          .eq('tenant_id', tenantToUse)
          .order('first_name');

        if (error) throw error;

        const users = data?.map(u => ({
          id: u.id,
          name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email || 'Unknown User',
          email: u.email || ''
        })) || [];

        setTenantUsers(users);
      } catch (error) {
        console.error('Error fetching tenant users:', error);
      }
    };

    fetchTenantUsers();
  }, [effectiveTenantId, currentUser?.tenant_id]);


  const handleInputChange = (field: keyof ContactFormData, value: string | string[]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleAddressVerified = (address: any, verificationData: any) => {
    setAddressData(address);
    setAddressVerificationData(verificationData);
  };

  const addTag = () => {
    if (newTag && !formData.tags?.includes(newTag)) {
      setFormData(prev => ({
        ...prev,
        tags: [...(prev.tags || []), newTag],
      }));
      setNewTag("");
    }
  };

  const removeTag = (tagToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags?.filter(tag => tag !== tagToRemove) || [],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.first_name || !formData.last_name) {
      toast({
        title: "Validation Error",
        description: "First name and last name are required.",
        variant: "destructive",
      });
      return;
    }

    if (!formData.email && !formData.phone) {
      toast({
        title: "Validation Error",
        description: "At least one contact method (email or phone) is required.",
        variant: "destructive",
      });
      return;
    }

    if (!formData.lead_source) {
      toast({
        title: "Validation Error",
        description: "Lead source is required for tracking.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Capture audit context before creating contact
      await auditService.captureAuditContext();

      // Use effective tenant ID (supports company switching)
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("User not authenticated");

      // Use effective tenant ID, falling back to profile lookup only if needed
      let tenantIdToUse = effectiveTenantId;
      if (!tenantIdToUse) {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("tenant_id, active_tenant_id")
          .eq("id", user.id)
          .maybeSingle();

        if (profileError) throw profileError;
        tenantIdToUse = profile?.active_tenant_id || profile?.tenant_id;
      }

      if (!tenantIdToUse) {
        throw new Error("No active company found. Please select a company.");
      }

      const contactData = {
        // Basic contact info
        first_name: formData.first_name,
        last_name: formData.last_name,
        email: formData.email || null,
        phone: formData.phone || null,
        secondary_phone: formData.secondary_phone || null,
        additional_phones: formData.additional_phones?.filter(p => p.trim()) || [],
        company_name: formData.company_name || null,
        type: formData.type as any, // Allow custom types beyond DB enum
        notes: formData.notes || null,
        tags: formData.tags || [],
        
        // Lead source and qualification
        lead_source: formData.lead_source || null,
        qualification_status: formData.qualification_status || null,
        
        // System fields - use effective tenant ID
        tenant_id: tenantIdToUse,
        assigned_to: assignedTo || null,
        created_by_ghost: isGhostAccount ? user.id : null,
        
        // Address fields
        address_street: addressData?.street || null,
        address_city: addressData?.city || null,
        address_state: addressData?.state || null,
        address_zip: addressData?.zip || null,
        latitude: addressData?.lat ? Number(addressData.lat) : null,
        longitude: addressData?.lng ? Number(addressData.lng) : null,
        
        // Verification data
        verified_address: addressData ? {
          street: addressData.street,
          city: addressData.city,
          state: addressData.state,
          zip: addressData.zip,
          lat: addressData.lat ? Number(addressData.lat) : null,
          lng: addressData.lng ? Number(addressData.lng) : null,
          place_id: addressData.place_id,
          formatted_address: addressData.formatted_address,
        } : null,
        address_verification_data: addressVerificationData ? {
          place_id: addressVerificationData.place_id || null,
          formatted_address: addressVerificationData.formatted_address || null,
          verification_timestamp: addressVerificationData.verification_timestamp || null,
          verification_status: addressVerificationData.verification_status || null,
          error: addressVerificationData.error || null,
        } : {},
      };

      const { data, error } = await supabase
        .from("contacts")
        .insert([contactData])
        .select()
        .single();

      if (error) throw error;

      // Log the contact creation
      await auditService.logChange(
        'contacts',
        'INSERT',
        data.id,
        undefined,
        contactData
      );

      // Clear draft on successful submission
      clearDraft();

      toast({
        title: "Contact Created",
        description: `${formData.first_name} ${formData.last_name} has been added to your contacts.`,
      });

      onSubmit?.(data);
    } catch (error: any) {
      console.error("Error creating contact:", {
        error,
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        formData,
        contactData: {
          ...formData,
          tenant_id: currentUser?.tenant_id,
          address: addressData,
        }
      });
      
      // Save draft on error
      saveDraftOnError(formData, addressData, assignedTo, error.message);
      
      let errorMessage = "Failed to create contact.";
      let showLoginButton = false;

      // Check for auth session errors
      if (error.message?.includes("Auth session missing") || 
          error.message?.includes("JWT") ||
          error.message?.includes("session") ||
          error.code === "PGRST301") {
        errorMessage = "Your session has expired. Please log in again to complete submission.";
        showLoginButton = true;
      } else if (error.message?.includes("tenant_id")) {
        errorMessage = "Your account is not properly configured. Please contact support.";
      } else if (error.message?.includes("RLS")) {
        errorMessage = "Permission denied. Please contact your administrator.";
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast({
        title: "Creation Failed",
        description: errorMessage,
        variant: "destructive",
        action: showLoginButton ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate("/login")}
          >
            Go to Login
          </Button>
        ) : undefined,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            {isGhostAccount ? "Add Contact (Ghost Mode)" : "Add New Contact"}
            {isGhostAccount && (
              <Badge variant="secondary" className="ml-2">
                Ghost Account
              </Badge>
            )}
          </div>
          {hasDraft && draftTimestamp && (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                Draft from {new Date(draftTimestamp).toLocaleDateString()}
              </Badge>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearDraft}
                className="h-8 px-2"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardTitle>
      </CardHeader>
      
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">First Name *</label>
              <Input
                data-testid={TEST_IDS.contacts.form.firstName}
                value={formData.first_name}
                onChange={(e) => handleInputChange("first_name", e.target.value)}
                placeholder="Enter first name"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium">Last Name *</label>
              <Input
                data-testid={TEST_IDS.contacts.form.lastName}
                value={formData.last_name}
                onChange={(e) => handleInputChange("last_name", e.target.value)}
                placeholder="Enter last name"
                required
              />
            </div>
          </div>

          {/* Contact Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Email <span className="text-muted-foreground text-xs">(Required if no phone)</span></label>
              <Input
                data-testid={TEST_IDS.contacts.form.email}
                type="email"
                value={formData.email}
                onChange={(e) => handleInputChange("email", e.target.value)}
                placeholder="Enter email address"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Phone <span className="text-muted-foreground text-xs">(Required if no email)</span></label>
              <Input
                data-testid={TEST_IDS.contacts.form.phone}
                type="tel"
                value={formData.phone}
                onChange={(e) => handleInputChange("phone", e.target.value)}
                placeholder="Enter phone number"
              />
            </div>
          </div>

          {/* Secondary Phone */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Secondary Phone</label>
              <Input
                type="tel"
                value={formData.secondary_phone || ''}
                onChange={(e) => handleInputChange("secondary_phone", e.target.value)}
                placeholder="Enter secondary phone (optional)"
              />
            </div>
          </div>

          {/* Additional Phone Numbers */}
          <div>
            <label className="text-sm font-medium">Additional Phone Numbers</label>
            <div className="space-y-2 mt-1">
              {formData.additional_phones?.map((phone, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    type="tel"
                    value={phone}
                    onChange={(e) => {
                      const updated = [...(formData.additional_phones || [])];
                      updated[index] = e.target.value;
                      handleInputChange("additional_phones", updated);
                    }}
                    placeholder={`Additional phone ${index + 1}`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      const updated = formData.additional_phones?.filter((_, i) => i !== index);
                      handleInputChange("additional_phones", updated || []);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  handleInputChange("additional_phones", [...(formData.additional_phones || []), ""]);
                }}
              >
                <UserPlus className="h-4 w-4 mr-1" /> Add Phone
              </Button>
            </div>
          </div>

          {/* Business Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Company Name</label>
              <Input
                value={formData.company_name}
                onChange={(e) => handleInputChange("company_name", e.target.value)}
                placeholder="Enter company name"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Contact Type</label>
              <Select value={formData.type} onValueChange={(value) => handleInputChange("type", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select contact type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="homeowner">Homeowner</SelectItem>
                  <SelectItem value="renter">Renter</SelectItem>
                  <SelectItem value="business">Business</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Lead Source - Required */}
          <div>
            <label className="text-sm font-medium">Lead Source <span className="text-destructive">*</span></label>
            <Select 
              value={formData.lead_source} 
              onValueChange={(value) => handleInputChange("lead_source", value)}
            >
              <SelectTrigger 
                data-testid={TEST_IDS.contacts.form.leadSource}
                className={!formData.lead_source ? "border-muted-foreground/50" : ""}
              >
                <SelectValue placeholder="Select lead source *" />
              </SelectTrigger>
              <SelectContent>
                {leadSources.map((source) => (
                  <SelectItem key={source.id} value={source.name}>
                    {source.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Qualification Status */}
          <div>
            <label className="text-sm font-medium">Qualification Status</label>
            <Select 
              value={formData.qualification_status} 
              onValueChange={(value) => handleInputChange("qualification_status", value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select status..." />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="unqualified">Unqualified</SelectItem>
                <SelectItem value="qualified">Qualified / Interested</SelectItem>
                <SelectItem value="old_roof_marketing">Old Roof Marketing</SelectItem>
                <SelectItem value="storm_damage_marketing">Storm Damage Marketing</SelectItem>
                <SelectItem value="new_roof">New Roof</SelectItem>
                <SelectItem value="not_interested">Not Interested</SelectItem>
                <SelectItem value="follow_up">Follow Up</SelectItem>
                <SelectItem value="contacted">Contacted</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Assign to Sales Rep - visible to all users */}
          <div>
            <label className="text-sm font-medium">Assign to Sales Rep</label>
            <Select value={assignedTo} onValueChange={setAssignedTo}>
              <SelectTrigger>
                <SelectValue placeholder="Select sales rep..." />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                {tenantUsers.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Address Verification */}
          <div>
            <AddressVerification
              onAddressVerified={handleAddressVerified}
              label="Contact Address"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="text-sm font-medium">Tags</label>
            <div className="flex gap-2 mb-2">
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="Add a tag"
                onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
              />
              <Button type="button" onClick={addTag} variant="outline">
                Add
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {formData.tags?.map((tag, index) => (
                <Badge
                  key={index}
                  variant="secondary"
                  className="cursor-pointer"
                  onClick={() => removeTag(tag)}
                >
                  {tag} ×
                </Badge>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-sm font-medium">Notes</label>
            <Textarea
              value={formData.notes}
              onChange={(e) => handleInputChange("notes", e.target.value)}
              placeholder="Add any additional notes about this contact"
              rows={3}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-4 pt-4">
            <Button
              type="submit"
              disabled={isSubmitting}
              className="flex-1"
              data-testid={TEST_IDS.contacts.form.submit}
            >
              {isSubmitting ? (
                "Creating Contact..."
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Create Contact
                </>
              )}
            </Button>
            {onCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={isSubmitting}
                data-testid={TEST_IDS.contacts.form.cancel}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

export default ContactForm;
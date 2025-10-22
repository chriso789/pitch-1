import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { UserPlus, Save, MapPin } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { default as AddressVerification } from "@/shared/components/forms/AddressVerification";
import { auditService } from "@/services/auditService";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { TEST_IDS } from "../../../../tests/utils/test-ids";

interface ContactFormData {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  company_name?: string;
  type: "homeowner" | "contractor" | "supplier" | "inspector" | "other";
  lead_source?: string;
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
  const { toast } = useToast();

  const [formData, setFormData] = useState<ContactFormData>({
    first_name: initialData.first_name || "",
    last_name: initialData.last_name || "",
    email: initialData.email || "",
    phone: initialData.phone || "",
    company_name: initialData.company_name || "",
    type: initialData.type || "homeowner",
    lead_source: initialData.lead_source || "",
    notes: initialData.notes || "",
    tags: initialData.tags || [],
  });

  const [addressData, setAddressData] = useState<any>(null);
  const [addressVerificationData, setAddressVerificationData] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [assignedTo, setAssignedTo] = useState<string>("");
  const [tenantUsers, setTenantUsers] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [leadSources, setLeadSources] = useState<Array<{ id: string; name: string }>>([]);
  const [leadSourcesLoading, setLeadSourcesLoading] = useState(false);

  // Fetch tenant users for assignment dropdown
  useEffect(() => {
    const fetchTenantUsers = async () => {
      if (!currentUser) return;
      
      // Only fetch users if current user is a manager or admin
      const managerRoles = ['master', 'corporate', 'office_admin', 'regional_manager', 'sales_manager'];
      if (!managerRoles.includes(currentUser.role)) {
        // Auto-assign to self for non-managers
        setAssignedTo(currentUser.id);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, first_name, last_name, email')
          .eq('tenant_id', currentUser.tenant_id)
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
  }, [currentUser]);

  // Fetch active lead sources for dropdown
  useEffect(() => {
    const fetchLeadSources = async () => {
      if (!currentUser?.tenant_id) return;
      
      setLeadSourcesLoading(true);
      try {
        const { data, error } = await supabase
          .from('lead_sources')
          .select('id, name')
          .eq('tenant_id', currentUser.tenant_id)
          .eq('is_active', true)
          .order('name');
        
        if (error) throw error;
        setLeadSources(data || []);
      } catch (error) {
        console.error('Error fetching lead sources:', error);
      } finally {
        setLeadSourcesLoading(false);
      }
    };
    
    fetchLeadSources();
  }, [currentUser]);

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

    setIsSubmitting(true);

    try {
      // Capture audit context before creating contact
      await auditService.captureAuditContext();

      // Get current user and their profile to get tenant_id
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("User not authenticated");

      // Get user profile to fetch tenant_id
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) throw profileError;
      if (!profile?.tenant_id) {
        throw new Error("User profile not found. Please contact support.");
      }

      const contactData = {
        ...formData,
        tenant_id: profile.tenant_id,
        // Address fields
        address_street: addressData?.street || "",
        address_city: addressData?.city || "",
        address_state: addressData?.state || "",
        address_zip: addressData?.zip || "",
        latitude: addressData?.lat,
        longitude: addressData?.lng,
        // Verification data
        verified_address: addressData ? {
          street: addressData.street,
          city: addressData.city,
          state: addressData.state,
          zip: addressData.zip,
          lat: addressData.lat,
          lng: addressData.lng,
          place_id: addressData.place_id,
          formatted_address: addressData.formatted_address,
        } : null,
        address_verification_data: addressVerificationData,
        // User assignment
        assigned_to: assignedTo || null,
        // Ghost account data
        created_by_ghost: isGhostAccount ? user.id : null,
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
      
      let errorMessage = "Failed to create contact.";
      if (error.message?.includes("tenant_id")) {
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
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="h-5 w-5" />
          {isGhostAccount ? "Add Contact (Ghost Mode)" : "Add New Contact"}
          {isGhostAccount && (
            <Badge variant="secondary" className="ml-2">
              Ghost Account
            </Badge>
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
                  <SelectItem value="contractor">Contractor</SelectItem>
                  <SelectItem value="business">Business</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Lead Source */}
          <div>
            <label className="text-sm font-medium">Lead Source</label>
            <Select 
              value={formData.lead_source} 
              onValueChange={(value) => handleInputChange("lead_source", value)}
              disabled={leadSourcesLoading}
            >
              <SelectTrigger data-testid={TEST_IDS.contacts.form.leadSource}>
                <SelectValue placeholder={
                  leadSourcesLoading 
                    ? "Loading lead sources..." 
                    : leadSources.length === 0
                      ? "No lead sources configured"
                      : "Select lead source"
                } />
              </SelectTrigger>
              <SelectContent>
                {leadSources.map((source) => (
                  <SelectItem key={source.id} value={source.name}>
                    {source.name}
                  </SelectItem>
                ))}
                {leadSources.length === 0 && !leadSourcesLoading && (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    No lead sources available. Add them in Settings → Lead Sources.
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Assign To - only show for managers/admins */}
          {currentUser && ['master', 'corporate', 'office_admin', 'regional_manager', 'sales_manager'].includes(currentUser.role) && (
            <div>
              <label className="text-sm font-medium">Assign To</label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger>
                  <SelectValue placeholder="Select user to assign contact..." />
                </SelectTrigger>
                <SelectContent>
                  {tenantUsers.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name} {user.email && `(${user.email})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

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
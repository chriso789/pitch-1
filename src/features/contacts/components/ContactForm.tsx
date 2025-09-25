import React, { useState } from "react";
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

  const { toast } = useToast();

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

    setIsSubmitting(true);

    try {
      const contactData = {
        ...formData,
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
        // Ghost account data
        created_by_ghost: isGhostAccount ? (await supabase.auth.getUser()).data.user?.id : null,
      };

      const { data, error } = await supabase
        .from("contacts")
        .insert([contactData])
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "Contact Created",
        description: `${formData.first_name} ${formData.last_name} has been added to your contacts.`,
      });

      onSubmit?.(data);
    } catch (error: any) {
      console.error("Error creating contact:", error);
      toast({
        title: "Creation Failed",
        description: error.message || "Failed to create contact.",
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
                value={formData.first_name}
                onChange={(e) => handleInputChange("first_name", e.target.value)}
                placeholder="Enter first name"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium">Last Name *</label>
              <Input
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
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => handleInputChange("email", e.target.value)}
                placeholder="Enter email address"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Phone</label>
              <Input
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
            <Input
              value={formData.lead_source}
              onChange={(e) => handleInputChange("lead_source", e.target.value)}
              placeholder="Where did this lead come from?"
            />
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
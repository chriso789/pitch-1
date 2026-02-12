import React, { useState, useEffect, useRef } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { 
  User, 
  Phone, 
  Mail, 
  MapPin, 
  Building2, 
  Edit3, 
  Save, 
  X,
  Calendar,
  Star,
  Tag,
  Briefcase,
  Plus,
  Trash2
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { HomeownerPortalAccess } from "./HomeownerPortalAccess";

interface ContactDetailsTabProps {
  contact: any;
  onContactUpdate: (updatedContact: any) => void;
  triggerEdit?: boolean;
  onTriggerEditConsumed?: () => void;
}

interface FormData {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  secondary_email: string;
  secondary_phone: string;
  additional_emails: { value: string }[];
  additional_phones: { value: string }[];
  company_name: string;
  address_street: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  notes: string;
  lead_source: string;
  tags: string;
}

export const ContactDetailsTab: React.FC<ContactDetailsTabProps> = ({ 
  contact, 
  onContactUpdate,
  triggerEdit,
  onTriggerEditConsumed
}) => {
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (triggerEdit) {
      setIsEditing(true);
      onTriggerEditConsumed?.();
    }
  }, [triggerEdit, onTriggerEditConsumed]);
  const [jobCount, setJobCount] = useState(0);
  const { toast } = useToast();
  
  useEffect(() => {
    if (contact?.id) {
      fetchJobCount();
    }
  }, [contact?.id]);

  const fetchJobCount = async () => {
    try {
      const [pipelineResult, jobsResult] = await Promise.all([
        supabase
          .from('pipeline_entries')
          .select('id')
          .eq('contact_id', contact.id),
        supabase
          .from('projects')
          .select('id, pipeline_entry_id')
          .not('pipeline_entry_id', 'is', null)
      ]);

      const pipelineCount = pipelineResult.data?.length || 0;
      const jobsCount = jobsResult.data?.length || 0;
      setJobCount(pipelineCount + jobsCount);
    } catch (error) {
      console.error('Error fetching job count:', error);
    }
  };

  const getFormDefaults = (c: any): FormData => ({
    first_name: c?.first_name || '',
    last_name: c?.last_name || '',
    email: c?.email || '',
    phone: c?.phone || '',
    secondary_email: c?.secondary_email || '',
    secondary_phone: c?.secondary_phone || '',
    additional_emails: (c?.additional_emails || []).map((e: string) => ({ value: e })),
    additional_phones: (c?.additional_phones || []).map((p: string) => ({ value: p })),
    company_name: c?.company_name || '',
    address_street: c?.address_street || '',
    address_city: c?.address_city || '',
    address_state: c?.address_state || '',
    address_zip: c?.address_zip || '',
    notes: c?.notes || '',
    lead_source: c?.lead_source || '',
    tags: c?.tags?.join(', ') || ''
  });

  const form = useForm<FormData>({
    defaultValues: getFormDefaults(contact)
  });

  // Reset form when contact changes to prevent stale data
  const prevContactId = useRef(contact?.id);
  useEffect(() => {
    if (contact) {
      form.reset(getFormDefaults(contact));
      if (prevContactId.current !== contact.id) {
        setIsEditing(false);
        prevContactId.current = contact.id;
      }
    }
  }, [contact?.id]);

  const { fields: emailFields, append: appendEmail, remove: removeEmail } = useFieldArray({
    control: form.control,
    name: 'additional_emails'
  });

  const { fields: phoneFields, append: appendPhone, remove: removePhone } = useFieldArray({
    control: form.control,
    name: 'additional_phones'
  });

  const onSubmit = async (data: FormData) => {
    try {
      const updateData = {
        first_name: data.first_name,
        last_name: data.last_name,
        email: data.email || null,
        phone: data.phone || null,
        secondary_email: data.secondary_email || null,
        secondary_phone: data.secondary_phone || null,
        additional_emails: data.additional_emails.map(e => e.value).filter(v => v.trim()),
        additional_phones: data.additional_phones.map(p => p.value).filter(v => v.trim()),
        company_name: data.company_name || null,
        address_street: data.address_street || null,
        address_city: data.address_city || null,
        address_state: data.address_state || null,
        address_zip: data.address_zip || null,
        notes: data.notes || null,
        lead_source: data.lead_source || null,
        tags: data.tags ? data.tags.split(',').map((tag: string) => tag.trim()) : []
      };

      const { error } = await supabase
        .from('contacts')
        .update(updateData)
        .eq('id', contact.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Contact updated successfully",
      });

      onContactUpdate({ ...contact, ...updateData });
      setIsEditing(false);
    } catch (error) {
      console.error('Error updating contact:', error);
      toast({
        title: "Error",
        description: "Failed to update contact",
        variant: "destructive",
      });
    }
  };

  const formatAddress = (contact: any) => {
    if (!contact) return 'No address available';
    const parts = [
      contact.address_street,
      contact.address_city,
      contact.address_state,
      contact.address_zip
    ].filter(Boolean);
    return parts.join(', ') || 'No address available';
  };

  // Gather all emails and phones for display
  const allEmails = [
    contact?.email,
    contact?.secondary_email,
    ...(contact?.additional_emails || [])
  ].filter(Boolean);

  // Helper to format phone numbers
  const formatPhoneNumber = (phone: string): string => {
    const cleaned = String(phone).replace(/\D/g, '');
    if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return `(${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }
    return phone;
  };

  // Helper to check if a string is a valid phone number (7-15 digits)
  const isValidPhone = (item: any): boolean => {
    const numericOnly = String(item).replace(/\D/g, '');
    return numericOnly.length >= 7 && numericOnly.length <= 15;
  };

  // Known landline carriers to detect
  const landlineCarriers = ['BELL', 'FRONTIER', 'AT&T', 'VERIZON', 'CENTURYLINK', 'WINDSTREAM', 'CONSOLIDATED', 'EMBARQ'];

  // Parse and clean phone data - filter out carrier names and dates
  const rawPhoneData = [
    contact?.phone,
    contact?.secondary_phone,
    ...(contact?.additional_phones || [])
  ].filter(Boolean);

  // Detect if a phone number is a landline based on adjacent carrier info
  const detectLandline = (phone: string): boolean => {
    const phoneIndex = rawPhoneData.indexOf(phone);
    const surrounding = rawPhoneData.slice(Math.max(0, phoneIndex - 2), phoneIndex + 3);
    return surrounding.some(item => 
      typeof item === 'string' && 
      landlineCarriers.some(carrier => String(item).toUpperCase().includes(carrier))
    );
  };

  // Filter to only valid phone numbers and add metadata
  const parsedPhones = rawPhoneData
    .filter(isValidPhone)
    .map((phone, index) => ({
      number: formatPhoneNumber(String(phone)),
      raw: String(phone),
      isLandline: detectLandline(String(phone)),
      isPrimary: index === 0
    }))
    // Remove duplicates based on raw number
    .filter((phone, index, arr) => 
      arr.findIndex(p => p.raw.replace(/\D/g, '') === phone.raw.replace(/\D/g, '')) === index
    );

  return (
    <div className="space-y-6">
      {/* Homeowner Portal Access */}
      <HomeownerPortalAccess contact={contact} onUpdate={onContactUpdate} />

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card className="shadow-soft">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <Star className="h-4 w-4 text-warning" />
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">Lead Score</p>
                <p className="text-2xl font-bold">{contact?.lead_score || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="shadow-soft">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <Calendar className="h-4 w-4 text-primary" />
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">Created</p>
                <p className="text-sm text-muted-foreground">
                  {contact?.created_at ? new Date(contact.created_at).toLocaleDateString() : 'N/A'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <Tag className="h-4 w-4 text-secondary" />
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">Source</p>
                <p className="text-sm text-muted-foreground">{contact?.lead_source || 'Unknown'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <User className="h-4 w-4 text-success" />
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">Status</p>
                <Badge 
                  className={`text-xs ${
                    contact?.qualification_status === 'qualified' || contact?.qualification_status === 'interested' 
                      ? 'bg-success text-success-foreground' 
                      : contact?.qualification_status === 'storm_damage_marketing'
                      ? 'bg-warning text-warning-foreground'
                      : contact?.qualification_status === 'old_roof_marketing'
                      ? 'bg-primary text-primary-foreground'
                      : contact?.qualification_status === 'not_interested'
                      ? 'bg-destructive text-destructive-foreground'
                      : contact?.qualification_status === 'follow_up'
                      ? 'bg-yellow-500 text-white'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {contact?.qualification_status?.replace(/_/g, ' ') || 'Unqualified'}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <Briefcase className="h-4 w-4 text-primary" />
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">Total Jobs</p>
                <p className="text-2xl font-bold">{jobCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Contact Information */}
      <Card className="shadow-soft">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-lg font-semibold">Contact Information</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (isEditing) {
                setIsEditing(false);
                form.reset(getFormDefaults(contact));
              } else {
                setIsEditing(true);
              }
            }}
            className="flex items-center gap-2"
          >
            {isEditing ? (
              <>
                <X className="h-4 w-4" />
                Cancel
              </>
            ) : (
              <>
                <Edit3 className="h-4 w-4" />
                Edit
              </>
            )}
          </Button>
        </CardHeader>
        <CardContent>
          {isEditing ? (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="first_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>First Name</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="last_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last Name</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Email Section */}
                <div className="space-y-3">
                  <FormLabel className="text-sm font-medium flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    Email Addresses
                  </FormLabel>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <div className="relative">
                              <Input type="email" placeholder="Primary email" {...field} />
                              <Badge className="absolute right-2 top-1/2 -translate-y-1/2 text-xs" variant="secondary">Primary</Badge>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={form.control}
                      name="secondary_email"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input type="email" placeholder="Secondary email" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {emailFields.map((field, index) => (
                    <div key={field.id} className="flex gap-2">
                      <FormField
                        control={form.control}
                        name={`additional_emails.${index}.value`}
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormControl>
                              <Input type="email" placeholder={`Additional email ${index + 1}`} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeEmail(index)}
                        className="text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => appendEmail({ value: '' })}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Email
                  </Button>
                </div>

                {/* Phone Section */}
                <div className="space-y-3">
                  <FormLabel className="text-sm font-medium flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    Phone Numbers
                  </FormLabel>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <div className="relative">
                              <Input placeholder="Primary phone" {...field} />
                              <Badge className="absolute right-2 top-1/2 -translate-y-1/2 text-xs" variant="secondary">Primary</Badge>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={form.control}
                      name="secondary_phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input placeholder="Secondary phone" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {phoneFields.map((field, index) => (
                    <div key={field.id} className="flex gap-2">
                      <FormField
                        control={form.control}
                        name={`additional_phones.${index}.value`}
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormControl>
                              <Input placeholder={`Additional phone ${index + 1}`} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removePhone(index)}
                        className="text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => appendPhone({ value: '' })}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Phone
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="company_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="lead_source"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Lead Source</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="space-y-4">
                  <FormField
                    control={form.control}
                    name="address_street"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Street Address</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name="address_city"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>City</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={form.control}
                      name="address_state"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>State</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={form.control}
                      name="address_zip"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>ZIP Code</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  
                  <FormField
                    control={form.control}
                    name="tags"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tags (comma separated)</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="residential, referral, high-priority" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes</FormLabel>
                        <FormControl>
                          <Textarea {...field} rows={3} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="flex gap-2 pt-4">
                  <Button type="submit" className="gradient-primary">
                    <Save className="h-4 w-4 mr-2" />
                    Save Changes
                  </Button>
                </div>
              </form>
            </Form>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <User className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">Full Name</p>
                      <p className="font-medium">
                        {contact?.first_name} {contact?.last_name}
                      </p>
                    </div>
                  </div>

                  {/* Email Display - Show all emails */}
                  {allEmails.length > 0 && (
                    <div className="flex items-start gap-3">
                      <Mail className="h-5 w-5 text-muted-foreground mt-1" />
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">
                          Email{allEmails.length > 1 ? 's' : ''}
                        </p>
                        {allEmails.map((email, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <p className="font-medium">{email}</p>
                            {index === 0 && allEmails.length > 1 && (
                              <Badge variant="secondary" className="text-xs">Primary</Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Phone Display - Show only valid phone numbers */}
                  {parsedPhones.length > 0 && (
                    <div className="flex items-start gap-3">
                      <Phone className="h-5 w-5 text-muted-foreground mt-1" />
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">
                          Phone{parsedPhones.length > 1 ? 's' : ''}
                        </p>
                        {parsedPhones.map((phone, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <p className="font-medium">{phone.number}</p>
                            {phone.isPrimary && parsedPhones.length > 1 && (
                              <Badge className="text-xs bg-orange-500 hover:bg-orange-600">Primary</Badge>
                            )}
                            {phone.isLandline && (
                              <Badge variant="outline" className="text-xs text-green-600 border-green-600">
                                Landline ✓
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {contact?.company_name && (
                    <div className="flex items-center gap-3">
                      <Building2 className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="text-sm text-muted-foreground">Company</p>
                        <p className="font-medium">{contact.company_name}</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <MapPin className="h-5 w-5 text-muted-foreground mt-1" />
                    <div>
                      <p className="text-sm text-muted-foreground">Address</p>
                      <p className="font-medium">{formatAddress(contact)}</p>
                    </div>
                  </div>

                  {contact?.tags && contact.tags.length > 0 && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-2">Tags</p>
                      <div className="flex flex-wrap gap-2">
                        {contact.tags.map((tag: string, index: number) => (
                          <Badge key={index} variant="outline">{tag}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {contact?.notes && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-2">Notes</p>
                      <p className="text-sm whitespace-pre-wrap">{contact.notes}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

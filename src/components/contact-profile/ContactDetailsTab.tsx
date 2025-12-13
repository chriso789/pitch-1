import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Briefcase
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { HomeownerPortalAccess } from "./HomeownerPortalAccess";

interface ContactDetailsTabProps {
  contact: any;
  onContactUpdate: (updatedContact: any) => void;
}

export const ContactDetailsTab: React.FC<ContactDetailsTabProps> = ({ 
  contact, 
  onContactUpdate 
}) => {
  const [isEditing, setIsEditing] = useState(false);
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

  const form = useForm({
    defaultValues: {
      first_name: contact?.first_name || '',
      last_name: contact?.last_name || '',
      email: contact?.email || '',
      phone: contact?.phone || '',
      company_name: contact?.company_name || '',
      address_street: contact?.address_street || '',
      address_city: contact?.address_city || '',
      address_state: contact?.address_state || '',
      address_zip: contact?.address_zip || '',
      notes: contact?.notes || '',
      lead_source: contact?.lead_source || '',
      tags: contact?.tags?.join(', ') || ''
    }
  });

  const onSubmit = async (data: any) => {
    try {
      const { error } = await supabase
        .from('contacts')
        .update({
          ...data,
          tags: data.tags ? data.tags.split(',').map((tag: string) => tag.trim()) : []
        })
        .eq('id', contact.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Contact updated successfully",
      });

      onContactUpdate({ ...contact, ...data });
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
                form.reset();
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
                  
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
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

                  {contact?.email && (
                    <div className="flex items-center gap-3">
                      <Mail className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="text-sm text-muted-foreground">Email</p>
                        <p className="font-medium">{contact.email}</p>
                      </div>
                    </div>
                  )}

                  {contact?.phone && (
                    <div className="flex items-center gap-3">
                      <Phone className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="text-sm text-muted-foreground">Phone</p>
                        <p className="font-medium">{contact.phone}</p>
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
                          <Badge key={index} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {contact?.notes && (
                <div className="pt-4 border-t">
                  <p className="text-sm text-muted-foreground mb-2">Notes</p>
                  <p className="text-sm bg-muted/50 p-3 rounded-md">{contact.notes}</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
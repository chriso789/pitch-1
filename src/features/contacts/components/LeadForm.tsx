import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface LeadFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLeadCreated?: () => void;
}

const jobTypes = [
  { value: 'roof_replacement', label: 'Full Roof Replacement' },
  { value: 'roof_repair', label: 'Roof Repair' },
  { value: 'gutters', label: 'Gutter Installation/Repair' },
  { value: 'interior_paint', label: 'Interior Painting' },
  { value: 'exterior_paint', label: 'Exterior Painting' },
  { value: 'siding', label: 'Siding Installation/Repair' },
  { value: 'windows', label: 'Window Replacement' },
  { value: 'storm_damage', label: 'Storm Damage Repair' }
];

const roofTypes = [
  { value: 'asphalt_shingle', label: 'Asphalt Shingle' },
  { value: 'metal', label: 'Metal Roofing' },
  { value: 'tile', label: 'Tile (Clay/Concrete)' },
  { value: 'slate', label: 'Slate' },
  { value: 'wood_shake', label: 'Wood Shake/Shingle' },
  { value: 'flat_membrane', label: 'Flat/Membrane' },
  { value: 'unknown', label: 'Unknown/Unsure' }
];

const leadSources = [
  { value: 'google_ads', label: 'Google Ads' },
  { value: 'facebook_ads', label: 'Facebook Ads' },
  { value: 'referral', label: 'Customer Referral' },
  { value: 'door_to_door', label: 'Door to Door' },
  { value: 'website', label: 'Website Contact' },
  { value: 'phone_call', label: 'Incoming Phone Call' },
  { value: 'other', label: 'Other' }
];

export function LeadForm({ open, onOpenChange, onLeadCreated }: LeadFormProps) {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    roofAge: '',
    street: '',
    city: '',
    state: '',
    zipCode: '',
    leadSource: '',
    jobType: '',
    currentRoofType: '',
    estimatedValue: '',
    urgency: '',
    notes: '',
    appointmentDate: undefined as Date | undefined,
    appointmentTime: ''
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    try {
      setIsSubmitting(true);

      // Check authentication first
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        toast({
          title: "Authentication required",
          description: "Please log in to create leads.",
          variant: "destructive",
        });
        return;
      }

      // Get user profile to get tenant_id
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', session.user.id)
        .single();

      if (profileError || !profile?.tenant_id) {
        console.error('Profile error:', profileError);
        toast({
          title: "Profile error",
          description: "Unable to find your account profile. Please contact support.",
          variant: "destructive",
        });
        return;
      }

      // Validate required fields
      if (!formData.firstName || !formData.lastName || !formData.phone || !formData.roofAge) {
        toast({
          title: "Missing required fields",
          description: "Please fill in first name, last name, phone number, and roof age.",
          variant: "destructive",
        });
        return;
      }

      // Validate roof age range
      const roofAgeNum = parseInt(formData.roofAge);
      if (isNaN(roofAgeNum) || roofAgeNum < 0 || roofAgeNum > 100) {
        toast({
          title: "Invalid roof age",
          description: "Roof age must be between 0 and 100 years.",
          variant: "destructive",
        });
        return;
      }

      console.log('Creating lead with tenant_id:', profile.tenant_id);

      // Calculate basic lead score
      let leadScore = 50;
      if (formData.email && formData.phone) leadScore += 20;
      if (formData.urgency === 'immediate') leadScore += 20;
      if (formData.leadSource === 'referral') leadScore += 10;

      // Create contact first with explicit tenant_id
      const { data: contact, error: contactError } = await supabase
        .from('contacts')
        .insert({
          tenant_id: profile.tenant_id,
          first_name: formData.firstName,
          last_name: formData.lastName,
          email: formData.email || null,
          phone: formData.phone,
          address_street: formData.street || null,
          address_city: formData.city || null,
          address_state: formData.state || null,
          address_zip: formData.zipCode || null,
          lead_source: formData.leadSource,
          type: 'homeowner',
          lead_score: leadScore,
          notes: formData.notes || null,
          metadata: {
            job_type: formData.jobType,
            current_roof_type: formData.currentRoofType,
            urgency_level: formData.urgency,
            estimated_value: formData.estimatedValue,
            roof_age_years: parseInt(formData.roofAge)
          }
        })
        .select()
        .single();

      if (contactError) {
        console.error('Contact creation error:', contactError);
        throw contactError;
      }

      console.log('Contact created successfully:', contact.id);

      // Create basic pipeline entry with explicit tenant_id
      const { data: pipelineEntry, error: pipelineError } = await supabase
        .from('pipeline_entries')
        .insert({
          tenant_id: profile.tenant_id,
          contact_id: contact.id,
          status: 'lead',
          priority: formData.urgency === 'immediate' ? 'urgent' : 'medium',
          lead_quality_score: leadScore,
          estimated_value: formData.estimatedValue ? parseFloat(formData.estimatedValue) : null,
          metadata: {
            roof_age_years: parseInt(formData.roofAge)
          }
        })
        .select()
        .single();

      if (pipelineError) {
        console.error('Pipeline entry creation error:', pipelineError);
        throw pipelineError;
      }

      console.log('Pipeline entry created successfully:', pipelineEntry.id);

      toast({
        title: "Lead created successfully!",
        description: `${formData.firstName} ${formData.lastName} has been added with a lead score of ${leadScore}.`,
      });

      // Reset form and close
      setFormData({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        roofAge: '',
        street: '',
        city: '',
        state: '',
        zipCode: '',
        leadSource: '',
        jobType: '',
        currentRoofType: '',
        estimatedValue: '',
        urgency: '',
        notes: '',
        appointmentDate: undefined,
        appointmentTime: ''
      });
      
      onOpenChange(false);
      if (onLeadCreated) onLeadCreated();

    } catch (error) {
      console.error('Error creating lead:', error);
      toast({
        title: "Error creating lead",
        description: "Please try again or contact support.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Add New Lead
          </DialogTitle>
          <DialogDescription>
            Collect lead information and create a new contact
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="firstName">First Name *</Label>
              <Input
                id="firstName"
                value={formData.firstName}
                onChange={(e) => handleInputChange('firstName', e.target.value)}
                placeholder="Enter first name"
              />
            </div>
            <div>
              <Label htmlFor="lastName">Last Name *</Label>
              <Input
                id="lastName"
                value={formData.lastName}
                onChange={(e) => handleInputChange('lastName', e.target.value)}
                placeholder="Enter last name"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => handleInputChange('email', e.target.value)}
                placeholder="Enter email address"
              />
            </div>
            <div>
              <Label htmlFor="phone">Phone Number *</Label>
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => handleInputChange('phone', e.target.value)}
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
              onChange={(e) => handleInputChange('roofAge', e.target.value)}
              placeholder="e.g., 15"
            />
          </div>

          <div>
            <Label htmlFor="street">Street Address</Label>
            <Input
              id="street"
              value={formData.street}
              onChange={(e) => handleInputChange('street', e.target.value)}
              placeholder="Enter street address"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => handleInputChange('city', e.target.value)}
                placeholder="City"
              />
            </div>
            <div>
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                value={formData.state}
                onChange={(e) => handleInputChange('state', e.target.value)}
                placeholder="TX"
              />
            </div>
            <div>
              <Label htmlFor="zipCode">ZIP Code</Label>
              <Input
                id="zipCode"
                value={formData.zipCode}
                onChange={(e) => handleInputChange('zipCode', e.target.value)}
                placeholder="12345"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="leadSource">Lead Source</Label>
              <Select value={formData.leadSource} onValueChange={(value) => handleInputChange('leadSource', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select lead source" />
                </SelectTrigger>
                <SelectContent>
                  {leadSources.map(source => (
                    <SelectItem key={source.value} value={source.value}>
                      {source.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="jobType">Job Type</Label>
              <Select value={formData.jobType} onValueChange={(value) => handleInputChange('jobType', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select job type" />
                </SelectTrigger>
                <SelectContent>
                  {jobTypes.map(job => (
                    <SelectItem key={job.value} value={job.value}>
                      {job.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="currentRoofType">Current Roof Type</Label>
              <Select value={formData.currentRoofType} onValueChange={(value) => handleInputChange('currentRoofType', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select roof type" />
                </SelectTrigger>
                <SelectContent>
                  {roofTypes.map(roof => (
                    <SelectItem key={roof.value} value={roof.value}>
                      {roof.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="urgency">Urgency Level</Label>
              <Select value={formData.urgency} onValueChange={(value) => handleInputChange('urgency', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select urgency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="immediate">Immediate (Active leak)</SelectItem>
                  <SelectItem value="urgent">Urgent (1-2 weeks)</SelectItem>
                  <SelectItem value="moderate">Moderate (1-3 months)</SelectItem>
                  <SelectItem value="planning">Planning (3+ months)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="estimatedValue">Estimated Project Value</Label>
            <Input
              id="estimatedValue"
              value={formData.estimatedValue}
              onChange={(e) => handleInputChange('estimatedValue', e.target.value)}
              placeholder="e.g., 15000"
            />
          </div>

          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => handleInputChange('notes', e.target.value)}
              placeholder="Additional notes about this lead..."
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Appointment Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !formData.appointmentDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.appointmentDate ? format(formData.appointmentDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formData.appointmentDate}
                    onSelect={(date) => handleInputChange('appointmentDate', date)}
                    disabled={(date) => date < new Date()}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label htmlFor="appointmentTime">Appointment Time</Label>
              <Select value={formData.appointmentTime} onValueChange={(value) => handleInputChange('appointmentTime', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select time" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="8:00 AM">8:00 AM</SelectItem>
                  <SelectItem value="9:00 AM">9:00 AM</SelectItem>
                  <SelectItem value="10:00 AM">10:00 AM</SelectItem>
                  <SelectItem value="11:00 AM">11:00 AM</SelectItem>
                  <SelectItem value="1:00 PM">1:00 PM</SelectItem>
                  <SelectItem value="2:00 PM">2:00 PM</SelectItem>
                  <SelectItem value="3:00 PM">3:00 PM</SelectItem>
                  <SelectItem value="4:00 PM">4:00 PM</SelectItem>
                  <SelectItem value="5:00 PM">5:00 PM</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !formData.firstName || !formData.lastName || !formData.phone || !formData.roofAge}
            className="gradient-primary"
          >
            {isSubmitting ? 'Creating Lead...' : 'Create Lead'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
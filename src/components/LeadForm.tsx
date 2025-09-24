import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CalendarIcon, Phone, Mail, MapPin, Home, DollarSign, Clock, User, Star } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface LeadFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLeadCreated?: () => void;
}

interface LeadFormData {
  // Basic Contact Info
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  
  // Address
  street: string;
  city: string;
  state: string;
  zipCode: string;
  
  // Lead Details
  leadSource: string;
  jobType: string;
  currentRoofType: string;
  roofAge: string;
  estimatedValue: string;
  urgency: string;
  
  // Lead Scoring Metrics
  budgetRange: string;
  timeframe: string;
  decisionMaker: boolean;
  competitorQuotes: string;
  
  // Notes & Additional Info
  notes: string;
  
  // Appointment
  appointmentDate?: Date;
  appointmentTime?: string;
  appointmentType: string;
}

const jobTypes = [
  { value: 'roof_replacement', label: 'Full Roof Replacement' },
  { value: 'roof_repair', label: 'Roof Repair' },
  { value: 'gutters', label: 'Gutter Installation/Repair' },
  { value: 'interior_paint', label: 'Interior Painting' },
  { value: 'exterior_paint', label: 'Exterior Painting' },
  { value: 'siding', label: 'Siding Installation/Repair' },
  { value: 'windows', label: 'Window Replacement' },
  { value: 'insulation', label: 'Insulation Services' },
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
  { value: 'trade_show', label: 'Trade Show/Event' },
  { value: 'yellow_pages', label: 'Yellow Pages' },
  { value: 'nextdoor', label: 'Nextdoor App' },
  { value: 'other', label: 'Other' }
];

const urgencyLevels = [
  { value: 'immediate', label: 'Immediate (Active leak)', color: 'destructive' },
  { value: 'urgent', label: 'Urgent (1-2 weeks)', color: 'secondary' },
  { value: 'moderate', label: 'Moderate (1-3 months)', color: 'default' },
  { value: 'planning', label: 'Planning (3+ months)', color: 'outline' }
];

const timeSlots = [
  '8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM',
  '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM'
];

export function LeadForm({ open, onOpenChange, onLeadCreated }: LeadFormProps) {
  const [formData, setFormData] = useState<LeadFormData>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    street: '',
    city: '',
    state: '',
    zipCode: '',
    leadSource: '',
    jobType: '',
    currentRoofType: '',
    roofAge: '',
    estimatedValue: '',
    urgency: '',
    budgetRange: '',
    timeframe: '',
    decisionMaker: false,
    competitorQuotes: '',
    notes: '',
    appointmentType: 'estimate'
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const { toast } = useToast();

  const handleInputChange = (field: keyof LeadFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const calculateLeadScore = () => {
    let score = 0;
    
    // Budget range scoring
    if (formData.budgetRange === '10000+') score += 25;
    else if (formData.budgetRange === '5000-10000') score += 20;
    else if (formData.budgetRange === '2000-5000') score += 15;
    else if (formData.budgetRange === '1000-2000') score += 10;
    
    // Urgency scoring
    if (formData.urgency === 'immediate') score += 25;
    else if (formData.urgency === 'urgent') score += 20;
    else if (formData.urgency === 'moderate') score += 10;
    
    // Decision maker bonus
    if (formData.decisionMaker) score += 15;
    
    // Timeframe scoring
    if (formData.timeframe === 'immediate') score += 20;
    else if (formData.timeframe === '1-month') score += 15;
    else if (formData.timeframe === '1-3months') score += 10;
    
    // Complete contact info bonus
    if (formData.email && formData.phone) score += 10;
    
    // Lead source quality
    if (['referral', 'website'].includes(formData.leadSource)) score += 5;
    
    return Math.min(100, score);
  };

  const handleSubmit = async () => {
    try {
      setIsSubmitting(true);

      // Validate required fields
      if (!formData.firstName || !formData.lastName || !formData.phone) {
        toast({
          title: "Missing required fields",
          description: "Please fill in first name, last name, and phone number.",
          variant: "destructive",
        });
        return;
      }

      const leadScore = calculateLeadScore();

      // Create contact first
      const { data: contact, error: contactError } = await supabase
        .from('contacts')
        .insert({
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
            roof_age: formData.roofAge,
            urgency_level: formData.urgency,
            budget_range: formData.budgetRange,
            timeframe: formData.timeframe,
            is_decision_maker: formData.decisionMaker,
            competitor_quotes: formData.competitorQuotes
          }
        })
        .select()
        .single();

      if (contactError) throw contactError;

      // Get tenant info
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile?.tenant_id) throw new Error('No tenant found');

      // Create pipeline entry
      const { data: pipelineEntry, error: pipelineError } = await supabase
        .from('pipeline_entries')
        .insert({
          contact_id: contact.id,
          status: 'lead',
          priority: formData.urgency === 'immediate' ? 'urgent' : formData.urgency === 'urgent' ? 'high' : 'medium',
          lead_quality_score: leadScore,
          estimated_value: formData.estimatedValue ? parseFloat(formData.estimatedValue) : null,
          source: formData.leadSource,
          roof_type: formData.currentRoofType,
          probability_percent: urgencyLevels.find(u => u.value === formData.urgency) ? 
            (formData.urgency === 'immediate' ? 90 : formData.urgency === 'urgent' ? 70 : 50) : 50
        })
        .select()
        .single();

      if (pipelineError) throw pipelineError;

        // Create appointment if scheduled
        if (formData.appointmentDate && formData.appointmentTime) {
          const appointmentDateTime = new Date(formData.appointmentDate);
          const [time, period] = formData.appointmentTime.split(' ');
          const [hours, minutes] = time.split(':');
          let hour = parseInt(hours);
          if (period === 'PM' && hour !== 12) hour += 12;
          if (period === 'AM' && hour === 12) hour = 0;
          
          appointmentDateTime.setHours(hour, parseInt(minutes || '0'));

          await supabase
            .from('pipeline_activities')
            .insert({
              tenant_id: profile.tenant_id,
              pipeline_entry_id: pipelineEntry.id,
              contact_id: contact.id,
              activity_type: 'meeting',
              title: `${formData.appointmentType === 'estimate' ? 'Estimate' : 'Consultation'} Appointment`,
              description: `Scheduled ${formData.appointmentType} with ${formData.firstName} ${formData.lastName}`,
              scheduled_at: appointmentDateTime.toISOString(),
              status: 'scheduled',
              priority: 'high'
            });

        // TODO: Integrate with Google Calendar API here
        // This would require setting up Google Calendar API credentials
        // and implementing the calendar event creation logic
      }

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
        street: '',
        city: '',
        state: '',
        zipCode: '',
        leadSource: '',
        jobType: '',
        currentRoofType: '',
        roofAge: '',
        estimatedValue: '',
        urgency: '',
        budgetRange: '',
        timeframe: '',
        decisionMaker: false,
        competitorQuotes: '',
        notes: '',
        appointmentType: 'estimate'
      });
      setCurrentStep(1);
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

  const renderStep1 = () => (
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
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-4">
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
          <Label htmlFor="roofAge">Roof Age (Years)</Label>
          <Input
            id="roofAge"
            value={formData.roofAge}
            onChange={(e) => handleInputChange('roofAge', e.target.value)}
            placeholder="e.g., 15"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="urgency">Urgency Level</Label>
        <Select value={formData.urgency} onValueChange={(value) => handleInputChange('urgency', value)}>
          <SelectTrigger>
            <SelectValue placeholder="Select urgency level" />
          </SelectTrigger>
          <SelectContent>
            {urgencyLevels.map(urgency => (
              <SelectItem key={urgency.value} value={urgency.value}>
                <div className="flex items-center gap-2">
                  <Badge variant={urgency.color as any}>{urgency.label}</Badge>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="budgetRange">Budget Range</Label>
          <Select value={formData.budgetRange} onValueChange={(value) => handleInputChange('budgetRange', value)}>
            <SelectTrigger>
              <SelectValue placeholder="Select budget range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="under-1000">Under $1,000</SelectItem>
              <SelectItem value="1000-2000">$1,000 - $2,000</SelectItem>
              <SelectItem value="2000-5000">$2,000 - $5,000</SelectItem>
              <SelectItem value="5000-10000">$5,000 - $10,000</SelectItem>
              <SelectItem value="10000+">$10,000+</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="timeframe">Project Timeframe</Label>
          <Select value={formData.timeframe} onValueChange={(value) => handleInputChange('timeframe', value)}>
            <SelectTrigger>
              <SelectValue placeholder="Select timeframe" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="immediate">Immediate</SelectItem>
              <SelectItem value="1-month">Within 1 month</SelectItem>
              <SelectItem value="1-3months">1-3 months</SelectItem>
              <SelectItem value="3-6months">3-6 months</SelectItem>
              <SelectItem value="6months+">6+ months</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <input
          id="decisionMaker"
          type="checkbox"
          checked={formData.decisionMaker}
          onChange={(e) => handleInputChange('decisionMaker', e.target.checked)}
          className="rounded"
        />
        <Label htmlFor="decisionMaker">This person is the primary decision maker</Label>
      </div>

      <div>
        <Label htmlFor="competitorQuotes">Competitor Quotes</Label>
        <Select value={formData.competitorQuotes} onValueChange={(value) => handleInputChange('competitorQuotes', value)}>
          <SelectTrigger>
            <SelectValue placeholder="How many quotes do they have?" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No other quotes</SelectItem>
            <SelectItem value="1">1 other quote</SelectItem>
            <SelectItem value="2-3">2-3 other quotes</SelectItem>
            <SelectItem value="4+">4+ other quotes</SelectItem>
          </SelectContent>
        </Select>
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
    </div>
  );

  const renderStep4 = () => (
    <div className="space-y-4">
      <div className="text-center mb-4">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Star className="h-5 w-5 text-yellow-500" />
          <span className="text-lg font-semibold">Lead Score: {calculateLeadScore()}/100</span>
        </div>
        <p className="text-sm text-muted-foreground">
          {calculateLeadScore() >= 80 ? 'High Quality Lead' : 
           calculateLeadScore() >= 60 ? 'Medium Quality Lead' : 'Needs Nurturing'}
        </p>
      </div>

      <Separator />

      <div>
        <Label htmlFor="appointmentType">Appointment Type</Label>
        <Select value={formData.appointmentType} onValueChange={(value) => handleInputChange('appointmentType', value)}>
          <SelectTrigger>
            <SelectValue placeholder="Select appointment type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="estimate">Free Estimate</SelectItem>
            <SelectItem value="consultation">Consultation Call</SelectItem>
            <SelectItem value="inspection">Property Inspection</SelectItem>
          </SelectContent>
        </Select>
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
              {timeSlots.map(time => (
                <SelectItem key={time} value={time}>
                  {time}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="bg-muted/50 p-3 rounded-lg">
        <p className="text-sm text-muted-foreground mb-2">
          <strong>Note:</strong> Google Calendar integration will automatically:
        </p>
        <ul className="text-xs text-muted-foreground space-y-1 ml-4">
          <li>• Check for scheduling conflicts</li>
          <li>• Send calendar invites to customer</li>
          <li>• Set automatic reminders</li>
          <li>• Block time in rep's calendar</li>
        </ul>
      </div>
    </div>
  );

  const isStepValid = (step: number) => {
    switch (step) {
      case 1:
        return formData.firstName && formData.lastName && formData.phone;
      case 2:
        return formData.leadSource && formData.jobType;
      case 3:
        return true; // Optional step
      case 4:
        return true; // Optional step
      default:
        return false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Add New Lead
          </DialogTitle>
          <DialogDescription>
            Collect comprehensive lead information and schedule follow-up appointments
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-center mb-6">
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4].map((step) => (
              <React.Fragment key={step}>
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
                  currentStep >= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}>
                  {step}
                </div>
                {step < 4 && <div className="w-8 h-px bg-border" />}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          {currentStep === 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Contact Information
                </CardTitle>
              </CardHeader>
              <CardContent>{renderStep1()}</CardContent>
            </Card>
          )}

          {currentStep === 2 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Home className="h-4 w-4" />
                  Project Details
                </CardTitle>
              </CardHeader>
              <CardContent>{renderStep2()}</CardContent>
            </Card>
          )}

          {currentStep === 3 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Lead Qualification
                </CardTitle>
              </CardHeader>
              <CardContent>{renderStep3()}</CardContent>
            </Card>
          )}

          {currentStep === 4 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Schedule Appointment
                </CardTitle>
              </CardHeader>
              <CardContent>{renderStep4()}</CardContent>
            </Card>
          )}
        </div>

        <div className="flex justify-between pt-4">
          <Button
            variant="outline"
            onClick={() => setCurrentStep(prev => Math.max(1, prev - 1))}
            disabled={currentStep === 1}
          >
            Previous
          </Button>
          
          <div className="flex gap-2">
            {currentStep < 4 ? (
              <Button
                onClick={() => setCurrentStep(prev => prev + 1)}
                disabled={!isStepValid(currentStep)}
              >
                Next
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || !isStepValid(1)}
                className="gradient-primary"
              >
                {isSubmitting ? 'Creating Lead...' : 'Create Lead'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
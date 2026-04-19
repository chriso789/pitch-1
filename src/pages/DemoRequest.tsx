import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, ArrowLeft, CheckCircle, Mail, Building, User, Phone, CalendarIcon, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const TIME_OPTIONS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30', '17:00',
];

type Slot = { date: Date | undefined; time: string };

const DemoRequest: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'form' | 'schedule' | 'done'>('form');
  const [demoRequestId, setDemoRequestId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    companyName: '',
    jobTitle: '',
    message: ''
  });

  const [slots, setSlots] = useState<Slot[]>([
    { date: undefined, time: '10:00' },
    { date: undefined, time: '14:00' },
    { date: undefined, time: '11:00' },
  ]);

  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const validateForm = () => {
    const newErrors: { [key: string]: string } = {};
    if (!formData.firstName.trim()) newErrors.firstName = 'First name is required';
    if (!formData.lastName.trim()) newErrors.lastName = 'Last name is required';
    if (!formData.email.trim()) newErrors.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) newErrors.email = 'Please enter a valid email address';
    if (!formData.companyName.trim()) newErrors.companyName = 'Company name is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setLoading(true);
    try {
      const { data, error: dbError } = await supabase.from('demo_requests').insert({
        first_name: formData.firstName,
        last_name: formData.lastName,
        email: formData.email,
        phone: formData.phone || null,
        company_name: formData.companyName,
        job_title: formData.jobTitle || null,
        message: formData.message || null,
        email_sent: false,
        interview_status: 'pending',
      }).select('id').single();

      if (dbError) throw dbError;
      setDemoRequestId(data.id);
      setStep('schedule');
    } catch (error: any) {
      console.error('Demo request error:', error);
      toast({
        title: "Request failed",
        description: "There was an error submitting your request. Please try again.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const combineSlot = (slot: Slot): Date | null => {
    if (!slot.date) return null;
    const [h, m] = slot.time.split(':').map(Number);
    const d = new Date(slot.date);
    d.setHours(h, m, 0, 0);
    return d;
  };

  const handleScheduleSubmit = async () => {
    const combined = slots.map(combineSlot);
    if (combined.some((s) => !s)) {
      toast({
        title: "Pick all 3 dates",
        description: "Please choose a date for all three preferred time slots.",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const { error } = await supabase
        .from('demo_requests')
        .update({
          preferred_slot_1: combined[0]!.toISOString(),
          preferred_slot_2: combined[1]!.toISOString(),
          preferred_slot_3: combined[2]!.toISOString(),
          timezone: tz,
        })
        .eq('id', demoRequestId!);

      if (error) throw error;

      // Best-effort notification email
      try {
        await supabase.functions.invoke('send-demo-request', {
          body: {
            firstName: formData.firstName,
            lastName: formData.lastName,
            email: formData.email,
            phone: formData.phone,
            companyName: formData.companyName,
            jobTitle: formData.jobTitle,
            message: formData.message,
            preferredSlots: combined.map((d) => d!.toISOString()),
            timezone: tz,
            requestedAt: new Date().toISOString(),
            skipDbInsert: true,
          },
        });
      } catch (emailErr) {
        console.warn('Notification email failed (request still saved):', emailErr);
      }

      setStep('done');
      toast({
        title: "Interview request submitted",
        description: "We'll confirm one of your preferred times shortly.",
      });
    } catch (error: any) {
      console.error('Schedule error:', error);
      toast({
        title: "Failed to save times",
        description: "Please try again.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  // ============== DONE STEP ==============
  if (step === 'done') {
    return (
      <div className="min-h-screen min-h-[100dvh] flex items-center justify-center gradient-hero p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="w-full max-w-md">
          <Card className="shadow-strong border-0 bg-white/95 backdrop-blur-sm">
            <CardHeader className="text-center">
              <div className="mx-auto w-12 h-12 bg-success-light rounded-full flex items-center justify-center mb-4">
                <CheckCircle className="h-6 w-6 text-white" />
              </div>
              <CardTitle className="text-2xl font-semibold text-success">Interview Requested!</CardTitle>
              <CardDescription className="text-base">
                Thank you for your interest in PITCH CRM
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground text-center">
                We've received your request along with your preferred times. Our team will review and send a Google Calendar invite confirming one of your slots within 24 hours.
              </p>
              <p className="text-sm text-muted-foreground text-center">
                Questions? Email <strong>support@pitch-crm.ai</strong>
              </p>
              <Button variant="outline" onClick={() => navigate('/login')} className="w-full">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Login
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ============== SCHEDULE STEP ==============
  if (step === 'schedule') {
    return (
      <div className="min-h-screen min-h-[100dvh] gradient-hero overflow-auto">
        <div className="pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] px-4">
          <div className="w-full max-w-2xl mx-auto py-4">
            <div className="text-center mb-6">
              <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">Pick Your Interview Times</h1>
              <p className="text-white/90 text-base">
                Select 3 preferred date/time slots. We'll confirm one and send a Google Calendar invite.
              </p>
            </div>

            <Card className="shadow-strong border-0 bg-white/95 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-xl">Your Preferred Times</CardTitle>
                <CardDescription>
                  Times shown in your local timezone: <strong>{Intl.DateTimeFormat().resolvedOptions().timeZone}</strong>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {slots.map((slot, idx) => (
                  <div key={idx} className="space-y-3 p-4 border rounded-lg bg-muted/30">
                    <Label className="text-base font-semibold">Option {idx + 1}</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              "h-12 justify-start text-left font-normal",
                              !slot.date && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {slot.date ? format(slot.date, "PPP") : "Pick a date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={slot.date}
                            onSelect={(d) => {
                              const next = [...slots];
                              next[idx] = { ...next[idx], date: d };
                              setSlots(next);
                            }}
                            disabled={(date) => {
                              const today = new Date();
                              today.setHours(0, 0, 0, 0);
                              const day = date.getDay();
                              return date < today || day === 0 || day === 6;
                            }}
                            initialFocus
                            className={cn("p-3 pointer-events-auto")}
                          />
                        </PopoverContent>
                      </Popover>

                      <div className="relative">
                        <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <select
                          value={slot.time}
                          onChange={(e) => {
                            const next = [...slots];
                            next[idx] = { ...next[idx], time: e.target.value };
                            setSlots(next);
                          }}
                          className="h-12 w-full rounded-md border border-input bg-background pl-10 pr-3 text-base"
                        >
                          {TIME_OPTIONS.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                ))}

                <Alert className="bg-blue-50 border-blue-200">
                  <CalendarIcon className="h-4 w-4 text-blue-600" />
                  <AlertDescription className="text-sm">
                    Weekends are unavailable. Interviews are typically 30 minutes via Google Meet.
                  </AlertDescription>
                </Alert>

                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setStep('form')} className="flex-1" disabled={loading}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back
                  </Button>
                  <Button onClick={handleScheduleSubmit} className="flex-1 h-12" disabled={loading}>
                    {loading ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting...</>
                    ) : (
                      <>Submit My Times</>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // ============== FORM STEP ==============
  return (
    <div className="min-h-screen min-h-[100dvh] gradient-hero overflow-auto">
      <div className="pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] px-4">
        <div className="w-full max-w-2xl mx-auto py-4">
          <div className="text-center mb-6">
            <Button
              variant="ghost"
              onClick={() => navigate('/login')}
              className="text-white/80 hover:text-white hover:bg-white/10 mb-4"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Login
            </Button>
            <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">Request PITCH Demo</h1>
            <p className="text-white/90 text-base sm:text-lg">
              Step 1 of 2 — Tell us about your company
            </p>
          </div>

          <Card className="shadow-strong border-0 bg-white/95 backdrop-blur-sm">
            <CardHeader className="text-center pb-4">
              <CardTitle className="text-xl sm:text-2xl font-semibold">Demo Request Form</CardTitle>
              <CardDescription className="text-sm sm:text-base">
                After this, you'll pick 3 preferred times for a brief interview with our team.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleFormSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName" className="text-sm">
                      <User className="h-4 w-4 inline mr-2" />
                      First Name *
                    </Label>
                    <Input
                      id="firstName"
                      type="text"
                      placeholder="Enter your first name"
                      value={formData.firstName}
                      onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                      className={`h-12 text-base ${errors.firstName ? 'border-destructive' : ''}`}
                    />
                    {errors.firstName && <p className="text-sm text-destructive">{errors.firstName}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="lastName" className="text-sm">Last Name *</Label>
                    <Input
                      id="lastName"
                      type="text"
                      placeholder="Enter your last name"
                      value={formData.lastName}
                      onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                      className={`h-12 text-base ${errors.lastName ? 'border-destructive' : ''}`}
                    />
                    {errors.lastName && <p className="text-sm text-destructive">{errors.lastName}</p>}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm">
                    <Mail className="h-4 w-4 inline mr-2" />
                    Email Address *
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="Enter your business email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className={`h-12 text-base ${errors.email ? 'border-destructive' : ''}`}
                  />
                  {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone" className="text-sm">
                    <Phone className="h-4 w-4 inline mr-2" />
                    Phone Number
                  </Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="Enter your phone number"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="h-12 text-base"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="companyName" className="text-sm">
                      <Building className="h-4 w-4 inline mr-2" />
                      Company Name *
                    </Label>
                    <Input
                      id="companyName"
                      type="text"
                      placeholder="Enter your company name"
                      value={formData.companyName}
                      onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                      className={`h-12 text-base ${errors.companyName ? 'border-destructive' : ''}`}
                    />
                    {errors.companyName && <p className="text-sm text-destructive">{errors.companyName}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="jobTitle" className="text-sm">Job Title</Label>
                    <Input
                      id="jobTitle"
                      type="text"
                      placeholder="e.g., Owner, Sales Manager"
                      value={formData.jobTitle}
                      onChange={(e) => setFormData({ ...formData, jobTitle: e.target.value })}
                      className="h-12 text-base"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="message" className="text-sm">Tell us about your business</Label>
                  <Textarea
                    id="message"
                    placeholder="What does your company do? How many users would need access? What's your current CRM?"
                    rows={4}
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    className="text-base"
                  />
                </div>

                <Alert className="bg-blue-50 border-blue-200">
                  <CalendarIcon className="h-4 w-4 text-blue-600" />
                  <AlertDescription className="text-sm">
                    Next: pick 3 preferred times for a brief 30-min interview. We confirm one and send a Google Calendar invite.
                  </AlertDescription>
                </Alert>

                <Button type="submit" className="w-full h-12 text-base" disabled={loading}>
                  {loading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>
                  ) : (
                    <>Continue to Pick Times <CalendarIcon className="ml-2 h-4 w-4" /></>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default DemoRequest;

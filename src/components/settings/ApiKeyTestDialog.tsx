import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Send, CheckCircle, XCircle, Loader2, ExternalLink, Calendar } from 'lucide-react';

interface ApiKeyTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keyName: string;
  webhookUrl: string;
}

interface TestResult {
  success: boolean;
  data?: {
    lead_id?: string;
    contact_id?: string;
    appointment_id?: string;
    is_duplicate?: boolean;
    lead_number?: string;
    assigned_to?: string;
  };
  error?: string;
}

const SERVICE_TYPES = [
  'Roof Replacement',
  'Roof Repair',
  'Inspection',
  'Storm Damage',
  'Gutter Installation',
  'Siding',
  'Other'
];

const TIME_SLOTS = [
  '9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
  '12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM',
  '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM', '5:00 PM'
];

export function ApiKeyTestDialog({ open, onOpenChange, keyName, webhookUrl }: ApiKeyTestDialogProps) {
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  
  // Form fields
  const [apiKey, setApiKey] = useState('');
  const [firstName, setFirstName] = useState('Test');
  const [lastName, setLastName] = useState('Lead');
  const [phone, setPhone] = useState('555-123-4567');
  const [email, setEmail] = useState('test@example.com');
  const [address, setAddress] = useState('123 Main Street');
  const [city, setCity] = useState('Orlando');
  const [state, setState] = useState('FL');
  const [zip, setZip] = useState('32801');
  const [serviceType, setServiceType] = useState('Roof Replacement');
  const [message, setMessage] = useState('This is a test lead from the API testing tool.');
  const [requestAppointment, setRequestAppointment] = useState(false);
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentTime, setAppointmentTime] = useState('10:00 AM');

  // Set default appointment date to tomorrow
  React.useEffect(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setAppointmentDate(tomorrow.toISOString().split('T')[0]);
  }, []);

  const handleTest = async () => {
    if (!apiKey.trim()) {
      toast({
        title: 'API Key Required',
        description: 'Please enter your API key to test the submission',
        variant: 'destructive'
      });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const payload: any = {
        api_key: apiKey.trim(),
        lead: {
          first_name: firstName,
          last_name: lastName,
          phone: phone,
          email: email,
          address: address,
          city: city,
          state: state,
          zip: zip,
          service_type: serviceType,
          message: message,
          lead_source: 'api_test_tool',
          source_url: window.location.origin + '/settings'
        }
      };

      if (requestAppointment && appointmentDate) {
        payload.lead.appointment_date = appointmentDate;
        payload.lead.appointment_time = appointmentTime;
        payload.lead.appointment_notes = 'Test appointment from API testing tool';
      }

      console.log('[ApiKeyTestDialog] Sending test payload:', payload);

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      console.log('[ApiKeyTestDialog] Response:', result);

      setTestResult(result);

      if (result.success) {
        toast({
          title: 'Test Successful!',
          description: `Lead created: ${result.data?.lead_number || result.data?.lead_id}`,
        });
      } else {
        toast({
          title: 'Test Failed',
          description: result.error || 'Unknown error occurred',
          variant: 'destructive'
        });
      }
    } catch (error: any) {
      console.error('[ApiKeyTestDialog] Error:', error);
      setTestResult({
        success: false,
        error: error.message || 'Network error - could not reach webhook'
      });
      toast({
        title: 'Test Failed',
        description: error.message || 'Failed to submit test lead',
        variant: 'destructive'
      });
    } finally {
      setTesting(false);
    }
  };

  const handleClose = () => {
    setTestResult(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" />
            Test API: {keyName}
          </DialogTitle>
          <DialogDescription>
            Send a test lead submission to verify your API key is working correctly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* API Key Input */}
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <Label htmlFor="apiKey" className="text-amber-800 dark:text-amber-200 font-medium">
              Enter Your API Key
            </Label>
            <Input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="pk_live_..."
              className="mt-2 font-mono"
            />
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
              Use the API key you copied when you created it.
            </p>
          </div>

          {/* Lead Details Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="firstName">First Name *</Label>
              <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="lastName">Last Name</Label>
              <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="phone">Phone *</Label>
              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label htmlFor="address">Address</Label>
              <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="city">City</Label>
              <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="state">State</Label>
              <Input id="state" value={state} onChange={(e) => setState(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="zip">ZIP Code</Label>
              <Input id="zip" value={zip} onChange={(e) => setZip(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="serviceType">Service Type</Label>
              <Select value={serviceType} onValueChange={setServiceType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label htmlFor="message">Message</Label>
              <Textarea id="message" value={message} onChange={(e) => setMessage(e.target.value)} rows={2} />
            </div>
          </div>

          {/* Appointment Toggle */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="requestAppointment">Request Appointment</Label>
              </div>
              <Switch
                id="requestAppointment"
                checked={requestAppointment}
                onCheckedChange={setRequestAppointment}
              />
            </div>
            
            {requestAppointment && (
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div>
                  <Label htmlFor="appointmentDate">Date</Label>
                  <Input
                    id="appointmentDate"
                    type="date"
                    value={appointmentDate}
                    onChange={(e) => setAppointmentDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>
                <div>
                  <Label htmlFor="appointmentTime">Time</Label>
                  <Select value={appointmentTime} onValueChange={setAppointmentTime}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_SLOTS.map((time) => (
                        <SelectItem key={time} value={time}>{time}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>

          {/* Test Result */}
          {testResult && (
            <div className={`rounded-lg p-4 ${testResult.success ? 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800'}`}>
              <div className="flex items-center gap-2 mb-2">
                {testResult.success ? (
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                )}
                <span className={`font-medium ${testResult.success ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'}`}>
                  {testResult.success ? 'Test Successful!' : 'Test Failed'}
                </span>
              </div>
              
              {testResult.success && testResult.data && (
                <div className="space-y-1 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Lead Number:</span>
                    <code className="bg-background px-2 py-0.5 rounded text-xs">{testResult.data.lead_number}</code>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Lead ID:</span>
                    <code className="bg-background px-2 py-0.5 rounded text-xs">{testResult.data.lead_id}</code>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Contact ID:</span>
                    <code className="bg-background px-2 py-0.5 rounded text-xs">{testResult.data.contact_id}</code>
                  </div>
                  {testResult.data.appointment_id && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Appointment ID:</span>
                      <code className="bg-background px-2 py-0.5 rounded text-xs">{testResult.data.appointment_id}</code>
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant={testResult.data.is_duplicate ? 'secondary' : 'default'}>
                      {testResult.data.is_duplicate ? 'Duplicate Detected' : 'New Contact'}
                    </Badge>
                  </div>
                  <div className="pt-2">
                    <Button variant="outline" size="sm" asChild>
                      <a href="/crm" target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3 w-3 mr-1" />
                        View in CRM
                      </a>
                    </Button>
                  </div>
                </div>
              )}
              
              {!testResult.success && testResult.error && (
                <p className="text-sm text-red-700 dark:text-red-300">{testResult.error}</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Close
          </Button>
          <Button onClick={handleTest} disabled={testing}>
            {testing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Send Test Lead
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

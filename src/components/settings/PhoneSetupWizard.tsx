import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { Loader2, Phone, ArrowRight, ArrowLeft, Check, Search, Building2, Shield } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface PhoneSetupWizardProps {
  locationId: string;
  tenantId: string;
  locationName: string;
  onComplete: () => void;
  onCancel: () => void;
}

type SetupMode = 'choose' | 'port' | 'new';
type PortStep = 'info' | 'account' | 'confirm';

interface AvailableNumber {
  phoneNumber: string;
  formatted: string;
  locality: string;
  region: string;
}

export function PhoneSetupWizard({ 
  locationId, 
  tenantId, 
  locationName,
  onComplete, 
  onCancel 
}: PhoneSetupWizardProps) {
  const { toast } = useToast();
  const [mode, setMode] = useState<SetupMode>('choose');
  const [portStep, setPortStep] = useState<PortStep>('info');
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  
  // Port form state
  const [phoneNumber, setPhoneNumber] = useState('');
  const [currentCarrier, setCurrentCarrier] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountPin, setAccountPin] = useState('');
  const [accountName, setAccountName] = useState('');
  const [billingStreet, setBillingStreet] = useState('');
  const [billingCity, setBillingCity] = useState('');
  const [billingState, setBillingState] = useState('');
  const [billingZip, setBillingZip] = useState('');

  // New number state
  const [areaCode, setAreaCode] = useState('');
  const [availableNumbers, setAvailableNumbers] = useState<AvailableNumber[]>([]);
  const [selectedNumber, setSelectedNumber] = useState('');

  const searchNumbers = async () => {
    if (areaCode.length !== 3) {
      toast({ title: 'Enter a 3-digit area code', variant: 'destructive' });
      return;
    }

    setIsSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('telnyx-search-numbers', {
        body: { areaCode, limit: 8 }
      });

      if (error || !data.success) {
        throw new Error(data?.error || 'Failed to search numbers');
      }

      setAvailableNumbers(data.numbers);
      if (data.numbers.length === 0) {
        toast({ title: 'No numbers available in this area code', variant: 'default' });
      }
    } catch (error: any) {
      toast({ title: 'Search failed', description: error.message, variant: 'destructive' });
    } finally {
      setIsSearching(false);
    }
  };

  const purchaseNumber = async () => {
    if (!selectedNumber) {
      toast({ title: 'Select a phone number', variant: 'destructive' });
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('telnyx-purchase-number', {
        body: { phoneNumber: selectedNumber, locationId, tenantId }
      });

      if (error || !data.success) {
        throw new Error(data?.error || 'Failed to purchase number');
      }

      toast({ title: 'Phone number activated!', description: `${selectedNumber} is now ready for calls and texts.` });
      onComplete();
    } catch (error: any) {
      toast({ title: 'Purchase failed', description: error.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const submitPortRequest = async () => {
    if (!phoneNumber || !currentCarrier || !accountNumber || !accountName) {
      toast({ title: 'Please fill in all required fields', variant: 'destructive' });
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('telnyx-port-request', {
        body: {
          phoneNumber,
          locationId,
          tenantId,
          currentCarrier,
          accountNumber,
          accountPin,
          accountName,
          billingAddress: billingStreet ? {
            street: billingStreet,
            city: billingCity,
            state: billingState,
            zip: billingZip
          } : undefined,
        }
      });

      if (error || !data.success) {
        throw new Error(data?.error || 'Failed to submit port request');
      }

      toast({ 
        title: 'Port request submitted!', 
        description: 'You\'ll receive email updates. Porting typically takes 3-7 business days.' 
      });
      onComplete();
    } catch (error: any) {
      toast({ title: 'Port request failed', description: error.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  // Choose mode screen
  if (mode === 'choose') {
    return (
      <Card className="border-primary/20">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Phone className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>Set Up Phone for {locationName}</CardTitle>
          <CardDescription>
            Choose how you'd like to set up your business phone number
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            variant="outline"
            className="w-full h-auto py-4 justify-start gap-4"
            onClick={() => setMode('port')}
          >
            <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center">
              <ArrowRight className="h-5 w-5 text-orange-600" />
            </div>
            <div className="text-left">
              <div className="font-medium">Port Existing Number</div>
              <div className="text-sm text-muted-foreground">Transfer your current business number to PITCH</div>
            </div>
          </Button>

          <Button
            variant="outline"
            className="w-full h-auto py-4 justify-start gap-4"
            onClick={() => setMode('new')}
          >
            <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
              <Phone className="h-5 w-5 text-green-600" />
            </div>
            <div className="text-left">
              <div className="font-medium">Get New Number</div>
              <div className="text-sm text-muted-foreground">Choose a new local number in your area code</div>
            </div>
          </Button>

          <Button variant="ghost" className="w-full" onClick={onCancel}>
            Cancel
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Port existing number flow
  if (mode === 'port') {
    return (
      <Card className="border-primary/20">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => portStep === 'info' ? setMode('choose') : setPortStep('info')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <CardTitle className="text-lg">Port Your Number</CardTitle>
              <CardDescription>
                {portStep === 'info' && 'Step 1: Phone number details'}
                {portStep === 'account' && 'Step 2: Account information'}
                {portStep === 'confirm' && 'Step 3: Review & submit'}
              </CardDescription>
            </div>
          </div>
          <div className="flex gap-1 mt-2">
            {['info', 'account', 'confirm'].map((step, i) => (
              <div 
                key={step} 
                className={`h-1 flex-1 rounded ${
                  ['info', 'account', 'confirm'].indexOf(portStep) >= i 
                    ? 'bg-primary' 
                    : 'bg-muted'
                }`} 
              />
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {portStep === 'info' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="phoneNumber">Phone Number to Port *</Label>
                <Input
                  id="phoneNumber"
                  placeholder="(239) 919-4485"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="carrier">Current Carrier *</Label>
                <Input
                  id="carrier"
                  placeholder="AT&T, Verizon, T-Mobile, etc."
                  value={currentCarrier}
                  onChange={(e) => setCurrentCarrier(e.target.value)}
                />
              </div>
              <Button 
                className="w-full" 
                onClick={() => setPortStep('account')}
                disabled={!phoneNumber || !currentCarrier}
              >
                Continue <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </>
          )}

          {portStep === 'account' && (
            <>
              <div className="bg-muted/50 p-3 rounded-lg text-sm">
                <Shield className="h-4 w-4 inline mr-2 text-primary" />
                This information is required by your current carrier to authorize the transfer.
              </div>
              <div className="space-y-2">
                <Label htmlFor="accountName">Account Holder Name *</Label>
                <Input
                  id="accountName"
                  placeholder="Name on the account"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="accountNumber">Account Number *</Label>
                  <Input
                    id="accountNumber"
                    placeholder="From your bill"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="accountPin">Account PIN</Label>
                  <Input
                    id="accountPin"
                    type="password"
                    placeholder="If required"
                    value={accountPin}
                    onChange={(e) => setAccountPin(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Billing Address (Optional)</Label>
                <Input
                  placeholder="Street address"
                  value={billingStreet}
                  onChange={(e) => setBillingStreet(e.target.value)}
                />
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    placeholder="City"
                    value={billingCity}
                    onChange={(e) => setBillingCity(e.target.value)}
                  />
                  <Input
                    placeholder="State"
                    value={billingState}
                    onChange={(e) => setBillingState(e.target.value)}
                  />
                  <Input
                    placeholder="ZIP"
                    value={billingZip}
                    onChange={(e) => setBillingZip(e.target.value)}
                  />
                </div>
              </div>
              <Button 
                className="w-full" 
                onClick={() => setPortStep('confirm')}
                disabled={!accountName || !accountNumber}
              >
                Continue <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </>
          )}

          {portStep === 'confirm' && (
            <>
              <div className="bg-muted/50 p-4 rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Phone Number</span>
                  <span className="font-medium">{phoneNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current Carrier</span>
                  <span className="font-medium">{currentCarrier}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Account Name</span>
                  <span className="font-medium">{accountName}</span>
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                <p>After submitting:</p>
                <ul className="list-disc list-inside mt-1 space-y-1">
                  <li>Porting typically takes 3-7 business days</li>
                  <li>Your current number stays active until complete</li>
                  <li>You'll receive email updates on progress</li>
                  <li>Once complete, calls/texts route through PITCH</li>
                </ul>
              </div>
              <Button 
                className="w-full" 
                onClick={submitPortRequest}
                disabled={isLoading}
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                Submit Port Request
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  // New number flow
  if (mode === 'new') {
    return (
      <Card className="border-primary/20">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setMode('choose')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <CardTitle className="text-lg">Get a New Number</CardTitle>
              <CardDescription>Search for available numbers in your area</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="flex-1 space-y-2">
              <Label htmlFor="areaCode">Area Code</Label>
              <Input
                id="areaCode"
                placeholder="239"
                maxLength={3}
                value={areaCode}
                onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={searchNumbers} disabled={isSearching || areaCode.length !== 3}>
                {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {availableNumbers.length > 0 && (
            <div className="space-y-2">
              <Label>Available Numbers</Label>
              <RadioGroup value={selectedNumber} onValueChange={setSelectedNumber}>
                {availableNumbers.map((num) => (
                  <div
                    key={num.phoneNumber}
                    className={`flex items-center space-x-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedNumber === num.phoneNumber 
                        ? 'border-primary bg-primary/5' 
                        : 'border-border hover:border-primary/50'
                    }`}
                    onClick={() => setSelectedNumber(num.phoneNumber)}
                  >
                    <RadioGroupItem value={num.phoneNumber} id={num.phoneNumber} />
                    <div className="flex-1">
                      <span className="font-medium">{num.formatted}</span>
                      {num.locality && (
                        <span className="text-sm text-muted-foreground ml-2">
                          {num.locality}, {num.region}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </RadioGroup>
            </div>
          )}

          {selectedNumber && (
            <Button 
              className="w-full" 
              onClick={purchaseNumber}
              disabled={isLoading}
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
              Activate {availableNumbers.find(n => n.phoneNumber === selectedNumber)?.formatted}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return null;
}

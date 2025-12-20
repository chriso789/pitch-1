import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Phone, Loader2, CheckCircle, AlertCircle, Search, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Location {
  id: string;
  name: string;
  telnyx_phone_number: string | null;
  is_primary: boolean;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
}

interface AvailableNumber {
  phone_number: string;
  formatted: string;
  locality: string;
  region: string;
  monthly_cost: string;
  features: string[];
}

type ProvisionStatus = 'idle' | 'searching' | 'selecting' | 'purchasing' | 'configuring' | 'complete' | 'error';

export const PhoneProvisioningPanel = () => {
  const { toast } = useToast();
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [provisioningLocation, setProvisioningLocation] = useState<string | null>(null);
  const [provisionStatus, setProvisionStatus] = useState<ProvisionStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [availableNumbers, setAvailableNumbers] = useState<AvailableNumber[]>([]);

  useEffect(() => {
    fetchLocations();
  }, []);

  const fetchLocations = async () => {
    setLoading(true);
    try {
      const { data: profile } = await supabase.auth.getUser();
      if (!profile.user) return;

      const { data: userProfile } = await supabase
        .from('profiles')
        .select('tenant_id, active_tenant_id')
        .eq('id', profile.user.id)
        .single();

      const tenantId = userProfile?.active_tenant_id || userProfile?.tenant_id;
      if (!tenantId) return;

      const { data, error } = await supabase
        .from('locations')
        .select('id, name, telnyx_phone_number, is_primary, address_city, address_state, address_zip')
        .eq('tenant_id', tenantId)
        .order('is_primary', { ascending: false });

      if (error) throw error;
      setLocations(data || []);
    } catch (err) {
      console.error('Error fetching locations:', err);
      toast({ title: "Error", description: "Failed to load locations", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Score a number for "catchiness" - higher is better
  const scoreNumber = (phoneNumber: string): number => {
    const digits = phoneNumber.replace(/\D/g, '').slice(-7); // Last 7 digits
    const last4 = digits.slice(-4);
    let score = 0;

    // Priority 1: Contains "7663" (ROOF) - highest priority
    if (last4 === '7663') score += 1000;
    if (digits.includes('7663')) score += 500;

    // Priority 2: Repeating patterns
    if (/(.)\1{3}/.test(last4)) score += 300; // 4 of same digit (1111, 2222)
    if (/(.)\1{2}/.test(last4)) score += 200; // 3 of same digit
    if (/(.)\1/.test(last4)) score += 100; // 2 of same digit

    // Priority 3: Sequential patterns
    if (/1234|2345|3456|4567|5678|6789/.test(last4)) score += 250;
    if (/9876|8765|7654|6543|5432|4321/.test(last4)) score += 200;

    // Priority 4: Easy to remember patterns
    if (/0000|1111|2222|3333|4444|5555|6666|7777|8888|9999/.test(last4)) score += 350;
    if (/1000|2000|3000|4000|5000|6000|7000|8000|9000/.test(last4)) score += 150;

    // Bonus for doubled pairs (1212, 3434, etc)
    if (/^(\d\d)\1$/.test(last4)) score += 175;

    return score;
  };

  const getAreaCodeForLocation = (location: Location): string => {
    // East Coast (Florida East) - Boca Raton area = 561
    if (location.name.toLowerCase().includes('east') || 
        location.address_city?.toLowerCase().includes('boca') ||
        location.address_city?.toLowerCase().includes('delray') ||
        location.address_city?.toLowerCase().includes('palm beach')) {
      return '561';
    }
    // West Coast (Florida West) - North Port / Sarasota area = 941 (NOT 239!)
    // North Port ZIP 34286 is in the 941 area code, not 239
    if (location.name.toLowerCase().includes('west') ||
        location.address_city?.toLowerCase().includes('north port') ||
        location.address_city?.toLowerCase().includes('sarasota') ||
        location.address_city?.toLowerCase().includes('venice') ||
        location.address_city?.toLowerCase().includes('port charlotte')) {
      return '941';
    }
    // Naples / Fort Myers area = 239
    if (location.address_city?.toLowerCase().includes('naples') ||
        location.address_city?.toLowerCase().includes('fort myers')) {
      return '239';
    }
    // Default to 561 for Florida
    return '561';
  };

  const provisionNumber = async (location: Location) => {
    setProvisioningLocation(location.id);
    setProvisionStatus('searching');
    setStatusMessage('Searching for available numbers...');
    setAvailableNumbers([]);

    try {
      const areaCode = getAreaCodeForLocation(location);
      console.log(`Searching for ${areaCode} numbers for ${location.name}...`);

      // Step 1: Search for available numbers (pass ZIP for accurate mapping)
      const { data: searchResult, error: searchError } = await supabase.functions.invoke(
        'location-phone-provision',
        {
          body: {
            action: 'search',
            locationId: location.id,
            areaCode: areaCode,
            zipCode: location.address_zip, // Pass ZIP for backend mapping
            limit: 50 // Get more to find catchy ones
          }
        }
      );

      if (searchError) throw searchError;
      if (!searchResult?.numbers || searchResult.numbers.length === 0) {
        throw new Error(`No numbers available in area code ${areaCode}`);
      }

      console.log(`Found ${searchResult.numbers.length} numbers, scoring for catchiness...`);
      setProvisionStatus('selecting');
      setStatusMessage(`Found ${searchResult.numbers.length} numbers. Selecting best one...`);

      // Step 2: Score and select the catchiest number
      const scoredNumbers = searchResult.numbers.map((num: AvailableNumber) => ({
        ...num,
        score: scoreNumber(num.phone_number)
      })).sort((a: any, b: any) => b.score - a.score);

      setAvailableNumbers(scoredNumbers.slice(0, 5)); // Show top 5

      const bestNumber = scoredNumbers[0];
      const last4 = bestNumber.phone_number.replace(/\D/g, '').slice(-4);
      console.log(`Selected number: ${bestNumber.phone_number} (score: ${bestNumber.score}, last4: ${last4})`);
      
      setStatusMessage(`Selected: ${bestNumber.formatted || bestNumber.phone_number}`);

      // Step 3: Purchase the number
      setProvisionStatus('purchasing');
      setStatusMessage(`Purchasing ${bestNumber.formatted || bestNumber.phone_number}...`);

      const { data: purchaseResult, error: purchaseError } = await supabase.functions.invoke(
        'location-phone-provision',
        {
          body: {
            action: 'purchase',
            locationId: location.id,
            phoneNumber: bestNumber.phone_number
          }
        }
      );

      if (purchaseError) throw purchaseError;
      if (!purchaseResult?.success) {
        throw new Error(purchaseResult?.error || 'Failed to purchase number');
      }

      // Step 4: Configure for SMS + Voice
      setProvisionStatus('configuring');
      setStatusMessage('Configuring for SMS and Voice...');

      // The purchase endpoint should handle configuration, but we can verify
      await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause for config to apply

      setProvisionStatus('complete');
      setStatusMessage(`Successfully provisioned ${bestNumber.formatted || bestNumber.phone_number}`);

      toast({
        title: "Phone Number Provisioned",
        description: `${bestNumber.formatted || bestNumber.phone_number} is now active for ${location.name}`,
      });

      // Refresh locations to show new number
      await fetchLocations();

    } catch (err: any) {
      console.error('Provisioning error:', err);
      setProvisionStatus('error');
      setStatusMessage(err.message || 'Failed to provision number');
      toast({
        title: "Provisioning Failed",
        description: err.message || 'Please try again',
        variant: "destructive"
      });
    }
  };

  const formatPhoneDisplay = (phone: string | null): string => {
    if (!phone) return 'Not configured';
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) {
      return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone;
  };

  const getStatusIcon = () => {
    switch (provisionStatus) {
      case 'searching':
      case 'selecting':
      case 'purchasing':
      case 'configuring':
        return <Loader2 className="h-4 w-4 animate-spin" />;
      case 'complete':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          <span>Loading locations...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5" />
              Phone Number Provisioning
            </CardTitle>
            <CardDescription>
              Configure Telnyx phone numbers for each location. Numbers ending in 7663 (ROOF) are prioritized.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={fetchLocations}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {locations.length === 0 ? (
          <p className="text-muted-foreground text-center py-4">
            No locations found. Please add locations first.
          </p>
        ) : (
          locations.map((location) => (
            <div
              key={location.id}
              className="flex items-center justify-between p-4 border rounded-lg bg-card"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{location.name}</h3>
                  {location.is_primary && (
                    <Badge variant="secondary" className="text-xs">Primary</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {location.address_city}, {location.address_state}
                </p>
                <div className="mt-1">
                  {location.telnyx_phone_number ? (
                    <Badge variant="default" className="bg-green-600">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      {formatPhoneDisplay(location.telnyx_phone_number)}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      No phone number
                    </Badge>
                  )}
                </div>
              </div>

              <div className="flex flex-col items-end gap-2">
                {provisioningLocation === location.id && provisionStatus !== 'idle' ? (
                  <div className="flex items-center gap-2 text-sm">
                    {getStatusIcon()}
                    <span className={provisionStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'}>
                      {statusMessage}
                    </span>
                  </div>
                ) : (
                  <Button
                    onClick={() => provisionNumber(location)}
                    disabled={provisioningLocation !== null && provisionStatus !== 'idle' && provisionStatus !== 'complete' && provisionStatus !== 'error'}
                    variant={location.telnyx_phone_number ? "outline" : "default"}
                    size="sm"
                  >
                    <Search className="h-4 w-4 mr-2" />
                    {location.telnyx_phone_number ? 'Replace Number' : `Provision ${getAreaCodeForLocation(location)} Number`}
                  </Button>
                )}
              </div>
            </div>
          ))
        )}

        {availableNumbers.length > 0 && (
          <div className="mt-4 p-4 border rounded-lg bg-muted/50">
            <h4 className="font-medium mb-2">Top Available Numbers (by catchiness)</h4>
            <div className="space-y-1">
              {availableNumbers.slice(0, 5).map((num: any, idx) => (
                <div key={num.phone_number} className="flex items-center justify-between text-sm">
                  <span className={idx === 0 ? 'font-medium text-primary' : 'text-muted-foreground'}>
                    {idx === 0 && '→ '}{formatPhoneDisplay(num.phone_number)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Score: {num.score}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

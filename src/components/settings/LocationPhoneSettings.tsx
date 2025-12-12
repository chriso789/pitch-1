import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Phone, PhoneCall, MessageSquare, CheckCircle, Clock, AlertCircle, Settings, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { PhoneSetupWizard } from './PhoneSetupWizard';
import { useToast } from '@/hooks/use-toast';

interface Location {
  id: string;
  name: string;
  tenant_id: string;
  telnyx_phone_number?: string | null;
  phone_porting_status?: string | null;
  phone_setup_metadata?: Record<string, any> | null;
}

interface LocationPhoneSettingsProps {
  location: Location;
  onUpdate?: () => void;
}

export function LocationPhoneSettings({ location, onUpdate }: LocationPhoneSettingsProps) {
  const { toast } = useToast();
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [portStatus, setPortStatus] = useState<string | null>(null);

  const status = location.phone_porting_status || 'needs_setup';
  const phoneNumber = location.telnyx_phone_number;

  const checkPortStatus = async () => {
    setIsCheckingStatus(true);
    try {
      const { data, error } = await supabase.functions.invoke('telnyx-port-request', {
        body: { locationId: location.id, action: 'check_status' }
      });

      if (data?.status) {
        setPortStatus(data.status);
        if (data.status === 'ported' || data.status === 'completed') {
          toast({ title: 'Port complete!', description: 'Your number is now active.' });
          onUpdate?.();
        }
      }
    } catch (error) {
      console.error('Failed to check port status:', error);
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const formatPhoneNumber = (phone: string): string => {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return `(${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }
    return phone;
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-500/10 text-green-600 border-green-500/20"><CheckCircle className="h-3 w-3 mr-1" /> Active</Badge>;
      case 'pending_port':
      case 'port_submitted':
        return <Badge className="bg-orange-500/10 text-orange-600 border-orange-500/20"><Clock className="h-3 w-3 mr-1" /> Porting</Badge>;
      case 'failed':
        return <Badge className="bg-red-500/10 text-red-600 border-red-500/20"><AlertCircle className="h-3 w-3 mr-1" /> Failed</Badge>;
      default:
        return <Badge variant="secondary"><Settings className="h-3 w-3 mr-1" /> Setup Required</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
              <Phone className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">{location.name}</CardTitle>
              <CardDescription>Phone & Messaging</CardDescription>
            </div>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>
      <CardContent>
        {status === 'active' && phoneNumber ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div>
                <div className="font-medium text-lg">{formatPhoneNumber(phoneNumber)}</div>
                <div className="text-sm text-muted-foreground">Calls & SMS enabled</div>
              </div>
              <div className="flex gap-2">
                <Button size="icon" variant="outline">
                  <PhoneCall className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="outline">
                  <MessageSquare className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ) : (status === 'pending_port' || status === 'port_submitted') && phoneNumber ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-orange-50 dark:bg-orange-950/20 rounded-lg border border-orange-200 dark:border-orange-800">
              <div>
                <div className="font-medium">{formatPhoneNumber(phoneNumber)}</div>
                <div className="text-sm text-orange-600">Port in progress (3-7 business days)</div>
              </div>
              <Button 
                size="sm" 
                variant="outline" 
                onClick={checkPortStatus}
                disabled={isCheckingStatus}
              >
                {isCheckingStatus ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Check Status'}
              </Button>
            </div>
            {portStatus && (
              <div className="text-sm text-muted-foreground">
                Latest status: <span className="font-medium">{portStatus}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Set up a phone number for this location to enable calls and SMS through PITCH.
            </p>
            <Dialog open={isWizardOpen} onOpenChange={setIsWizardOpen}>
              <DialogTrigger asChild>
                <Button className="w-full">
                  <Phone className="h-4 w-4 mr-2" />
                  Set Up Phone Number
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md p-0 overflow-hidden">
                <PhoneSetupWizard
                  locationId={location.id}
                  tenantId={location.tenant_id}
                  locationName={location.name}
                  onComplete={() => {
                    setIsWizardOpen(false);
                    onUpdate?.();
                  }}
                  onCancel={() => setIsWizardOpen(false)}
                />
              </DialogContent>
            </Dialog>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

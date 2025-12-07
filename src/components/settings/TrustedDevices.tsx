import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Monitor, Smartphone, Tablet, Trash2, Shield, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { getDeviceFingerprint } from '@/services/deviceFingerprint';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface TrustedDevice {
  id: string;
  device_fingerprint: string;
  device_name: string | null;
  ip_address: string | null;
  last_seen_at: string;
  trusted_at: string;
  is_active: boolean;
  metadata: unknown;
}

export function TrustedDevices() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [devices, setDevices] = useState<TrustedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentFingerprint, setCurrentFingerprint] = useState<string | null>(null);
  const [deviceToRemove, setDeviceToRemove] = useState<TrustedDevice | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (user) {
      loadDevices();
      loadCurrentFingerprint();
    }
  }, [user]);

  const loadDevices = async () => {
    try {
      const { data, error } = await supabase
        .from('trusted_devices')
        .select('*')
        .eq('is_active', true)
        .order('last_seen_at', { ascending: false });

      if (error) throw error;
      setDevices(data || []);
    } catch (error) {
      console.error('Error loading trusted devices:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadCurrentFingerprint = async () => {
    const fp = await getDeviceFingerprint();
    setCurrentFingerprint(fp);
  };

  const handleRemoveDevice = async () => {
    if (!deviceToRemove) return;
    
    setRemoving(true);
    try {
      const { error } = await supabase
        .from('trusted_devices')
        .update({ is_active: false })
        .eq('id', deviceToRemove.id);

      if (error) throw error;

      toast({
        title: 'Device removed',
        description: 'The device has been removed from your trusted devices.'
      });
      
      loadDevices();
    } catch (error) {
      console.error('Error removing device:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to remove device. Please try again.'
      });
    } finally {
      setRemoving(false);
      setDeviceToRemove(null);
    }
  };

  const getDeviceIcon = (deviceName: string | null) => {
    if (!deviceName) return Monitor;
    const name = deviceName.toLowerCase();
    if (name.includes('android') || name.includes('iphone')) return Smartphone;
    if (name.includes('ipad') || name.includes('tablet')) return Tablet;
    return Monitor;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Trusted Devices
          </CardTitle>
          <CardDescription>
            Manage devices that can stay logged in to your account. Remove any device you don't recognize.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {devices.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Monitor className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No trusted devices yet</p>
              <p className="text-sm">Enable "Remember Me" when logging in to trust this device</p>
            </div>
          ) : (
            <div className="space-y-3">
              {devices.map((device) => {
                const DeviceIcon = getDeviceIcon(device.device_name);
                const isCurrentDevice = device.device_fingerprint === currentFingerprint;
                
                return (
                  <div
                    key={device.id}
                    className={`flex items-center justify-between p-4 rounded-lg border ${
                      isCurrentDevice ? 'border-primary bg-primary/5' : 'border-border'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-lg ${isCurrentDevice ? 'bg-primary/10' : 'bg-muted'}`}>
                        <DeviceIcon className={`h-5 w-5 ${isCurrentDevice ? 'text-primary' : 'text-muted-foreground'}`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{device.device_name || 'Unknown Device'}</span>
                          {isCurrentDevice && (
                            <Badge variant="secondary" className="text-xs">
                              This device
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Last seen {formatDistanceToNow(new Date(device.last_seen_at), { addSuffix: true })}
                          </span>
                          {device.ip_address && (
                            <span>IP: {device.ip_address}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeviceToRemove(device)}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deviceToRemove} onOpenChange={() => setDeviceToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Trusted Device</AlertDialogTitle>
            <AlertDialogDescription>
              This device will need to log in again. Are you sure you want to remove{' '}
              <strong>{deviceToRemove?.device_name || 'this device'}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveDevice}
              disabled={removing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

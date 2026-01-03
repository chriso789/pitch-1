import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DoorOpen, UserPlus, Camera, ChevronUp, ChevronDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface QuickActivityPanelProps {
  userLocation: { lat: number; lng: number };
}

export default function QuickActivityPanel({ userLocation }: QuickActivityPanelProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [isExpanded, setIsExpanded] = useState(true);
  const [isLogging, setIsLogging] = useState(false);

  const handleKnockDoor = async () => {
    if (!user) return;

    setIsLogging(true);
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('active_tenant_id, tenant_id')
        .eq('id', user.id)
        .single();

      const tenantId = profile?.active_tenant_id || profile?.tenant_id;

      const { error } = await supabase.from('canvass_activity_log').insert({
        tenant_id: tenantId,
        user_id: user.id,
        activity_type: 'door_knock',
        latitude: userLocation.lat,
        longitude: userLocation.lng,
        activity_data: { notes: 'Quick door knock logged', timestamp: new Date().toISOString() },
      });

      if (error) throw error;

      toast({
        title: 'Door Knock Logged',
        description: 'Activity recorded at your current location',
      });
    } catch (error: any) {
      console.error('Error logging door knock:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to log activity',
        variant: 'destructive',
      });
    } finally {
      setIsLogging(false);
    }
  };

  const handleLogLead = () => {
    toast({
      title: 'Create Lead',
      description: 'Opening lead creation form...',
    });
    // TODO: Open lead creation dialog with pre-filled GPS coordinates
  };

  const handleTakePhoto = () => {
    toast({
      title: 'Take Photo',
      description: 'Camera feature coming soon...',
    });
    // TODO: Open camera or file picker with GPS tagging
  };

  return (
    <Card className="rounded-none border-x-0 border-b-0 shadow-lg">
      <CardContent className="p-4">
        {/* Collapse Toggle */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">Quick Actions</h3>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-8 w-8"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Action Buttons */}
        {isExpanded && (
          <div className="grid grid-cols-3 gap-3">
            <Button
              variant="outline"
              className="h-24 flex-col gap-2"
              onClick={handleKnockDoor}
              disabled={isLogging}
            >
              <DoorOpen className="h-6 w-6" />
              <span className="text-xs">Knock Door</span>
            </Button>

            <Button
              variant="outline"
              className="h-24 flex-col gap-2"
              onClick={handleLogLead}
            >
              <UserPlus className="h-6 w-6" />
              <span className="text-xs">Log Lead</span>
            </Button>

            <Button
              variant="outline"
              className="h-24 flex-col gap-2"
              onClick={handleTakePhoto}
            >
              <Camera className="h-6 w-6" />
              <span className="text-xs">Take Photo</span>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

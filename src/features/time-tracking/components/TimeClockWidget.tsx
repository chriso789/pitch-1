import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Clock, MapPin, Play, Square } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

export function TimeClockWidget() {
  const [isClocked, setIsClocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentEntry, setCurrentEntry] = useState<any>(null);
  const { toast } = useToast();

  const handleClockIn = async () => {
    setLoading(true);
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, tenant_id')
        .eq('id', (await supabase.auth.getUser()).data.user?.id)
        .single();

      if (!profile) throw new Error('Profile not found');

      const location = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject);
      });

      const { data, error } = await (supabase as any)
        .from('time_entries')
        .insert({
          tenant_id: profile.tenant_id,
          user_id: profile.id,
          entry_date: format(new Date(), 'yyyy-MM-dd'),
          clock_in: new Date().toISOString(),
          location_coordinates: {
            lat: location.coords.latitude,
            lng: location.coords.longitude,
          },
          status: 'draft',
        })
        .select()
        .single();

      if (error) throw error;

      setCurrentEntry(data);
      setIsClocked(true);
      toast({
        title: 'Clocked In',
        description: `Started at ${format(new Date(), 'h:mm a')}`,
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClockOut = async () => {
    if (!currentEntry) return;
    
    setLoading(true);
    try {
      const { error } = await (supabase as any)
        .from('time_entries')
        .update({
          clock_out: new Date().toISOString(),
          status: 'submitted',
        })
        .eq('id', currentEntry.id);

      if (error) throw error;

      setIsClocked(false);
      setCurrentEntry(null);
      toast({
        title: 'Clocked Out',
        description: `Ended at ${format(new Date(), 'h:mm a')}`,
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Time Clock
        </CardTitle>
        <CardDescription>
          {isClocked ? 'Currently clocked in' : 'Clock in to start tracking time'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-center">
          <div className="text-4xl font-bold mb-2">
            {format(new Date(), 'h:mm a')}
          </div>
          <div className="text-sm text-muted-foreground">
            {format(new Date(), 'EEEE, MMMM d, yyyy')}
          </div>
        </div>

        {isClocked && currentEntry && (
          <div className="bg-muted p-3 rounded-lg space-y-1">
            <div className="text-sm font-medium">Clocked in at</div>
            <div className="text-lg font-semibold">
              {format(new Date(currentEntry.clock_in), 'h:mm a')}
            </div>
            {currentEntry.location_coordinates && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                Location captured
              </div>
            )}
          </div>
        )}

        <Button
          onClick={isClocked ? handleClockOut : handleClockIn}
          disabled={loading}
          className="w-full"
          size="lg"
          variant={isClocked ? 'destructive' : 'default'}
        >
          {isClocked ? (
            <>
              <Square className="mr-2 h-5 w-5" />
              Clock Out
            </>
          ) : (
            <>
              <Play className="mr-2 h-5 w-5" />
              Clock In
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

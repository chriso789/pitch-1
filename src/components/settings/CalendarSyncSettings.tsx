import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CalendarSync, Copy, RefreshCw, Apple, Chrome } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export const CalendarSyncSettings = () => {
  const [icalToken, setIcalToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const supabaseUrl = 'https://alxelfrbjzkmtnsulcei.supabase.co';

  useEffect(() => {
    fetchToken();
  }, []);

  const fetchToken = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('profiles')
      .select('ical_token')
      .eq('id', user.id)
      .single();

    setIcalToken(data?.ical_token || null);
    setLoading(false);
  };

  const regenerateToken = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const newToken = crypto.randomUUID();
    const { error } = await supabase
      .from('profiles')
      .update({ ical_token: newToken })
      .eq('id', user.id);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setIcalToken(newToken);
      toast({ title: 'Token regenerated', description: 'Your old subscription URL will no longer work.' });
    }
  };

  const feedUrl = icalToken
    ? `${supabaseUrl}/functions/v1/calendar-ical-feed?token=${icalToken}`
    : '';

  const copyUrl = () => {
    navigator.clipboard.writeText(feedUrl);
    toast({ title: 'Copied!', description: 'Calendar subscription URL copied to clipboard.' });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarSync className="h-5 w-5" />
          Calendar Sync
        </CardTitle>
        <CardDescription>
          Subscribe to your PITCH calendar from Apple iCal, Google Calendar, or Outlook
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="text-center py-4 text-muted-foreground">Loading...</div>
        ) : (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium">Subscription URL</label>
              <div className="flex gap-2">
                <Input value={feedUrl} readOnly className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={copyUrl} disabled={!icalToken}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                This URL updates automatically. Anyone with this link can see your calendar.
              </p>
            </div>

            <Button variant="outline" size="sm" onClick={regenerateToken}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Regenerate Token
            </Button>

            <div className="space-y-3 pt-2">
              <h4 className="text-sm font-medium">How to subscribe:</h4>
              <div className="grid gap-3 sm:grid-cols-3">
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Apple className="h-5 w-5" />
                    <span className="font-medium text-sm">Apple iCal</span>
                  </div>
                  <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                    <li>Open Calendar app</li>
                    <li>File → New Calendar Subscription</li>
                    <li>Paste the URL above</li>
                    <li>Click Subscribe</li>
                  </ol>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Chrome className="h-5 w-5" />
                    <span className="font-medium text-sm">Google Calendar</span>
                  </div>
                  <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                    <li>Open Google Calendar</li>
                    <li>Settings → Add calendar</li>
                    <li>From URL → Paste URL</li>
                    <li>Add calendar</li>
                  </ol>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className="px-1.5 py-0.5 text-xs">Outlook</Badge>
                    <span className="font-medium text-sm">Outlook</span>
                  </div>
                  <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                    <li>Open Outlook Calendar</li>
                    <li>Add Calendar → From Internet</li>
                    <li>Paste the URL above</li>
                    <li>Click OK</li>
                  </ol>
                </Card>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

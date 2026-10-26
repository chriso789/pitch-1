import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CheckCircle, CalendarIcon, Clock, Video } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface DemoInfo {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  company_name: string;
  confirmed_slot: string | null;
  booking_confirmed_at: string | null;
}

const BookDemo: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<DemoInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState<Date | undefined>();
  const [time, setTime] = useState<string>('');
  const [slots, setSlots] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState<Date | null>(null);

  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  useEffect(() => {
    if (!token) return;
    (async () => {
      const { data, error } = await supabase.functions.invoke('demo-booking', { body: { action: 'read', token } });
      if (error || !data?.info) {
        setError('This booking link is invalid or has expired.');
      } else {
        const row = data.info as DemoInfo;
        setSlots(data.slots || []);
        setInfo(row);
        if (row.confirmed_slot) setConfirmed(new Date(row.confirmed_slot));
      }
      setLoading(false);
    })();
  }, [token]);

  const handleConfirm = async () => {
    if (!date || !token || !time || !slots.includes(time)) {
      setError('Please pick an available date and time.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const slot = new Date(time);
    const { data: result, error: rpcError } = await supabase.functions.invoke('demo-booking', {
      body: { action: 'confirm', token, slot: time },
    });

    if (rpcError || !result?.success) {
      setError(result?.error || 'This time is no longer available. Please reload and choose another offered time.');
      setSubmitting(false);
      return;
    }

    // Best-effort push to the PITCH Google Calendar (never blocks confirmation)
    void supabase.functions
      .invoke('google-calendar-demo-sync', { body: { token } })
      .catch(() => {});

    setConfirmed(slot);
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center gradient-hero">
        <Loader2 className="h-8 w-8 animate-spin text-primary-foreground" />
      </div>
    );
  }

  if (error && !info) {
    return (
      <div className="min-h-screen flex items-center justify-center gradient-hero p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Link Unavailable</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (confirmed) {
    return (
      <div className="min-h-screen flex items-center justify-center gradient-hero p-4">
        <Card className="max-w-md w-full bg-card border-0 shadow-strong">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-success rounded-full flex items-center justify-center mb-3">
              <CheckCircle className="h-6 w-6 text-primary-foreground" />
            </div>
            <CardTitle className="text-2xl">You're booked!</CardTitle>
            <CardDescription>We'll send a Google Meet calendar invite to <strong>{info?.email}</strong>.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-center">
            <div className="p-4 bg-muted/40 rounded-lg">
              <div className="text-sm text-muted-foreground">Your meeting</div>
              <div className="text-lg font-semibold">{format(confirmed, 'EEEE, MMM d, yyyy')}</div>
              <div className="text-base">{format(confirmed, 'h:mm a')} ({tz})</div>
            </div>
            <p className="text-sm text-muted-foreground flex items-center justify-center gap-2">
              <Video className="h-4 w-4" /> Video meeting via Google Meet
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen gradient-hero overflow-auto">
      <div className="px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-6 text-primary-foreground">
            <h1 className="text-3xl sm:text-4xl font-bold mb-2">
              Hi {info?.first_name}, pick a time
            </h1>
            <p>
              Schedule a 30-minute video demo of PITCH CRM with our team.
            </p>
          </div>

          <Card className="bg-card border-0 shadow-strong">
            <CardHeader>
              <CardTitle className="text-xl">Select a date & time</CardTitle>
              <CardDescription>
                Times shown in your timezone: <strong>{tz}</strong>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <CalendarIcon className="h-4 w-4" /> Date
                  </label>
                  <div className="border rounded-lg p-2 flex justify-center">
                    <Calendar
                      mode="single"
                      selected={date}
                      onSelect={d => { setDate(d); setTime(''); }}
                      defaultMonth={slots[0] ? new Date(slots[0]) : undefined}
                      disabled={d => !slots.some(s => format(new Date(s), 'yyyy-MM-dd') === format(d, 'yyyy-MM-dd'))}
                      initialFocus
                      className={cn('p-3 pointer-events-auto')}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <Clock className="h-4 w-4" /> Time (30-min slots)
                  </label>
                  <div className="grid grid-cols-3 gap-2 max-h-[320px] overflow-y-auto p-1">
                    {slots.filter(s => date && format(new Date(s), 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')).map((t) => (
                      <Button
                        key={t}
                        type="button"
                        variant={time === t ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setTime(t)}
                      >
                        {format(new Date(t), 'h:mm a')}
                      </Button>
                    ))}
                  </div>
                  {slots.length === 0 && <p className="text-sm text-muted-foreground">No meeting times are currently available. Please contact your demo host for new times.</p>}
                </div>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="p-3 bg-muted/40 rounded-lg text-sm">
                {date && time ? (
                  <>You're booking: <strong>{format(date, 'EEEE, MMM d, yyyy')}</strong> at <strong>{format(new Date(time), 'h:mm a')}</strong></>
                ) : (
                  <>Select a date to continue</>
                )}
              </div>

              <Button
                onClick={handleConfirm}
                disabled={!date || !time || submitting}
                className="w-full h-12"
                size="lg"
              >
                {submitting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Confirming...</>
                ) : (
                  <>Confirm Video Meeting</>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default BookDemo;

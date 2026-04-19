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

const SLOT_TIMES = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30',
];

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
  const [time, setTime] = useState<string>('10:00');
  const [confirmed, setConfirmed] = useState<Date | null>(null);

  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  useEffect(() => {
    if (!token) return;
    (async () => {
      const { data, error } = await supabase.rpc('get_demo_request_by_token', { _token: token });
      if (error || !data || data.length === 0) {
        setError('This booking link is invalid or has expired.');
      } else {
        const row = data[0] as DemoInfo;
        setInfo(row);
        if (row.confirmed_slot) setConfirmed(new Date(row.confirmed_slot));
      }
      setLoading(false);
    })();
  }, [token]);

  const handleConfirm = async () => {
    if (!date) {
      setError('Please pick a date.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const [h, m] = time.split(':').map(Number);
    const slot = new Date(date);
    slot.setHours(h, m, 0, 0);

    const { error: rpcError } = await supabase.rpc('confirm_demo_slot_by_token', {
      _token: token!,
      _slot: slot.toISOString(),
    });

    if (rpcError) {
      setError(rpcError.message || 'Could not save your time. Please try again.');
      setSubmitting(false);
      return;
    }

    // Best-effort confirmation email (admin gets notified via existing demo flow)
    setConfirmed(slot);
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center gradient-hero">
        <Loader2 className="h-8 w-8 animate-spin text-white" />
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
        <Card className="max-w-md w-full bg-white/95 backdrop-blur-sm border-0 shadow-strong">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-success rounded-full flex items-center justify-center mb-3">
              <CheckCircle className="h-6 w-6 text-white" />
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
          <div className="text-center mb-6 text-white">
            <h1 className="text-3xl sm:text-4xl font-bold mb-2">
              Hi {info?.first_name}, pick a time
            </h1>
            <p className="text-white/90">
              Schedule a 30-minute video demo of PITCH CRM with our team.
            </p>
          </div>

          <Card className="bg-white/95 backdrop-blur-sm border-0 shadow-strong">
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
                      onSelect={setDate}
                      disabled={(d) => {
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        const max = new Date();
                        max.setDate(max.getDate() + 21);
                        const day = d.getDay();
                        return d < today || d > max || day === 0 || day === 6;
                      }}
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
                    {SLOT_TIMES.map((t) => (
                      <Button
                        key={t}
                        type="button"
                        variant={time === t ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setTime(t)}
                      >
                        {t}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="p-3 bg-muted/40 rounded-lg text-sm">
                {date ? (
                  <>You're booking: <strong>{format(date, 'EEEE, MMM d, yyyy')}</strong> at <strong>{time}</strong></>
                ) : (
                  <>Select a date to continue</>
                )}
              </div>

              <Button
                onClick={handleConfirm}
                disabled={!date || submitting}
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

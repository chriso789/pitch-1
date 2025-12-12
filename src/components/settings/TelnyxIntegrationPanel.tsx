import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { 
  Phone, 
  MessageSquare, 
  CheckCircle2, 
  XCircle, 
  Copy, 
  Loader2,
  ExternalLink,
  Settings,
  AlertCircle
} from 'lucide-react';
import { Separator } from '@/components/ui/separator';

const WEBHOOK_URLS = {
  voice: 'https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/voice-inbound',
  sms: 'https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/messaging-inbound-webhook'
};

const TELNYX_CONFIG = {
  smsProfileId: '40019b10-e9de-48f9-9947-827fbc6b76df',
  voiceAppId: '2849056557713327385',
  westCoastNumber: '+12399194485',
  eastCoastNumber: '+15617886050'
};

export function TelnyxIntegrationPanel() {
  const { toast } = useToast();
  const [testSmsTo, setTestSmsTo] = useState('');
  const [testSmsMessage, setTestSmsMessage] = useState('Test SMS from PITCH CRM');
  const [testCallTo, setTestCallTo] = useState('');
  const [isSendingSms, setIsSendingSms] = useState(false);
  const [isMakingCall, setIsMakingCall] = useState(false);
  const [testResults, setTestResults] = useState<{
    sms?: { success: boolean; message: string; messageId?: string };
    call?: { success: boolean; message: string; callId?: string };
  }>({});

  const copyToClipboard = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast({
      title: 'Copied!',
      description: `${label} copied to clipboard`,
    });
  };

  const handleTestSms = async () => {
    if (!testSmsTo) {
      toast({
        title: 'Missing phone number',
        description: 'Please enter a phone number to send test SMS',
        variant: 'destructive',
      });
      return;
    }

    setIsSendingSms(true);
    setTestResults(prev => ({ ...prev, sms: undefined }));

    try {
      const { data, error } = await supabase.functions.invoke('telnyx-send-sms', {
        body: {
          to: testSmsTo,
          message: testSmsMessage,
        },
      });

      if (error) throw error;

      if (data.success) {
        setTestResults(prev => ({
          ...prev,
          sms: {
            success: true,
            message: `SMS sent successfully to ${data.to}`,
            messageId: data.messageId
          }
        }));
        toast({
          title: 'SMS Sent!',
          description: `Message ID: ${data.messageId}`,
        });
      } else {
        throw new Error(data.error || 'Failed to send SMS');
      }
    } catch (error: any) {
      console.error('SMS test error:', error);
      setTestResults(prev => ({
        ...prev,
        sms: {
          success: false,
          message: error.message || 'Failed to send SMS'
        }
      }));
      toast({
        title: 'SMS Failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSendingSms(false);
    }
  };

  const handleTestCall = async () => {
    if (!testCallTo) {
      toast({
        title: 'Missing phone number',
        description: 'Please enter a phone number to make test call',
        variant: 'destructive',
      });
      return;
    }

    setIsMakingCall(true);
    setTestResults(prev => ({ ...prev, call: undefined }));

    try {
      // For now, just show that calling would work - actual call requires WebRTC setup
      toast({
        title: 'Call Feature',
        description: 'Outbound calling requires WebRTC softphone. Use the Softphone panel to make calls.',
      });
      setTestResults(prev => ({
        ...prev,
        call: {
          success: true,
          message: 'Use Softphone panel for outbound calls'
        }
      }));
    } catch (error: any) {
      setTestResults(prev => ({
        ...prev,
        call: {
          success: false,
          message: error.message || 'Failed to initiate call'
        }
      }));
    } finally {
      setIsMakingCall(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Configuration Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Telnyx Configuration
          </CardTitle>
          <CardDescription>
            Current Telnyx integration settings for O'Brien Contracting
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground text-sm">SMS Profile ID</Label>
              <div className="flex items-center gap-2">
                <code className="bg-muted px-2 py-1 rounded text-xs flex-1 truncate">
                  {TELNYX_CONFIG.smsProfileId}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => copyToClipboard(TELNYX_CONFIG.smsProfileId, 'SMS Profile ID')}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground text-sm">Voice App ID</Label>
              <div className="flex items-center gap-2">
                <code className="bg-muted px-2 py-1 rounded text-xs flex-1 truncate">
                  {TELNYX_CONFIG.voiceAppId}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => copyToClipboard(TELNYX_CONFIG.voiceAppId, 'Voice App ID')}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground text-sm">West Coast Number</Label>
              <div className="flex items-center gap-2">
                <code className="bg-muted px-2 py-1 rounded text-xs">
                  {TELNYX_CONFIG.westCoastNumber}
                </code>
                <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                  Pending Port
                </Badge>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground text-sm">East Coast Number</Label>
              <div className="flex items-center gap-2">
                <code className="bg-muted px-2 py-1 rounded text-xs">
                  {TELNYX_CONFIG.eastCoastNumber}
                </code>
                <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                  Pending Port
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Webhook URLs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ExternalLink className="h-5 w-5" />
            Webhook URLs
          </CardTitle>
          <CardDescription>
            Configure these URLs in your Telnyx Portal for inbound events
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-muted-foreground text-sm">Voice Webhook (TeXML App)</Label>
            <div className="flex items-center gap-2">
              <Input
                value={WEBHOOK_URLS.voice}
                readOnly
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(WEBHOOK_URLS.voice, 'Voice webhook URL')}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground text-sm">SMS Webhook (Messaging Profile)</Label>
            <div className="flex items-center gap-2">
              <Input
                value={WEBHOOK_URLS.sms}
                readOnly
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(WEBHOOK_URLS.sms, 'SMS webhook URL')}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex items-start gap-2 p-3 bg-muted rounded-lg">
            <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5" />
            <p className="text-sm text-muted-foreground">
              Make sure these URLs are configured in your Telnyx Portal under the Voice Application and Messaging Profile settings.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Test SMS */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Test Outbound SMS
          </CardTitle>
          <CardDescription>
            Send a test SMS message to verify Telnyx integration
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="test-sms-to">Recipient Phone Number</Label>
              <Input
                id="test-sms-to"
                placeholder="+1234567890"
                value={testSmsTo}
                onChange={(e) => setTestSmsTo(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="test-sms-message">Message</Label>
              <Textarea
                id="test-sms-message"
                placeholder="Enter test message..."
                value={testSmsMessage}
                onChange={(e) => setTestSmsMessage(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Button onClick={handleTestSms} disabled={isSendingSms}>
              {isSendingSms ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Send Test SMS
                </>
              )}
            </Button>

            {testResults.sms && (
              <div className="flex items-center gap-2">
                {testResults.sms.success ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                <span className={`text-sm ${testResults.sms.success ? 'text-green-500' : 'text-destructive'}`}>
                  {testResults.sms.message}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Test Call */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Test Outbound Call
          </CardTitle>
          <CardDescription>
            Initiate a test call to verify voice integration
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="test-call-to">Recipient Phone Number</Label>
            <Input
              id="test-call-to"
              placeholder="+1234567890"
              value={testCallTo}
              onChange={(e) => setTestCallTo(e.target.value)}
              className="max-w-md"
            />
          </div>

          <div className="flex items-center gap-4">
            <Button onClick={handleTestCall} disabled={isMakingCall} variant="outline">
              {isMakingCall ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Initiating...
                </>
              ) : (
                <>
                  <Phone className="h-4 w-4 mr-2" />
                  Test Call
                </>
              )}
            </Button>

            {testResults.call && (
              <div className="flex items-center gap-2">
                {testResults.call.success ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                <span className={`text-sm ${testResults.call.success ? 'text-green-500' : 'text-destructive'}`}>
                  {testResults.call.message}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Integration Checklist */}
      <Card>
        <CardHeader>
          <CardTitle>Integration Checklist</CardTitle>
          <CardDescription>
            Track your Telnyx integration progress
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <ChecklistItem checked label="API Key configured" />
            <ChecklistItem checked label="Connection ID configured" />
            <ChecklistItem checked label="SMS Profile ID configured" />
            <ChecklistItem checked label="Voice App ID configured" />
            <ChecklistItem checked={false} label="Phone numbers ported to Telnyx" note="Pending port completion" />
            <ChecklistItem checked={false} label="Numbers assigned to Voice App" note="After port completes" />
            <ChecklistItem checked={false} label="Numbers assigned to Messaging Profile" note="After port completes" />
            <ChecklistItem checked={false} label="Test SMS sent successfully" note="Click 'Send Test SMS' above" />
            <ChecklistItem checked={false} label="Test call completed" note="Use Softphone panel" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ChecklistItem({ 
  checked, 
  label, 
  note 
}: { 
  checked: boolean; 
  label: string; 
  note?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      {checked ? (
        <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
      ) : (
        <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 flex-shrink-0" />
      )}
      <div className="flex-1">
        <span className={checked ? 'text-foreground' : 'text-muted-foreground'}>
          {label}
        </span>
        {note && (
          <span className="text-xs text-muted-foreground ml-2">
            ({note})
          </span>
        )}
      </div>
    </div>
  );
}

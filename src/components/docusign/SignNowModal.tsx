import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, ExternalLink, CheckCircle, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface SignNowModalProps {
  isOpen: boolean;
  onClose: () => void;
  agreementInstanceId: string;
  recipientRole: string;
  onSigned?: () => void;
}

export default function SignNowModal({
  isOpen,
  onClose,
  agreementInstanceId,
  recipientRole,
  onSigned,
}: SignNowModalProps) {
  const [signingUrl, setSigningUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'signing' | 'completed' | 'error'>('loading');
  const [agreementInstance, setAgreementInstance] = useState<any>(null);
  const [recipient, setRecipient] = useState<any>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen && agreementInstanceId) {
      loadAgreementData();
    }
  }, [isOpen, agreementInstanceId]);

  const loadAgreementData = async () => {
    try {
      setIsLoading(true);
      setStatus('loading');

      // Fetch agreement instance
      const { data: agreement, error: agreementError } = await supabase
        .from('agreement_instances')
        .select('*')
        .eq('id', agreementInstanceId)
        .single();

      if (agreementError) throw agreementError;
      setAgreementInstance(agreement);

      // Fetch recipient
      const { data: recipientData, error: recipientError } = await supabase
        .from('recipients')
        .select('*')
        .eq('agreement_instance_id', agreementInstanceId)
        .eq('role', recipientRole)
        .single();

      if (recipientError) throw recipientError;
      setRecipient(recipientData);

      // Check if already signed
      if (recipientData.status === 'completed') {
        setStatus('completed');
        return;
      }

      // Check if envelope is sent
      if (agreement.status !== 'sent' && agreement.status !== 'delivered') {
        setStatus('error');
        toast({
          title: 'Document Not Ready',
          description: 'The document has not been sent yet.',
          variant: 'destructive',
        });
        return;
      }

      setStatus('ready');
    } catch (error: any) {
      console.error('Error loading agreement data:', error);
      setStatus('error');
      toast({
        title: 'Error',
        description: 'Failed to load signing information',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const startSigning = async () => {
    if (!recipient?.client_user_id) {
      // For non-embedded signing, show message to check email
      toast({
        title: 'Check Your Email',
        description: 'Please check your email for the DocuSign signing link.',
      });
      return;
    }

    try {
      setIsLoading(true);
      setStatus('signing');

      const response = await supabase.functions.invoke('docusign-embedded-views', {
        body: {
          agreement_instance_id: agreementInstanceId,
          view_type: 'recipient',
          recipient_role: recipientRole,
          return_url: `${window.location.origin}/sign-complete?agreement=${agreementInstanceId}`,
        },
      });

      if (response.error) throw response.error;

      setSigningUrl(response.data.view_url);
    } catch (error: any) {
      console.error('Error getting signing URL:', error);
      setStatus('error');
      toast({
        title: 'Error',
        description: error.message || 'Failed to start signing process',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSigningComplete = () => {
    setStatus('completed');
    toast({
      title: 'Document Signed',
      description: 'Thank you for signing the document!',
    });
    onSigned?.();
  };

  // Listen for signing completion (you could use postMessage or polling)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'docusign-signing-complete') {
        handleSigningComplete();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const getStatusDisplay = () => {
    switch (status) {
      case 'loading':
        return {
          icon: <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />,
          title: 'Loading...',
          description: 'Preparing document for signing',
          color: 'default',
        };
      case 'ready':
        return {
          icon: <ExternalLink className="h-8 w-8 text-blue-500" />,
          title: 'Ready to Sign',
          description: 'Click below to start the signing process',
          color: 'blue',
        };
      case 'signing':
        return {
          icon: <Loader2 className="h-8 w-8 animate-spin text-blue-500" />,
          title: 'Signing in Progress',
          description: 'Complete the signing process in the DocuSign window',
          color: 'blue',
        };
      case 'completed':
        return {
          icon: <CheckCircle className="h-8 w-8 text-green-500" />,
          title: 'Signing Complete',
          description: 'The document has been successfully signed',
          color: 'green',
        };
      case 'error':
        return {
          icon: <AlertCircle className="h-8 w-8 text-red-500" />,
          title: 'Error',
          description: 'There was a problem with the signing process',
          color: 'red',
        };
      default:
        return {
          icon: <AlertCircle className="h-8 w-8 text-muted-foreground" />,
          title: 'Unknown Status',
          description: 'Please try again',
          color: 'default',
        };
    }
  };

  const statusDisplay = getStatusDisplay();

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Sign Document</DialogTitle>
          <DialogDescription>
            Electronic signature powered by DocuSign
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Agreement Info */}
          {agreementInstance && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Document Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Subject:</span>
                  <span className="text-sm">{agreementInstance.email_subject}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Status:</span>
                  <Badge variant="outline">{agreementInstance.status}</Badge>
                </div>
                {recipient && (
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Role:</span>
                    <Badge variant="secondary">{recipient.role}</Badge>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Status Display */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col items-center text-center space-y-4">
                {statusDisplay.icon}
                <div>
                  <h3 className="font-medium">{statusDisplay.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {statusDisplay.description}
                  </p>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 w-full">
                  {status === 'ready' && (
                    <Button
                      onClick={startSigning}
                      disabled={isLoading}
                      className="flex-1"
                    >
                      {recipient?.client_user_id ? (
                        <>
                          <ExternalLink className="h-4 w-4 mr-2" />
                          Sign Now
                        </>
                      ) : (
                        'Check Email'
                      )}
                    </Button>
                  )}

                  {status === 'signing' && signingUrl && (
                    <Button
                      onClick={() => window.open(signingUrl, 'docusign-signing', 'width=1000,height=700')}
                      className="flex-1"
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Open Signing Window
                    </Button>
                  )}

                  {(status === 'completed' || status === 'error') && (
                    <Button onClick={onClose} className="flex-1">
                      Close
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Embedded Signing Frame */}
          {status === 'signing' && signingUrl && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">DocuSign Signing</CardTitle>
                <CardDescription>
                  Complete the signing process below
                </CardDescription>
              </CardHeader>
              <CardContent>
                <iframe
                  src={signingUrl}
                  className="w-full h-96 border rounded-lg"
                  title="DocuSign Signing"
                />
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
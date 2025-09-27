import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { SignatureCapture } from '@/components/signatures/SignatureCapture';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, FileText, AlertCircle } from 'lucide-react';

export const SignDocument: React.FC = () => {
  const { accessToken } = useParams<{ accessToken: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isSigned, setIsSigned] = useState(false);

  // Fetch recipient and envelope data using access token
  const { data: recipientData, isLoading } = useQuery({
    queryKey: ['recipient-by-token', accessToken],
    queryFn: async () => {
      if (!accessToken) throw new Error('Access token required');
      
      const { data, error } = await supabase
        .from('signature_recipients')
        .select(`
          *,
          envelope:signature_envelopes(*)
        `)
        .eq('access_token', accessToken)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!accessToken
  });

  const signatureMutation = useMutation({
    mutationFn: async (signatureData: string) => {
      const { data, error } = await supabase.functions.invoke('capture-digital-signature', {
        body: {
          access_token: accessToken,
          signature_data: signatureData,
          ip_address: null, // Would be set by server
          user_agent: navigator.userAgent
        }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setIsSigned(true);
      toast({
        title: "Signature captured successfully!",
        description: data.all_signed 
          ? "All parties have signed. The document is now complete."
          : "Your signature has been recorded. Waiting for other parties to sign."
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to capture signature",
        description: error.message || "An error occurred while capturing your signature.",
        variant: "destructive"
      });
    }
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Loading signing session...</p>
        </div>
      </div>
    );
  }

  if (!recipientData) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Invalid Link
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              This signing link is invalid or has expired. Please contact the sender for a new link.
            </p>
            <Button onClick={() => navigate('/')} className="w-full">
              Go Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (recipientData.status === 'signed' || isSigned) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-5 w-5" />
              Document Signed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              Thank you! You have successfully signed "{recipientData.envelope?.title}".
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Signed by:</span>
                <span className="font-medium">{recipientData.recipient_name}</span>
              </div>
              <div className="flex justify-between">
                <span>Signed at:</span>
                <span className="font-medium">
                  {recipientData.signed_at 
                    ? new Date(recipientData.signed_at).toLocaleString()
                    : 'Just now'
                  }
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (recipientData.envelope?.status === 'voided') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Document Voided
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              This document has been voided and is no longer available for signing.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Digital Signature Required</h1>
          <p className="text-muted-foreground">
            Please review and sign the document below
          </p>
        </div>

        {/* Document Info Alert */}
        <Alert className="mb-6">
          <FileText className="h-4 w-4" />
          <AlertDescription>
            <strong>{recipientData.envelope?.title}</strong> - 
            Envelope #{recipientData.envelope?.envelope_number}
            {recipientData.envelope?.expires_at && (
              <span className="ml-2">
                (Expires: {new Date(recipientData.envelope.expires_at).toLocaleDateString()})
              </span>
            )}
          </AlertDescription>
        </Alert>

        {/* Document Information */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Document Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm">
              <p className="font-medium">Envelope</p>
              <p className="text-muted-foreground">#{recipientData.envelope?.envelope_number}</p>
              <p className="font-medium mt-2">Recipient</p>
              <p className="text-muted-foreground">{recipientData.recipient_email}</p>
            </div>
          </CardContent>
        </Card>

        {/* Signature Capture */}
        <SignatureCapture
          recipientName={recipientData.recipient_name}
          documentTitle={recipientData.envelope?.title || 'Document'}
          onSignatureCapture={(signatureData) => signatureMutation.mutate(signatureData)}
          isLoading={signatureMutation.isPending}
        />

        {/* Footer */}
        <div className="text-center mt-8 text-sm text-muted-foreground">
          <p>
            By signing this document, you agree to the terms and conditions outlined above.
            Your signature will be legally binding.
          </p>
        </div>
      </div>
    </div>
  );
};
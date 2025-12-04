import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Check, RotateCcw, Pen, FileText, Shield, AlertCircle, Loader2 } from 'lucide-react';

interface SignatureEnvelope {
  id: string;
  title: string;
  status: string;
  document_html?: string;
  document_url?: string;
  signature_recipients: {
    id: string;
    email: string;
    name: string;
    role: string;
    status: string;
  }[];
}

const PublicSignatureCapture = () => {
  const { token } = useParams<{ token: string }>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [envelope, setEnvelope] = useState<SignatureEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [signatureMethod, setSignatureMethod] = useState<'draw' | 'type'>('draw');

  useEffect(() => {
    if (token) {
      loadEnvelope();
    }
  }, [token]);

  useEffect(() => {
    if (canvasRef.current && signatureMethod === 'draw') {
      initCanvas();
    }
  }, [signatureMethod, envelope]);

  const loadEnvelope = async () => {
    try {
      setLoading(true);
      
      // Look up envelope by access token
      const { data: recipient, error: recipientError } = await supabase
        .from('signature_recipients')
        .select(`
          *,
          signature_envelopes(*)
        `)
        .eq('access_token', token)
        .single();

      if (recipientError || !recipient) {
        setError('Invalid or expired signature link. Please request a new link from the sender.');
        return;
      }

      if (recipient.status === 'signed') {
        setCompleted(true);
        setEnvelope({
          id: (recipient.signature_envelopes as any).id,
          title: (recipient.signature_envelopes as any).title,
          status: 'signed',
          signature_recipients: [{
            id: recipient.id,
            email: recipient.recipient_email,
            name: recipient.recipient_name,
            role: recipient.recipient_role,
            status: recipient.status
          }]
        });
        return;
      }

      setEnvelope({
        id: (recipient.signature_envelopes as any).id,
        title: (recipient.signature_envelopes as any).title,
        status: (recipient.signature_envelopes as any).status,
        document_html: (recipient.signature_envelopes as any).document_html,
        document_url: (recipient.signature_envelopes as any).document_url,
        signature_recipients: [{
          id: recipient.id,
          email: recipient.recipient_email,
          name: recipient.recipient_name,
          role: recipient.recipient_role,
          status: recipient.status
        }]
      });
      
      setTypedName(recipient.recipient_name || '');
    } catch (err) {
      console.error('Error loading envelope:', err);
      setError('Failed to load document. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const initCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);

    // Set drawing styles
    ctx.strokeStyle = '#1e3a5f';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    
    if ('touches' in e) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top
      };
    }
    
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    setIsDrawing(true);
    const { x, y } = getCanvasCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    if ('touches' in e) {
      e.preventDefault();
    }

    const { x, y } = getCanvasCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false);
      setHasSignature(true);
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  const getSignatureData = (): string | null => {
    if (signatureMethod === 'type') {
      // Generate signature from typed name
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 100;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#1e3a5f';
      ctx.font = 'italic 32px "Brush Script MT", cursive';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(typedName, 200, 50);
      
      return canvas.toDataURL('image/png');
    } else {
      const canvas = canvasRef.current;
      if (!canvas || !hasSignature) return null;
      return canvas.toDataURL('image/png');
    }
  };

  const handleSubmit = async () => {
    if (signatureMethod === 'type' && !typedName.trim()) {
      toast.error('Please type your name to sign');
      return;
    }
    
    if (signatureMethod === 'draw' && !hasSignature) {
      toast.error('Please draw your signature');
      return;
    }

    const signatureData = getSignatureData();
    if (!signatureData) {
      toast.error('Failed to capture signature');
      return;
    }

    try {
      setSubmitting(true);
      
      const recipient = envelope?.signature_recipients[0];
      if (!recipient) {
        throw new Error('No recipient found');
      }

      // Capture digital signature
      const { error: sigError } = await supabase
        .from('digital_signatures')
        .insert({
          envelope_id: envelope?.id!,
          recipient_id: recipient.id,
          tenant_id: '14de934e-7964-4afd-940a-620d2ace125d',
          signature_data: signatureData,
          signature_hash: btoa(signatureData.slice(0, 100)),
          signed_at: new Date().toISOString()
        } as any);

      if (sigError) throw sigError;

      // Update recipient status
      const { error: updateError } = await supabase
        .from('signature_recipients')
        .update({ 
          status: 'signed',
          signed_at: new Date().toISOString()
        })
        .eq('id', recipient.id);

      if (updateError) throw updateError;

      // Check if all recipients have signed
      const { data: allRecipients } = await supabase
        .from('signature_recipients')
        .select('status')
        .eq('envelope_id', envelope?.id);

      const allSigned = allRecipients?.every(r => r.status === 'signed');
      
      if (allSigned) {
        await supabase
          .from('signature_envelopes')
          .update({ 
            status: 'completed',
            completed_at: new Date().toISOString()
          })
          .eq('id', envelope?.id);
      }

      setCompleted(true);
      toast.success('Signature captured successfully!');
    } catch (err) {
      console.error('Error submitting signature:', err);
      toast.error('Failed to submit signature. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Loading document...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-12">
            <AlertCircle className="h-12 w-12 text-destructive mb-4" />
            <h2 className="text-lg font-semibold mb-2">Unable to Load Document</h2>
            <p className="text-muted-foreground text-center">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (completed) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-12">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <Check className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-xl font-semibold mb-2">Signature Complete!</h2>
            <p className="text-muted-foreground text-center mb-4">
              Thank you for signing. A copy of the signed document will be sent to your email.
            </p>
            <Badge variant="default" className="bg-green-500">
              <Shield className="h-3 w-3 mr-1" />
              Securely Signed
            </Badge>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 mb-2">
              <FileText className="h-5 w-5 text-primary" />
              <Badge variant="outline">Document Signing</Badge>
            </div>
            <CardTitle>{envelope?.title || 'Document'}</CardTitle>
            <CardDescription>
              Please review and sign the document below
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">
                {envelope?.signature_recipients[0]?.name}
              </Badge>
              <span>•</span>
              <span>{envelope?.signature_recipients[0]?.email}</span>
            </div>
          </CardContent>
        </Card>

        {/* Document Preview (if available) */}
        {envelope?.document_url && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Document Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-hidden bg-white">
                <iframe
                  src={envelope.document_url}
                  className="w-full h-[400px]"
                  title="Document Preview"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Signature Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Pen className="h-5 w-5" />
                <CardTitle className="text-lg">Your Signature</CardTitle>
              </div>
              <div className="flex gap-2">
                <Button
                  variant={signatureMethod === 'draw' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSignatureMethod('draw')}
                >
                  Draw
                </Button>
                <Button
                  variant={signatureMethod === 'type' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSignatureMethod('type')}
                >
                  Type
                </Button>
              </div>
            </div>
            <CardDescription>
              {signatureMethod === 'draw' 
                ? 'Draw your signature in the box below' 
                : 'Type your full legal name'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {signatureMethod === 'draw' ? (
              <>
                <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-4 bg-white">
                  <canvas
                    ref={canvasRef}
                    className="w-full h-40 cursor-crosshair touch-none"
                    style={{ touchAction: 'none' }}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                  />
                </div>
                {hasSignature && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearCanvas}
                    className="flex items-center gap-2"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Clear Signature
                  </Button>
                )}
              </>
            ) : (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="typedName">Full Legal Name</Label>
                  <Input
                    id="typedName"
                    value={typedName}
                    onChange={(e) => setTypedName(e.target.value)}
                    placeholder="Enter your full name"
                    className="text-lg"
                  />
                </div>
                {typedName && (
                  <div className="border rounded-lg p-4 bg-white">
                    <p className="text-sm text-muted-foreground mb-2">Signature Preview:</p>
                    <p 
                      className="text-3xl text-primary"
                      style={{ fontFamily: '"Brush Script MT", cursive', fontStyle: 'italic' }}
                    >
                      {typedName}
                    </p>
                  </div>
                )}
              </div>
            )}

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="printedName">Printed Name (for records)</Label>
              <Input
                id="printedName"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder="Enter your printed name"
              />
            </div>

            <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
              <p className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                By signing, you agree that your electronic signature is legally binding.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Submit Button */}
        <div className="flex justify-end gap-3">
          <Button
            size="lg"
            onClick={handleSubmit}
            disabled={submitting || (signatureMethod === 'draw' && !hasSignature) || (signatureMethod === 'type' && !typedName.trim())}
            className="flex items-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Complete Signature
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PublicSignatureCapture;
import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { supabase } from '@/integrations/supabase/client';
import { MobilePDFViewer } from '@/components/ui/MobilePDFViewer';
import { toast } from 'sonner';
import { Check, RotateCcw, Pen, FileText, Shield, AlertCircle, Loader2, Download } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

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
  const [sheetOpen, setSheetOpen] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (token) {
      loadEnvelope();
    }
  }, [token]);

  useEffect(() => {
    if (canvasRef.current && signatureMethod === 'draw' && sheetOpen) {
      const timer = setTimeout(() => initCanvas(), 150);
      return () => clearTimeout(timer);
    }
  }, [signatureMethod, sheetOpen]);

  const loadEnvelope = async () => {
    try {
      setLoading(true);
      
      const { data, error: fnError } = await supabase.functions.invoke('signer-open', {
        body: { access_token: token }
      });

      if (fnError || !data?.data) {
        const errorCode = data?.error?.code;
        if (errorCode === 'ALREADY_SIGNED') {
          setCompleted(true);
          const envData = data?.data?.envelope;
          const recipData = data?.data?.recipient;
          setEnvelope({
            id: envData?.id || '',
            title: envData?.title || 'Document',
            status: 'signed',
            signature_recipients: [{
              id: recipData?.id || '',
              email: recipData?.email || '',
              name: recipData?.name || '',
              role: 'signer',
              status: 'signed'
            }]
          });
          return;
        }
        setError('Invalid or expired signature link. Please request a new link from the sender.');
        return;
      }

      const { envelope: envData, recipient: recipData } = data.data;

      if (recipData.status === 'signed') {
        setCompleted(true);
        setEnvelope({
          id: envData.id,
          title: envData.title,
          status: 'signed',
          signature_recipients: [{
            id: recipData.id,
            email: recipData.email,
            name: recipData.name,
            role: 'signer',
            status: 'signed'
          }]
        });
        return;
      }

      setEnvelope({
        id: envData.id,
        title: envData.title,
        status: envData.status,
        document_url: envData.pdf_url,
        signature_recipients: [{
          id: recipData.id,
          email: recipData.email,
          name: recipData.name,
          role: 'signer',
          status: recipData.status
        }]
      });
      
      setTypedName(recipData.name || '');
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
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);
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
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
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
    if ('touches' in e) e.preventDefault();
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
      const { data, error: submitError } = await supabase.functions.invoke('submit-signature', {
        body: {
          access_token: token,
          signature_data: signatureData,
          signature_type: signatureMethod === 'draw' ? 'drawn' : 'typed',
          consent_agreed: true,
        }
      });
      if (submitError) throw submitError;
      if (data?.error) throw new Error(data.error?.message || data.error);
      setCompleted(true);
      setSheetOpen(false);
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
        <Card className="w-full max-w-md mx-4">
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

  // Determine sheet side based on device
  const sheetSide = isMobile ? 'bottom' : 'right';

  return (
    <div className="min-h-screen bg-muted flex flex-col">
      {/* Header bar */}
      <div className="bg-background border-b px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between shrink-0 safe-area-top">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 sm:h-5 sm:w-5 text-primary shrink-0" />
          <h1 className="font-semibold text-sm sm:text-lg truncate">{envelope?.title || 'Document'}</h1>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {envelope?.document_url && (
            <a href={envelope.document_url} target="_blank" rel="noopener noreferrer" download>
              <Button variant="outline" size="sm" className="h-8 sm:h-9 px-2 sm:px-3">
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline ml-1.5">Download</span>
              </Button>
            </a>
          )}
          <Button size="sm" onClick={() => setSheetOpen(true)} className="h-8 sm:h-9 px-2.5 sm:px-3">
            <Pen className="h-4 w-4" />
            <span className="ml-1.5">Sign</span>
          </Button>
        </div>
      </div>

      {/* PDF viewer - uses MobilePDFViewer for cross-browser/device support */}
      <div className="flex-1 min-h-0">
        {envelope?.document_url ? (
          <MobilePDFViewer
            url={envelope.document_url}
            title={envelope.title || 'Document'}
            filename={`${envelope.title || 'document'}.pdf`}
            className="h-full w-full"
            showControls={true}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center p-6">
            <p className="text-muted-foreground">No document preview available</p>
          </div>
        )}
      </div>

      {/* Sticky mobile CTA bar */}
      {isMobile && !sheetOpen && (
        <div className="shrink-0 bg-background border-t p-3 safe-area-bottom">
          <Button
            size="lg"
            className="w-full h-12 text-base font-semibold"
            onClick={() => setSheetOpen(true)}
          >
            <Pen className="h-5 w-5 mr-2" />
            Approve & Sign Document
          </Button>
        </div>
      )}

      {/* Signature drawer - bottom on mobile, right on desktop */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side={sheetSide}
          className={
            isMobile
              ? 'w-full max-h-[85vh] overflow-y-auto rounded-t-2xl'
              : 'w-full sm:max-w-md overflow-y-auto'
          }
        >
          <SheetHeader>
            <SheetTitle className="text-base sm:text-lg">Sign Document</SheetTitle>
            <SheetDescription className="text-xs sm:text-sm">
              Review the document, then sign below to complete.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 sm:mt-6 space-y-4 sm:space-y-5">
            {/* Signer info */}
            <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
              <Badge variant="secondary" className="text-xs">
                {envelope?.signature_recipients[0]?.name}
              </Badge>
              <span>•</span>
              <span className="truncate text-xs">{envelope?.signature_recipients[0]?.email}</span>
            </div>

            {/* Signature method toggle */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Pen className="h-4 w-4" />
                  <span className="font-semibold text-sm sm:text-base">Your Signature</span>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant={signatureMethod === 'draw' ? 'default' : 'outline'}
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setSignatureMethod('draw')}
                  >
                    Draw
                  </Button>
                  <Button
                    variant={signatureMethod === 'type' ? 'default' : 'outline'}
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setSignatureMethod('type')}
                  >
                    Type
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                {signatureMethod === 'draw'
                  ? 'Draw your signature in the box below'
                  : 'Type your full legal name'}
              </p>

              {signatureMethod === 'draw' ? (
                <>
                  <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-2 sm:p-3 bg-white">
                    <canvas
                      ref={canvasRef}
                      className="w-full h-28 sm:h-32 cursor-crosshair touch-none"
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
                      className="flex items-center gap-2 mt-2 h-8"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Clear
                    </Button>
                  )}
                </>
              ) : (
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="typedName" className="text-xs">Full Legal Name</Label>
                    <Input
                      id="typedName"
                      value={typedName}
                      onChange={(e) => setTypedName(e.target.value)}
                      placeholder="Enter your full name"
                      className="h-10"
                    />
                  </div>
                  {typedName && (
                    <div className="border rounded-lg p-3 bg-white">
                      <p className="text-xs text-muted-foreground mb-1">Preview:</p>
                      <p
                        className="text-2xl text-primary"
                        style={{ fontFamily: '"Brush Script MT", cursive', fontStyle: 'italic' }}
                      >
                        {typedName}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <Separator />

            {/* Printed name */}
            <div className="space-y-1.5">
              <Label htmlFor="printedName" className="text-xs">Printed Name</Label>
              <Input
                id="printedName"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder="Enter your printed name"
                className="h-10"
              />
            </div>

            {/* Legal notice */}
            <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground">
              <p className="flex items-center gap-2">
                <Shield className="h-3 w-3 flex-shrink-0" />
                By signing, you confirm your approval of this document.
              </p>
            </div>

            {/* Submit */}
            <Button
              size="lg"
              className="w-full flex items-center gap-2 h-12 text-base"
              onClick={handleSubmit}
              disabled={submitting || (signatureMethod === 'draw' && !hasSignature) || (signatureMethod === 'type' && !typedName.trim())}
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
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default PublicSignatureCapture;
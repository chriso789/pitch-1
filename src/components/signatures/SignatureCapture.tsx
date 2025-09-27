import React, { useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { RotateCcw, Check, Pen } from 'lucide-react';

interface SignatureCaptureProps {
  recipientName: string;
  documentTitle: string;
  onSignatureCapture: (signatureData: string) => void;
  isLoading?: boolean;
}

export const SignatureCapture: React.FC<SignatureCaptureProps> = ({
  recipientName,
  documentTitle,
  onSignatureCapture,
  isLoading = false
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  useEffect(() => {
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsDrawing(true);
    
    let x, y;
    if ('touches' in e) {
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    } else {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }

    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let x, y;
    if ('touches' in e) {
      e.preventDefault(); // Prevent scrolling
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    } else {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false);
      setHasSignature(true);
    }
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  const captureSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasSignature) return;

    const signatureData = canvas.toDataURL('image/png');
    onSignatureCapture(signatureData);
  };

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    // Set drawing styles
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      {/* Document Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{documentTitle}</CardTitle>
          <CardDescription>
            Please sign below to complete the agreement
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Badge variant="outline">Signer</Badge>
            <span className="font-medium">{recipientName}</span>
          </div>
        </CardContent>
      </Card>

      {/* Signature Pad */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Pen className="h-5 w-5" />
              <CardTitle className="text-lg">Your Signature</CardTitle>
            </div>
            {hasSignature && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearSignature}
                className="flex items-center gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                Clear
              </Button>
            )}
          </div>
          <CardDescription>
            {isTouchDevice 
              ? "Use your finger to sign in the box below" 
              : "Use your mouse to sign in the box below"
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-4 bg-muted/10">
            <canvas
              ref={canvasRef}
              className="w-full h-48 cursor-crosshair touch-none"
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
              style={{ touchAction: 'none' }}
            />
          </div>
          
          {!hasSignature && (
            <p className="text-sm text-muted-foreground mt-2 text-center">
              {isTouchDevice ? "Tap and drag to sign" : "Click and drag to sign"}
            </p>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <Button
          variant="outline"
          onClick={clearSignature}
          disabled={!hasSignature || isLoading}
        >
          Clear Signature
        </Button>
        <Button
          onClick={captureSignature}
          disabled={!hasSignature || isLoading}
          className="flex items-center gap-2"
        >
          <Check className="h-4 w-4" />
          {isLoading ? 'Submitting...' : 'Complete Signature'}
        </Button>
      </div>
    </div>
  );
};
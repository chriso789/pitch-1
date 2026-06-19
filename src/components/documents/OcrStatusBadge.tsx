import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, ScanText, AlertCircle, CheckCircle2, RotateCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export type OcrStatus = 'not_started' | 'processing' | 'completed' | 'failed' | 'needs_worker' | null | undefined;

interface OcrStatusBadgeProps {
  documentId: string;
  status: OcrStatus;
  error?: string | null;
  onRetried?: () => void;
  className?: string;
}

export const OcrStatusBadge: React.FC<OcrStatusBadgeProps> = ({
  documentId,
  status,
  error,
  onRetried,
  className,
}) => {
  const [retrying, setRetrying] = useState(false);

  const retry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRetrying(true);
    try {
      await supabase
        .from('documents')
        .update({ ocr_status: 'processing', ocr_error: null } as any)
        .eq('id', documentId);
      const { error: invokeErr } = await supabase.functions.invoke('ocr-scanned-document', {
        body: { document_id: documentId },
      });
      if (invokeErr) throw invokeErr;
      toast({ title: 'OCR restarted', description: 'Text extraction is running.' });
      onRetried?.();
    } catch (err: any) {
      toast({
        title: 'Retry failed',
        description: err?.message ?? 'Could not restart OCR.',
        variant: 'destructive',
      });
    } finally {
      setRetrying(false);
    }
  };

  if (!status || status === 'not_started') {
    return (
      <Badge variant="outline" className={cn('gap-1 text-muted-foreground', className)}>
        <ScanText className="h-3 w-3" /> OCR pending
      </Badge>
    );
  }

  if (status === 'processing') {
    return (
      <Badge variant="outline" className={cn('gap-1 text-blue-600 border-blue-300', className)}>
        <Loader2 className="h-3 w-3 animate-spin" /> OCR processing
      </Badge>
    );
  }

  if (status === 'completed') {
    return (
      <Badge variant="outline" className={cn('gap-1 text-emerald-600 border-emerald-300', className)}>
        <CheckCircle2 className="h-3 w-3" /> Searchable
      </Badge>
    );
  }

  // failed
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <Badge
        variant="outline"
        className="gap-1 text-destructive border-destructive/40"
        title={error ?? undefined}
      >
        <AlertCircle className="h-3 w-3" /> OCR failed
      </Badge>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-xs gap-1"
        onClick={retry}
        disabled={retrying}
      >
        {retrying ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
        Retry
      </Button>
    </span>
  );
};

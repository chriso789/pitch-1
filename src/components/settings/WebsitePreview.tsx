import { useState, useEffect } from 'react';
import { CheckCircle2, Loader2, AlertCircle, Globe } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface WebsiteData {
  verified: boolean;
  url?: string;
  domain?: string;
  title?: string;
  favicon?: string;
  description?: string;
  error?: string;
}

interface WebsitePreviewProps {
  url: string;
  onVerified?: (data: WebsiteData) => void;
}

export const WebsitePreview = ({ url, onVerified }: WebsitePreviewProps) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<WebsiteData | null>(null);
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Clear previous timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    // Don't verify empty or very short URLs
    if (!url || url.length < 4) {
      setData(null);
      return;
    }

    // Debounce the verification
    const timer = setTimeout(() => {
      verifyWebsite(url);
    }, 500);

    setDebounceTimer(timer);

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [url]);

  const verifyWebsite = async (websiteUrl: string) => {
    setLoading(true);
    try {
      const { data: result, error } = await supabase.functions.invoke('verify-website', {
        body: { url: websiteUrl }
      });

      if (error) throw error;

      setData(result);
      onVerified?.(result);
    } catch (error: any) {
      setData({ verified: false, error: error.message });
    } finally {
      setLoading(false);
    }
  };

  if (!url || url.length < 4) return null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border border-border animate-pulse">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Verifying website...</span>
      </div>
    );
  }

  if (!data) return null;

  if (!data.verified) {
    return (
      <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-lg border border-destructive/20">
        <AlertCircle className="h-4 w-4 text-destructive" />
        <span className="text-sm text-destructive">
          {data.error || 'Could not verify website'}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-lg border border-primary/20">
      {data.favicon ? (
        <img 
          src={data.favicon} 
          alt="favicon" 
          className="h-8 w-8 rounded"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <Globe className="h-8 w-8 text-muted-foreground" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{data.title}</span>
          <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
        </div>
        <span className="text-xs text-muted-foreground">{data.domain}</span>
      </div>
    </div>
  );
};

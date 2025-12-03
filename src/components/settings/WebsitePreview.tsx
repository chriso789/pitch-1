import { useState, useEffect } from 'react';
import { CheckCircle2, Loader2, AlertCircle, Globe, Clock } from 'lucide-react';
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

// Check if URL has a valid TLD (supports .com, .org, .net, .io, country codes, etc.)
const hasValidTLD = (url: string): boolean => {
  // Match common TLDs including .org, .com, .net, .io, .co, country codes, etc.
  const tldPattern = /\.[a-z]{2,}(\/|$|\?|#)/i;
  const endsWithTLD = /\.[a-z]{2,}$/i;
  return tldPattern.test(url) || endsWithTLD.test(url);
};

// Normalize URL for verification
const normalizeUrl = (url: string): string => {
  let normalized = url.trim();
  if (!normalized) return '';
  
  // Add https:// if no protocol
  if (!normalized.match(/^https?:\/\//i)) {
    normalized = 'https://' + normalized;
  }
  
  return normalized;
};

export const WebsitePreview = ({ url, onVerified }: WebsitePreviewProps) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<WebsiteData | null>(null);
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);
  const [waitingForComplete, setWaitingForComplete] = useState(false);

  useEffect(() => {
    // Clear previous timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    // Don't verify empty or very short URLs
    if (!url || url.length < 4) {
      setData(null);
      setWaitingForComplete(false);
      return;
    }

    const normalizedUrl = normalizeUrl(url);
    
    // Check if URL appears complete (has a valid TLD)
    if (!hasValidTLD(normalizedUrl)) {
      setWaitingForComplete(true);
      setData(null);
      return;
    }

    setWaitingForComplete(false);

    // Debounce the verification with longer delay
    const timer = setTimeout(() => {
      verifyWebsite(normalizedUrl);
    }, 800);

    setDebounceTimer(timer);

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [url]);

  const verifyWebsite = async (websiteUrl: string) => {
    setLoading(true);
    console.log('[WebsitePreview] Verifying URL:', websiteUrl);
    
    try {
      const { data: result, error } = await supabase.functions.invoke('verify-website', {
        body: { url: websiteUrl }
      });

      console.log('[WebsitePreview] Verification result:', result, 'Error:', error);

      if (error) throw error;

      setData(result);
      onVerified?.(result);
    } catch (error: any) {
      console.error('[WebsitePreview] Verification error:', error);
      setData({ verified: false, error: error.message });
    } finally {
      setLoading(false);
    }
  };

  if (!url || url.length < 4) return null;

  // Show waiting message while user is typing incomplete URL
  if (waitingForComplete) {
    return (
      <div className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg border border-border">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          Waiting for complete URL (e.g., example.com or example.org)...
        </span>
      </div>
    );
  }

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

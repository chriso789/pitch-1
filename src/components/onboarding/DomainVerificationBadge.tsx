/**
 * Domain Verification Badge Component
 * Shows verification status for company email domains
 */

import { useState } from 'react';
import { CheckCircle2, AlertCircle, Clock, Shield, RefreshCw, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface DomainVerificationBadgeProps {
  domain: string;
  status: 'pending' | 'verified' | 'failed' | 'blocked';
  dnsTxtRecord?: string;
  onVerify?: () => void;
}

export function DomainVerificationBadge({ 
  domain, 
  status, 
  dnsTxtRecord,
  onVerify 
}: DomainVerificationBadgeProps) {
  const [verifying, setVerifying] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke('verify-company-domain', {
        body: { domain, action: 'verify' }
      });

      if (error) throw error;

      if (data?.verified) {
        toast({ title: 'Domain Verified!', description: `${domain} has been successfully verified.` });
        onVerify?.();
      } else {
        toast({ 
          title: 'Verification Failed', 
          description: data?.message || 'DNS record not found. Please add the TXT record and try again.',
          variant: 'destructive'
        });
      }
    } catch (err: any) {
      toast({ 
        title: 'Verification Error', 
        description: err.message,
        variant: 'destructive' 
      });
    } finally {
      setVerifying(false);
    }
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'verified':
        return (
          <Badge variant="default" className="bg-green-500 hover:bg-green-600">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Verified
          </Badge>
        );
      case 'pending':
        return (
          <Badge variant="secondary">
            <Clock className="h-3 w-3 mr-1" />
            Pending Verification
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive">
            <AlertCircle className="h-3 w-3 mr-1" />
            Verification Failed
          </Badge>
        );
      case 'blocked':
        return (
          <Badge variant="destructive">
            <Shield className="h-3 w-3 mr-1" />
            Blocked Domain
          </Badge>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex items-center gap-2">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {getStatusBadge()}
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {status === 'verified' && 'This domain has been verified as belonging to your company'}
              {status === 'pending' && 'Domain verification is pending - add DNS TXT record'}
              {status === 'failed' && 'Domain verification failed - check DNS settings'}
              {status === 'blocked' && 'This is a blocked email domain (free email provider)'}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {status === 'pending' && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              Verify Domain
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Verify Domain: {domain}</DialogTitle>
              <DialogDescription>
                Add a DNS TXT record to verify ownership of this domain
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-muted">
                <p className="text-sm font-medium mb-2">Add this TXT record to your DNS:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-2 bg-background rounded text-xs break-all">
                    {dnsTxtRecord || `pitch-verify=${domain.split('.')[0]}`}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(dnsTxtRecord || `pitch-verify=${domain.split('.')[0]}`);
                      toast({ title: 'Copied to clipboard' });
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </div>

              <div className="space-y-2 text-sm text-muted-foreground">
                <p>Instructions:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Log in to your domain registrar (GoDaddy, Cloudflare, etc.)</li>
                  <li>Go to DNS settings for {domain}</li>
                  <li>Add a new TXT record with the value above</li>
                  <li>Wait 5-10 minutes for DNS propagation</li>
                  <li>Click "Verify Now" below</li>
                </ol>
              </div>

              <div className="flex gap-2">
                <Button 
                  onClick={handleVerify} 
                  disabled={verifying}
                  className="flex-1"
                >
                  {verifying ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Checking...
                    </>
                  ) : (
                    'Verify Now'
                  )}
                </Button>
                <Button variant="outline" asChild>
                  <a 
                    href="https://mxtoolbox.com/txtlookup.aspx"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Check DNS <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {status === 'failed' && (
        <Button 
          variant="outline" 
          size="sm"
          onClick={handleVerify}
          disabled={verifying}
        >
          {verifying ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Retry'}
        </Button>
      )}
    </div>
  );
}

// Inline domain validation display
interface DomainValidationDisplayProps {
  email: string;
  isBlocked: boolean;
  blockedReason?: string;
}

export function DomainValidationDisplay({ email, isBlocked, blockedReason }: DomainValidationDisplayProps) {
  if (!email || !email.includes('@')) return null;

  const domain = email.split('@')[1];

  if (isBlocked) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive mt-1">
        <AlertCircle className="h-4 w-4" />
        <span>
          {blockedReason || `${domain} is a free email provider. Please use a company email address.`}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm text-green-600 mt-1">
      <CheckCircle2 className="h-4 w-4" />
      <span>Business email domain accepted</span>
    </div>
  );
}

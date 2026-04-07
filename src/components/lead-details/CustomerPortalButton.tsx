import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ExternalLink, Copy, Loader2, Link2 } from 'lucide-react';

interface CustomerPortalButtonProps {
  projectId: string;
  contactId: string;
  className?: string;
}

export const CustomerPortalButton: React.FC<CustomerPortalButtonProps> = ({
  projectId,
  contactId,
  className,
}) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const { toast } = useToast();

  const generateLink = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke('customer-portal-access', {
        body: { action: 'generate', project_id: projectId, contact_id: contactId },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to generate link');

      setPortalUrl(data.portal_url);
      setOpen(true);
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to generate portal link',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async () => {
    if (!portalUrl) return;
    await navigator.clipboard.writeText(portalUrl);
    toast({ title: 'Copied!', description: 'Portal link copied to clipboard' });
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={generateLink}
        disabled={loading}
        className={className}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Link2 className="h-4 w-4 mr-2" />
        )}
        Customer Portal Link
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Customer Portal Link</DialogTitle>
            <DialogDescription>
              Share this link with your customer so they can view project status, documents, and make payments.
              Link expires in 30 days.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input value={portalUrl || ''} readOnly className="font-mono text-xs" />
            <Button variant="outline" size="icon" onClick={copyToClipboard}>
              <Copy className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" asChild>
              <a href={portalUrl || '#'} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

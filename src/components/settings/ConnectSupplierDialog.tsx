import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

type SupplierKey = 'abc' | 'srs' | 'qxo';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier: SupplierKey | null;
  tenantId: string;
  onConnected?: () => void;
}

const META: Record<SupplierKey, { name: string; help: string }> = {
  abc: {
    name: 'ABC Supply',
    help: 'Enter the ABC Supply account number provided by your ABC rep. Pitch will request production API access on your behalf.',
  },
  srs: {
    name: 'SRS Distribution',
    help: 'Enter your SRS Customer Code and Integration Key. Don\'t have one? Email APISupportTeam@srsdistribution.com.',
  },
  qxo: {
    name: 'QXO / Beacon',
    help: 'Enter your QXO/Beacon API username, password, and Client ID provided by your QXO partner integrations rep.',
  },
};

/**
 * Normal-tenant Connect dialog. Captures the minimum fields each supplier
 * needs and saves them via the same edge functions used by the developer
 * panel — environment is always `production`. No sandbox / OAuth URL /
 * webhook tooling is exposed here.
 */
export function ConnectSupplierDialog({ open, onOpenChange, supplier, tenantId, onConnected }: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  // ABC
  const [abcAccount, setAbcAccount] = useState('');
  const [abcBranch, setAbcBranch] = useState('');

  // SRS
  const [srsCustomerCode, setSrsCustomerCode] = useState('');
  const [srsClientId, setSrsClientId] = useState('');
  const [srsClientSecret, setSrsClientSecret] = useState('');
  const [srsIntegrationKey, setSrsIntegrationKey] = useState('');

  // QXO
  const [qxoUsername, setQxoUsername] = useState('');
  const [qxoPassword, setQxoPassword] = useState('');
  const [qxoClientId, setQxoClientId] = useState('');

  if (!supplier) return null;
  const meta = META[supplier];

  const reset = () => {
    setAbcAccount(''); setAbcBranch('');
    setSrsCustomerCode(''); setSrsClientId(''); setSrsClientSecret(''); setSrsIntegrationKey('');
    setQxoUsername(''); setQxoPassword(''); setQxoClientId('');
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      if (supplier === 'abc') {
        if (!abcAccount.trim()) throw new Error('ABC account number is required.');
        const { data, error } = await supabase.functions.invoke('abc-save-account', {
          body: {
            tenant_id: tenantId,
            account_number: abcAccount.trim(),
            default_branch_code: abcBranch.trim() || null,
            environment: 'production',
          },
        });
        if (error) throw error;
        if (!data?.success) throw new Error(data?.error || 'Save failed');
      } else if (supplier === 'srs') {
        if (!srsClientId.trim() || !srsClientSecret.trim()) {
          throw new Error('SRS Client ID and Client Secret are required.');
        }
        const { data, error } = await supabase.functions.invoke('srs-api-proxy', {
          body: {
            action: 'save_credentials',
            tenant_id: tenantId,
            client_id: srsClientId.trim(),
            client_secret: srsClientSecret.trim(),
            customer_code: srsCustomerCode.trim(),
            environment: 'production',
            integration_key: srsIntegrationKey.trim() || undefined,
          },
        });
        if (error) throw error;
        if (!data?.success) throw new Error(data?.error || 'Save failed');
      } else if (supplier === 'qxo') {
        if (!qxoUsername.trim() || !qxoPassword.trim()) {
          throw new Error('QXO username and password are required.');
        }
        const { data, error } = await supabase.functions.invoke('qxo-save-credentials', {
          body: {
            tenant_id: tenantId,
            username: qxoUsername.trim(),
            password: qxoPassword,
            client_id: qxoClientId.trim() || null,
            site_id: 'dealersChoice',
            environment: 'production',
          },
        });
        if (error) throw error;
        if (!data?.success) throw new Error(data?.error || 'Save failed');
      }

      toast({ title: `${meta.name} connected`, description: 'Credentials saved securely.' });
      reset();
      onOpenChange(false);
      onConnected?.();
    } catch (e: any) {
      toast({ title: 'Connection failed', description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Connect {meta.name}</DialogTitle>
          <DialogDescription className="text-xs">{meta.help}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {supplier === 'abc' && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">ABC Account #</Label>
                <Input value={abcAccount} onChange={(e) => setAbcAccount(e.target.value)} placeholder="e.g. 1234567" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Default Branch / Ship-To (optional)</Label>
                <Input value={abcBranch} onChange={(e) => setAbcBranch(e.target.value)} placeholder="Branch code" />
              </div>
            </>
          )}

          {supplier === 'srs' && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Customer Code</Label>
                <Input value={srsCustomerCode} onChange={(e) => setSrsCustomerCode(e.target.value)} placeholder="e.g. ABC123" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Client ID</Label>
                <Input value={srsClientId} onChange={(e) => setSrsClientId(e.target.value)} placeholder="From SRS API team" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Client Secret</Label>
                <Input type="password" value={srsClientSecret} onChange={(e) => setSrsClientSecret(e.target.value)} autoComplete="new-password" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Integration Key (optional)</Label>
                <Input value={srsIntegrationKey} onChange={(e) => setSrsIntegrationKey(e.target.value)} placeholder="If issued by SRS" />
              </div>
            </>
          )}

          {supplier === 'qxo' && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Username / Email</Label>
                <Input value={qxoUsername} onChange={(e) => setQxoUsername(e.target.value)} placeholder="you@company.com" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Password</Label>
                <Input type="password" value={qxoPassword} onChange={(e) => setQxoPassword(e.target.value)} autoComplete="new-password" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">API Client ID</Label>
                <Input value={qxoClientId} onChange={(e) => setQxoClientId(e.target.value)} placeholder="From QXO partner integrations" />
              </div>
            </>
          )}

          <p className="text-[11px] text-muted-foreground pt-1">
            Credentials are stored server-side, encrypted, and never returned to the browser.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

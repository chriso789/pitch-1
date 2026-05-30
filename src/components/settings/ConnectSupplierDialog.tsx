import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
    help: "Connect your SRS account to Pitch. Enter your SRS Customer Code and Integration Key, or verify with a recent invoice. Need credentials? Email APISupportTeam@srsdistribution.com.",
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
 *
 * SRS specifically:
 *   - Tenants supply Customer Code + Integration Key OR validate with a
 *     recent invoice (Invoice #, Invoice Date, Billed Amount).
 *   - The Pitch partner OAuth client (SRS_CLIENT_ID / SRS_CLIENT_SECRET)
 *     is configured server-side; tenants never see it.
 *   - Save is chained with a server-side `validate` call so the connection
 *     only flips to "Connected" after SRS confirms the customer code.
 */
export function ConnectSupplierDialog({ open, onOpenChange, supplier, tenantId, onConnected }: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  // ABC
  const [abcAccount, setAbcAccount] = useState('');
  const [abcBranch, setAbcBranch] = useState('');

  // SRS
  const [srsMode, setSrsMode] = useState<'key' | 'invoice'>('key');
  const [srsCustomerCode, setSrsCustomerCode] = useState('');
  const [srsIntegrationKey, setSrsIntegrationKey] = useState('');
  const [srsInvoiceNumber, setSrsInvoiceNumber] = useState('');
  const [srsInvoiceDate, setSrsInvoiceDate] = useState('');
  const [srsBilledAmount, setSrsBilledAmount] = useState('');

  // QXO
  const [qxoUsername, setQxoUsername] = useState('');
  const [qxoPassword, setQxoPassword] = useState('');
  const [qxoClientId, setQxoClientId] = useState('');

  if (!supplier) return null;
  const meta = META[supplier];

  const reset = () => {
    setAbcAccount(''); setAbcBranch('');
    setSrsMode('key');
    setSrsCustomerCode(''); setSrsIntegrationKey('');
    setSrsInvoiceNumber(''); setSrsInvoiceDate(''); setSrsBilledAmount('');
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
        const customerCode = srsCustomerCode.trim();
        if (!customerCode) throw new Error('SRS Customer Code is required.');

        if (srsMode === 'key') {
          if (!srsIntegrationKey.trim()) {
            throw new Error('Integration Key is required (or switch to invoice validation).');
          }
        } else {
          if (!srsInvoiceNumber.trim() || !srsInvoiceDate.trim() || !srsBilledAmount.trim()) {
            throw new Error('Invoice #, Invoice Date, and Billed Amount are required.');
          }
        }

        // 1) Save tenant-scoped credentials (partner client_id/secret come
        //    from server env; never sent from the browser).
        const saveRes = await supabase.functions.invoke('srs-api-proxy', {
          body: {
            action: 'save_credentials',
            tenant_id: tenantId,
            customer_code: customerCode,
            environment: 'production',
            integration_key: srsMode === 'key' ? srsIntegrationKey.trim() : undefined,
          },
        });
        if (saveRes.error) throw saveRes.error;
        if (!saveRes.data?.success) throw new Error(saveRes.data?.error || 'Save failed');

        // 2) Validate against SRS so the connection only flips to
        //    "Connected" after SRS confirms the customer.
        const validateRes = await supabase.functions.invoke('srs-api-proxy', {
          body: srsMode === 'key'
            ? {
                action: 'validate',
                tenant_id: tenantId,
                integration_key: srsIntegrationKey.trim(),
              }
            : {
                action: 'validate',
                tenant_id: tenantId,
                invoice_number: srsInvoiceNumber.trim(),
                invoice_date: srsInvoiceDate.trim(),
                billed_amount: srsBilledAmount.trim(),
              },
        });
        if (validateRes.error) throw validateRes.error;
        const ok = (validateRes.data as any)?.success ?? (validateRes.data as any)?.valid ?? false;
        if (!ok) {
          throw new Error(
            (validateRes.data as any)?.error
              || (validateRes.data as any)?.message
              || 'SRS rejected the credentials. Double-check your Customer Code and try again.',
          );
        }
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

      toast({ title: `${meta.name} connected`, description: 'Credentials saved and verified.' });
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
                <Input
                  value={srsCustomerCode}
                  onChange={(e) => setSrsCustomerCode(e.target.value)}
                  placeholder="e.g. ABC123"
                  autoComplete="off"
                />
              </div>

              <Tabs value={srsMode} onValueChange={(v) => setSrsMode(v as 'key' | 'invoice')}>
                <TabsList className="grid grid-cols-2 w-full">
                  <TabsTrigger value="key">Integration Key</TabsTrigger>
                  <TabsTrigger value="invoice">Verify with invoice</TabsTrigger>
                </TabsList>
                <TabsContent value="key" className="pt-3 space-y-1">
                  <Label className="text-xs">Integration Key</Label>
                  <Input
                    value={srsIntegrationKey}
                    onChange={(e) => setSrsIntegrationKey(e.target.value)}
                    placeholder="Issued by SRS"
                    autoComplete="off"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Get your Integration Key from your SRS rep or by emailing APISupportTeam@srsdistribution.com.
                  </p>
                </TabsContent>
                <TabsContent value="invoice" className="pt-3 space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Recent Invoice #</Label>
                    <Input
                      value={srsInvoiceNumber}
                      onChange={(e) => setSrsInvoiceNumber(e.target.value)}
                      placeholder="e.g. INV-123456"
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Invoice Date</Label>
                    <Input
                      type="date"
                      value={srsInvoiceDate}
                      onChange={(e) => setSrsInvoiceDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Billed Amount (USD)</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={srsBilledAmount}
                      onChange={(e) => setSrsBilledAmount(e.target.value)}
                      placeholder="e.g. 1234.56"
                    />
                  </div>
                </TabsContent>
              </Tabs>
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
            {supplier === 'srs' ? 'Connect SRS Account' : 'Connect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

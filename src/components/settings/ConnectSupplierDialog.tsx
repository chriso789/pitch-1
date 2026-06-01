import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useSupplierDeveloperMode } from '@/lib/supplierAccess';

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
    help: "Sign in with your myABCSupply account. ABC will redirect you back to Pitch once you approve access — Pitch then pulls your account, ship-to, and branch list automatically. You don't need any ABC developer keys.",
  },
  srs: {
    name: 'SRS Distribution',
    help: "Enter your SRS Account Number. Optionally add a recent invoice for stronger account verification. Pitch validates and connects your SRS account securely server-side — you don't need any SRS developer keys.",
  },
  qxo: {
    name: 'QXO / Beacon',
    help: "Sign in with your QXO account. Pitch links this company to your QXO account so we can pull pricing and submit orders — you don't need any QXO developer keys.",
  },
};

/**
 * Normal-tenant Connect dialog. QXO uses a two-step in-app flow:
 *   1. Tenant signs in with their QXO email/password.
 *   2. Tenant picks the QXO account + default branch to use for this company.
 * Platform-level partner secrets (client_id/site_id) stay server-side.
 */
export function ConnectSupplierDialog({ open, onOpenChange, supplier, tenantId, onConnected }: Props) {
  const { toast } = useToast();
  const { canEnterAdvancedConnectFields } = useSupplierDeveloperMode();
  const [saving, setSaving] = useState(false);

  // ABC
  const [abcAccount, setAbcAccount] = useState('');
  const [abcBranch, setAbcBranch] = useState('');

  // SRS — tenant supplies only their own account info
  const [srsCustomerCode, setSrsCustomerCode] = useState('');
  const [srsInvoiceNumber, setSrsInvoiceNumber] = useState('');
  const [srsInvoiceDate, setSrsInvoiceDate] = useState('');

  // QXO — two-step
  const [qxoStep, setQxoStep] = useState<'auth' | 'map'>('auth');
  const [qxoUsername, setQxoUsername] = useState('');
  const [qxoPassword, setQxoPassword] = useState('');
  const [qxoSiteId, setQxoSiteId] = useState('');
  const [qxoAccounts, setQxoAccounts] = useState<Array<{ id: string; label: string }>>([]);
  const [qxoAccountId, setQxoAccountId] = useState('');
  const [qxoBranchCode, setQxoBranchCode] = useState('');
  const [qxoJobAccount, setQxoJobAccount] = useState('');
  const [qxoBranchContactName, setQxoBranchContactName] = useState('');
  const [qxoBranchContactPhone, setQxoBranchContactPhone] = useState('');
  const [qxoBranchContactEmail, setQxoBranchContactEmail] = useState('');
  const [qxoTemplates, setQxoTemplates] = useState<Array<{ id: string; name: string }>>([]);
  const [qxoTemplateId, setQxoTemplateId] = useState('');

  if (!supplier) return null;
  const meta = META[supplier];

  const reset = () => {
    setAbcAccount(''); setAbcBranch('');
    setSrsCustomerCode(''); setSrsInvoiceNumber(''); setSrsInvoiceDate('');
    setQxoStep('auth'); setQxoUsername(''); setQxoPassword(''); setQxoSiteId('');
    setQxoAccounts([]); setQxoAccountId(''); setQxoBranchCode('');
    setQxoJobAccount(''); setQxoBranchContactName('');
    setQxoBranchContactPhone(''); setQxoBranchContactEmail('');
    setQxoTemplates([]); setQxoTemplateId('');
  };

  const closeAndReset = (success: boolean) => {
    reset();
    onOpenChange(false);
    if (success) onConnected?.();
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
        toast({ title: `${meta.name} connected`, description: 'Account verified and connected.' });
        closeAndReset(true);
      } else if (supplier === 'srs') {
        const customerCode = srsCustomerCode.trim();
        if (!customerCode) throw new Error('SRS Account Number is required.');

        const saveRes = await supabase.functions.invoke('srs-api-proxy', {
          body: {
            action: 'save_credentials',
            tenant_id: tenantId,
            customer_code: customerCode,
            environment: 'production',
          },
        });
        if (saveRes.error) throw saveRes.error;
        if (!saveRes.data?.success) throw new Error(saveRes.data?.error || 'Save failed');

        const validateBody: Record<string, unknown> = {
          action: 'validate_connection',
          tenant_id: tenantId,
        };
        if (srsInvoiceNumber.trim()) validateBody.invoice_number = srsInvoiceNumber.trim();
        if (srsInvoiceDate.trim()) validateBody.invoice_date = srsInvoiceDate.trim();

        const validateRes = await supabase.functions.invoke('srs-api-proxy', {
          body: validateBody,
        });
        if (validateRes.error) throw validateRes.error;
        if (!(validateRes.data as any)?.success) {
          throw new Error(
            (validateRes.data as any)?.error
              || 'SRS could not validate this account number. Double-check it and try again, or add a recent invoice.',
          );
        }

        await supabase.functions.invoke('srs-api-proxy', {
          body: { action: 'sync_branches', tenant_id: tenantId },
        }).catch(() => { /* non-fatal */ });

        toast({ title: `${meta.name} connected`, description: 'Account verified and connected.' });
        closeAndReset(true);
      } else if (supplier === 'qxo') {
        if (qxoStep === 'auth') {
          if (!qxoUsername.trim() || !qxoPassword) {
            throw new Error('QXO email and password are required.');
          }
          const { data, error } = await supabase.functions.invoke('qxo-api-proxy', {
            body: {
              action: 'authenticate',
              tenant_id: tenantId,
              username: qxoUsername.trim(),
              password: qxoPassword,
              site_id: qxoSiteId.trim() || undefined,
            },
          });
          if (error) throw error;
          if (!(data as any)?.success) {
            throw new Error((data as any)?.error || "We couldn't sign you in to QXO.");
          }
          const accounts: Array<{ id: string; label: string }> =
            (data as any)?.accounts ?? [];
          const defaultAccountId = (data as any)?.default_account_id ?? accounts[0]?.id ?? '';
          const defaultBranch = (data as any)?.default_branch ?? '';
          const templates: Array<{ id: string; name: string }> =
            (data as any)?.templates ?? [];
          setQxoAccounts(accounts);
          setQxoAccountId(String(defaultAccountId || ''));
          setQxoBranchCode(String(defaultBranch || ''));
          setQxoTemplates(templates);
          setQxoTemplateId('');
          setQxoStep('map');
        } else {
          if (!qxoAccountId) throw new Error('Choose a QXO account.');
          if (!qxoBranchCode.trim()) throw new Error('Default branch is required.');
          if (!qxoBranchContactName.trim()) {
            throw new Error('Branch contact name is required.');
          }
          if (!qxoBranchContactPhone.trim() && !qxoBranchContactEmail.trim()) {
            throw new Error('Provide a branch contact phone or email.');
          }
          const selectedTemplate = qxoTemplates.find((t) => t.id === qxoTemplateId);
          const { data, error } = await supabase.functions.invoke('qxo-api-proxy', {
            body: {
              action: 'finalize_connection',
              tenant_id: tenantId,
              account_id: qxoAccountId,
              branch_code: qxoBranchCode.trim(),
              job_account: qxoJobAccount.trim() || null,
              branch_contact_name: qxoBranchContactName.trim(),
              branch_contact_phone: qxoBranchContactPhone.trim() || null,
              branch_contact_email: qxoBranchContactEmail.trim() || null,
              template_id: selectedTemplate?.id || null,
              template_name: selectedTemplate?.name || null,
            },
          });
          if (error) throw error;
          if (!(data as any)?.success) {
            throw new Error((data as any)?.error || 'Could not save QXO mapping.');
          }
          await supabase.functions.invoke('qxo-api-proxy', {
            body: { action: 'sync_branches', tenant_id: tenantId },
          }).catch(() => { /* non-fatal */ });
          toast({ title: 'QXO connected', description: 'Account linked and ready for orders.' });
          closeAndReset(true);
        }
      }
    } catch (e: any) {
      toast({ title: 'Connection failed', description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const qxoTitle = supplier === 'qxo' && qxoStep === 'map'
    ? 'Choose your QXO account'
    : `Connect ${meta.name}`;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{qxoTitle}</DialogTitle>
          <DialogDescription className="text-xs">
            {supplier === 'qxo' && qxoStep === 'map'
              ? 'Pick the QXO account and default branch Pitch should use for pricing and order submission.'
              : meta.help}
          </DialogDescription>
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
                <Label className="text-xs">SRS Account Number</Label>
                <Input
                  value={srsCustomerCode}
                  onChange={(e) => setSrsCustomerCode(e.target.value)}
                  placeholder="e.g. S046834"
                  autoComplete="off"
                />
                <p className="text-[11px] text-muted-foreground">
                  Find this on any SRS invoice or in your SRS portal account profile.
                </p>
              </div>

              <div className="pt-2 border-t border-border/50 space-y-3">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  Optional — verify with a recent invoice
                </p>
                <div className="space-y-1">
                  <Label className="text-xs">Invoice #</Label>
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
              </div>
            </>
          )}

          {supplier === 'qxo' && qxoStep === 'auth' && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">QXO Email / Username</Label>
                <Input
                  value={qxoUsername}
                  onChange={(e) => setQxoUsername(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="username"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">QXO Password</Label>
                <Input
                  type="password"
                  value={qxoPassword}
                  onChange={(e) => setQxoPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">QXO Site ID <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  value={qxoSiteId}
                  onChange={(e) => setQxoSiteId(e.target.value)}
                  placeholder="e.g. dealersChoice, beaconBuildingProducts (leave blank for default)"
                />
                <p className="text-[11px] text-muted-foreground">
                  Only needed if your QXO account lives on a non-default site (e.g. a developer / staging site).
                  QXO support or your account rep can tell you the exact value.
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Use the QXO account that owns the company's pricing and ordering.
                For best results, use a long-lived owner or "integrations" QXO user.
              </p>
            </>
          )}

          {supplier === 'qxo' && qxoStep === 'map' && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">QXO Account</Label>
                {qxoAccounts.length > 1 ? (
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={qxoAccountId}
                    onChange={(e) => setQxoAccountId(e.target.value)}
                  >
                    <option value="">Select an account…</option>
                    {qxoAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.label} ({a.id})</option>
                    ))}
                  </select>
                ) : (
                  <Input
                    value={qxoAccountId}
                    onChange={(e) => setQxoAccountId(e.target.value)}
                    placeholder="Account number"
                  />
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Default Branch</Label>
                <Input
                  value={qxoBranchCode}
                  onChange={(e) => setQxoBranchCode(e.target.value)}
                  placeholder="Branch code"
                />
                <p className="text-[11px] text-muted-foreground">
                  Used as the default branch for pricing and orders. You can override per order.
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Branch Contact Name</Label>
                <Input
                  value={qxoBranchContactName}
                  onChange={(e) => setQxoBranchContactName(e.target.value)}
                  placeholder="Contact at this QXO branch"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Contact Phone</Label>
                  <Input
                    value={qxoBranchContactPhone}
                    onChange={(e) => setQxoBranchContactPhone(e.target.value)}
                    placeholder="(555) 555-5555"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Contact Email</Label>
                  <Input
                    value={qxoBranchContactEmail}
                    onChange={(e) => setQxoBranchContactEmail(e.target.value)}
                    placeholder="branch@example.com"
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Provide at least one — phone or email — so QXO can reach the branch about your orders.
              </p>
              <div className="space-y-1">
                <Label className="text-xs">Job Account (optional)</Label>
                <Input
                  value={qxoJobAccount}
                  onChange={(e) => setQxoJobAccount(e.target.value)}
                  placeholder="Job account number"
                />
              </div>
              {qxoTemplates.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs">Default Order Template (optional)</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={qxoTemplateId}
                    onChange={(e) => setQxoTemplateId(e.target.value)}
                  >
                    <option value="">None — choose at order time</option>
                    {qxoTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          <p className="text-[11px] text-muted-foreground pt-1">
            Credentials are stored server-side, encrypted, and never returned to the browser.
          </p>
        </div>

        <DialogFooter>
          {supplier === 'qxo' && qxoStep === 'map' ? (
            <Button variant="ghost" onClick={() => setQxoStep('auth')} disabled={saving}>Back</Button>
          ) : (
            <Button variant="ghost" onClick={() => { reset(); onOpenChange(false); }} disabled={saving}>Cancel</Button>
          )}
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {supplier === 'srs'
              ? 'Validate & Connect'
              : supplier === 'qxo'
                ? (qxoStep === 'auth' ? 'Sign in to QXO' : 'Finish & Connect')
                : 'Connect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

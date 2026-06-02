// AbcSetupWizard — two-step gate that runs after ABC OAuth:
//   1. Pick a Ship-To account (only ones with at least one branch are shown)
//   2. Pick a Branch from that Ship-To
// On confirm, POSTs to abc-api `/setup/select`, which re-validates the branch
// belongs to the chosen ship-to and writes the selection to abc_connections.
// Until this completes (setup_completed_at IS NOT NULL) every pricing UI is
// locked.

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Loader2, MapPin, Store, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useAbcAccounts } from '@/lib/abc/useAbcConnection';
import { useAbcSetup } from '@/hooks/useAbcSetup';
import { edgeApi } from '@/lib/edgeApi';
import { useQueryClient } from '@tanstack/react-query';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

export function AbcSetupWizard({ open, onOpenChange, onComplete }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const accountsQuery = useAbcAccounts();
  const setup = useAbcSetup();

  const [shipToNumber, setShipToNumber] = useState<string | null>(null);
  const [branchNumber, setBranchNumber] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Hydrate from existing selection on open.
  useEffect(() => {
    if (open) {
      setShipToNumber(setup.shipToNumber);
      setBranchNumber(setup.branchNumber);
    }
  }, [open, setup.shipToNumber, setup.branchNumber]);

  // Only Ship-Tos with non-empty branches[] qualify.
  const eligibleAccounts = useMemo(() => {
    const all = accountsQuery.data || [];
    return all.filter((a) => (a.branches?.length ?? 0) > 0);
  }, [accountsQuery.data]);

  const selectedAccount = useMemo(
    () => eligibleAccounts.find((a) => a.ship_to_number === shipToNumber) || null,
    [eligibleAccounts, shipToNumber],
  );

  const branches = selectedAccount?.branches ?? [];

  const confirm = async () => {
    if (!shipToNumber || !branchNumber) return;
    setSaving(true);
    try {
      const { error } = await edgeApi('abc-api', '/setup/select', {
        ship_to_number: shipToNumber,
        branch_number: branchNumber,
      });
      if (error) throw new Error(error);
      toast({
        title: 'ABC pricing setup complete',
        description: `Ship-To ${shipToNumber} · Branch ${branchNumber}`,
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['abc', 'setup'] }),
        setup.refetch(),
      ]);
      onComplete?.();
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: 'Could not save ABC selection',
        description: e?.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const loading = accountsQuery.isLoading || setup.isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Finish ABC Supply setup</DialogTitle>
          <DialogDescription>
            ABC pricing is locked until you choose the Ship-To account and Branch
            to price from. Only accounts with at least one branch are shown.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : eligibleAccounts.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No Ship-To accounts with branches were returned from ABC. Reconnect
            ABC or contact your ABC rep to enable a Ship-To with at least one
            branch.
          </div>
        ) : (
          <div className="space-y-6">
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Store className="h-4 w-4" /> 1. Select Ship-To account
              </h3>
              <div className="grid max-h-60 gap-2 overflow-y-auto pr-1">
                {eligibleAccounts.map((a) => {
                  const active = a.ship_to_number === shipToNumber;
                  return (
                    <Card
                      key={a.ship_to_number}
                      onClick={() => {
                        setShipToNumber(a.ship_to_number);
                        setBranchNumber(null);
                      }}
                      className={cn(
                        'cursor-pointer border p-3 text-sm transition-colors',
                        active
                          ? 'border-primary bg-primary/5'
                          : 'hover:border-primary/40',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">
                            {a.name || `Ship-To ${a.ship_to_number}`}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            #{a.ship_to_number}
                            {a.city ? ` · ${a.city}, ${a.state ?? ''}` : ''}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {a.branches.length} branch
                            {a.branches.length === 1 ? '' : 'es'}
                          </div>
                        </div>
                        {active && (
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>

            {selectedAccount && (
              <section>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <MapPin className="h-4 w-4" /> 2. Select Branch
                </h3>
                <div className="grid max-h-60 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
                  {branches.map((b) => {
                    const active = b.branch_number === branchNumber;
                    return (
                      <Card
                        key={b.branch_number}
                        onClick={() => setBranchNumber(b.branch_number)}
                        className={cn(
                          'cursor-pointer border p-3 text-sm transition-colors',
                          active
                            ? 'border-primary bg-primary/5'
                            : 'hover:border-primary/40',
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-medium">
                              {b.name || `Branch ${b.branch_number}`}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              #{b.branch_number}
                              {b.city ? ` · ${b.city}, ${b.state ?? ''}` : ''}
                            </div>
                          </div>
                          {active && (
                            <CheckCircle2 className="h-4 w-4 text-primary" />
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={confirm}
            disabled={!shipToNumber || !branchNumber || saving}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save selection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AbcSetupWizard;

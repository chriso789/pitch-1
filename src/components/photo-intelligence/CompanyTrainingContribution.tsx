import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { loadContribution, setContribution, TRAINING_TERMS_VERSION } from '@/lib/photo-intelligence/training/platformTraining';

/**
 * Company-level training-data contribution control. Available to authorized
 * company administrators (enforced by the set_photo_training_contribution RPC).
 * Model training itself is a platform-developer-only function.
 */
export function CompanyTrainingContribution({ tenantId }: { tenantId: string | null }) {
  const qc = useQueryClient();
  const contrib = useQuery({ queryKey: ['pi-contribution', tenantId], queryFn: () => loadContribution(tenantId!), enabled: !!tenantId });

  const change = async (optIn: boolean) => {
    if (!tenantId) return;
    try { await setContribution(tenantId, optIn); toast.success(optIn ? 'Company is now contributing approved examples' : 'Contribution withdrawn for future datasets'); qc.invalidateQueries({ queryKey: ['pi-contribution', tenantId] }); qc.invalidateQueries({ queryKey: ['pi-platform-overview'] }); }
    catch (e: any) { toast.error(e.message); }
  };
  const status = contrib.data?.status ?? 'not_enrolled';

  return (
    <section className="rounded-lg border p-4 space-y-3">
      <h3 className="font-semibold">Shared AI training — this company's contribution</h3>
      <p className="text-sm text-muted-foreground">When switched on, independently approved examples from this company help train PITCH's shared roof-recognition model. Original photos, addresses and customer records stay private — other companies can never see them. Withdrawing removes this company from future training sets; model versions already trained are kept for their audit record but are not retrained with this company's data.</p>
      <div className="flex items-center gap-3">
        <Badge variant={status === 'opted_in' ? 'default' : 'secondary'}>{status === 'opted_in' ? 'Contributing' : status === 'withdrawn' ? 'Withdrawn' : 'Not enrolled'}</Badge>
        {status === 'opted_in'
          ? <Button size="sm" variant="outline" onClick={() => change(false)}>Withdraw</Button>
          : <Button size="sm" onClick={() => change(true)}>Agree to data-use terms ({TRAINING_TERMS_VERSION}) and contribute</Button>}
      </div>
      {!!contrib.data?.events.length && (
        <ul className="text-xs text-muted-foreground space-y-1">{contrib.data.events.map((e: any, i: number) => <li key={i}>{new Date(e.created_at).toLocaleString()} — {e.action}{e.terms_version ? ` (${e.terms_version})` : ''}</li>)}</ul>
      )}
    </section>
  );
}

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { loadContribution, loadPlatformOverview, setContribution, sharedClassReady, TRAINING_TERMS_VERSION } from '@/lib/photo-intelligence/training/platformTraining';

export function PlatformTrainingTab({ tenantId }: { tenantId: string | null }) {
  const qc = useQueryClient();
  const { profile } = useUserProfile();
  const isPlatform = profile?.role === 'master';
  const contrib = useQuery({ queryKey: ['pi-contribution', tenantId], queryFn: () => loadContribution(tenantId!), enabled: !!tenantId });
  const overview = useQuery({ queryKey: ['pi-platform-overview'], queryFn: loadPlatformOverview, enabled: isPlatform, retry: false });

  const change = async (optIn: boolean) => {
    if (!tenantId) return;
    try { await setContribution(tenantId, optIn); toast.success(optIn ? 'Company is now contributing approved examples' : 'Contribution withdrawn for future datasets'); qc.invalidateQueries({ queryKey: ['pi-contribution', tenantId] }); qc.invalidateQueries({ queryKey: ['pi-platform-overview'] }); }
    catch (e: any) { toast.error(e.message); }
  };
  const status = contrib.data?.status ?? 'not_enrolled';

  return (
    <div className="space-y-6">
      <section className="rounded-lg border p-4 space-y-3">
        <h3 className="font-semibold">This company's contribution</h3>
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

      {isPlatform && (
        <section className="rounded-lg border p-4 space-y-3">
          <h3 className="font-semibold">Platform training view</h3>
          <p className="text-sm text-muted-foreground">Counts only, across contributing companies. No photos, links or customer details are shown here, and every view is logged. Shared training stays switched off until staging checks are complete.</p>
          {overview.isLoading && <p className="text-sm">Loading…</p>}
          {overview.error && <p className="text-sm text-destructive">{(overview.error as Error).message}</p>}
          {overview.data && (<>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              <Stat label="Companies contributing" value={`${overview.data.companies_opted_in} / ${overview.data.companies_total}`} />
              <Stat label="Eligible photos" value={overview.data.eligible_photos} />
              <Stat label="Approved examples" value={overview.data.approved_examples} />
              <Stat label="Properties" value={overview.data.properties} />
              <Stat label="Shared training" value={overview.data.pooling_active ? 'On' : 'Off'} />
            </div>
            {overview.data.by_class.length ? (
              <table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th>Type</th><th>Condition</th><th>Examples</th><th>Properties</th><th>Companies</th><th>Ready</th></tr></thead>
                <tbody>{overview.data.by_class.map((r, i) => <tr key={i} className="border-t"><td>{r.cls.replace(/_/g, ' ')}</td><td>{r.condition ?? '—'}</td><td>{r.examples}</td><td>{r.properties}</td><td>{r.companies}</td><td>{sharedClassReady(r) ? 'Yes' : 'No'}</td></tr>)}</tbody></table>
            ) : <p className="text-sm text-muted-foreground">No approved examples from contributing companies yet.</p>}
          </>)}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-md bg-muted p-3"><div className="text-muted-foreground text-xs">{label}</div><div className="text-lg font-semibold">{value}</div></div>;
}

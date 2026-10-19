import { useQuery } from '@tanstack/react-query';
import { loadPlatformOverview, sharedClassReady } from '@/lib/photo-intelligence/training/platformTraining';
import { useHasTrainingAccess } from '@/hooks/useHasTrainingAccess';
import { CompanyTrainingContribution } from '@/components/photo-intelligence/CompanyTrainingContribution';

/**
 * Developer-only Shared Training view (lives inside the Image Trainer).
 * The cross-company analytics view is counts-only, logged, and requires a
 * platform developer role (enforced by the platform_training_overview RPC).
 */
export function PlatformTrainingTab({ tenantId }: { tenantId: string | null }) {
  const developer = useHasTrainingAccess('developer');
  const overview = useQuery({ queryKey: ['pi-platform-overview'], queryFn: loadPlatformOverview, enabled: developer.data === true, retry: false });

  return (
    <div className="space-y-6">
      <CompanyTrainingContribution tenantId={tenantId} />

      {developer.data === true && (
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

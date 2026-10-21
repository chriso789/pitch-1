import { useQuery } from '@tanstack/react-query';
import { loadPlatformOverview, sharedClassReady } from '@/lib/photo-intelligence/training/platformTraining';
import { useHasTrainingAccess } from '@/hooks/useHasTrainingAccess';
import { CompanyTrainingContribution } from '@/components/photo-intelligence/CompanyTrainingContribution';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { loadSharedInventory } from '@/lib/photo-intelligence/training/sharedInventory';
import { loadPreparationJobs, preparationAction } from '@/lib/photo-intelligence/training/preparationJobs';

/**
 * Developer-only Shared Training view (lives inside the Image Trainer).
 * The cross-company analytics view is counts-only, logged, and requires a
 * platform developer role (enforced by the platform_training_overview RPC).
 */
export function PlatformTrainingTab({ tenantId }: { tenantId: string | null }) {
  const developer = useHasTrainingAccess('developer');
  const inventory = useQuery({ queryKey: ['pi-shared-inventory'], queryFn: () => loadSharedInventory(), enabled: developer.data === true, retry: false });
  const [progress, setProgress] = useState('');
  const [failure, setFailure] = useState('');
  const jobs = useQuery({ queryKey: ['pi-preparation-jobs'], queryFn: loadPreparationJobs, enabled: developer.data === true, retry: false, refetchInterval: 10000 });
  const overview = useQuery({ queryKey: ['pi-platform-overview'], queryFn: loadPlatformOverview, enabled: developer.data === true, retry: false });

  return (
    <div className="space-y-6">
      <CompanyTrainingContribution tenantId={tenantId} />
      {developer.data === true && <section className="space-y-3">
        <h3 className="font-semibold">Existing photo inventory</h3>
        {inventory.error && <p role="alert" className="text-sm text-destructive">{inventory.error.message}</p>}
        {inventory.data && <>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              ['Customer photos', inventory.data.customer_photos], ['Other image records', inventory.data.other_image_records],
              ['Eligible photos', inventory.data.eligible_photos], ['Contributing companies', inventory.data.contributing_companies],
              ['Eligible properties', inventory.data.properties], ['Processed photos', inventory.data.processed_photos],
              ['Unverified outlines', inventory.data.candidate_regions], ['Companies needing consent', inventory.data.companies_without_consent],
            ].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-xl font-semibold">{value}</dd></div>)}
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!!progress || !inventory.data.eligible_photos} onClick={async () => {
              setFailure(''); setProgress('Creating preparation job');
              try { await preparationAction('create', { limit: 10 }); } catch (e) { setFailure(e instanceof Error ? e.message : 'Preparation failed'); }
              finally { setProgress(''); await jobs.refetch(); }
            }}>Queue first 10 photos</Button>
            <Button variant="outline" disabled={!!progress} onClick={async () => {
              setFailure(''); setProgress('Publishing approved references');
              try { await preparationAction('publish'); await inventory.refetch(); } catch (e) { setFailure(e instanceof Error ? e.message : 'Reference publication failed'); }
              finally { setProgress(''); }
            }}>Publish approved references</Button>
          </div>
          {jobs.data?.workerConfigured === false && <p role="status" className="text-sm text-muted-foreground">Processing host: not verified. Queued photos remain pending until an authorized host runs preparation.</p>}
          {jobs.error && <p role="alert" className="text-sm text-destructive">{jobs.error.message}</p>}
          {jobs.data?.jobs.map((job) => <div key={job.id} className="border-t py-3 space-y-2">
            <div className="flex flex-wrap items-center gap-3"><span className="font-medium">{job.status.replace(/_/g, ' ')}</span><span className="text-sm text-muted-foreground">{job.photo_preparation_items.filter((i) => !['pending', 'running', 'retry_wait'].includes(i.status)).length} / {job.photo_preparation_items.length} photos</span>
              {['queued', 'running', 'blocked'].includes(job.status) && <Button size="sm" variant="outline" onClick={async () => { try { await preparationAction('manage', { jobId: job.id, action: job.status === 'blocked' ? 'resume' : 'cancel' }); await jobs.refetch(); } catch (e) { setFailure(e instanceof Error ? e.message : 'Request failed'); } }}>{job.status === 'blocked' ? 'Resume' : 'Cancel'}</Button>}
            </div>
            {job.blocked_reason && <p className="text-sm text-destructive">{job.blocked_reason}</p>}
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th>Photo</th><th>Status</th><th>Attempts</th><th>Outlines</th><th>Time</th><th>Error</th></tr></thead><tbody>{job.photo_preparation_items.map((item, i) => <tr key={item.id} className="border-t"><td>{i + 1}</td><td>{item.status.replace(/_/g, ' ')}</td><td>{item.attempts}</td><td>{item.region_count}</td><td>{item.duration_ms === null ? '—' : `${(item.duration_ms / 1000).toFixed(1)}s`}</td><td>{item.error ?? '—'}</td></tr>)}</tbody></table></div>
          </div>)}
          {progress && <p role="status" className="text-sm">{progress}</p>}
          {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
          {inventory.data.failures.map((r) => <p key={r.reason} className="text-sm text-destructive">{r.photos}: {r.reason}</p>)}
          {inventory.data.approved_by_component.map((r) => <p key={r.component} className="text-sm">{r.component.replace(/_/g, ' ')}: {r.examples} approved examples</p>)}
          <p className="text-sm text-muted-foreground">Recognition results: not validated. Outlines are unverified; approved component examples require independent review.</p>
        </>}
      </section>}

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

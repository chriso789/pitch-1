import { describe, it, expect, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { approvedCanvassCounts, canvassOriginalIdentity } from './canvass';
import { buildDatasetVersion, toCoco, type TrainingPhoto } from './dataset';
import { queueForSession, retainFailedPhoto } from '@/lib/canvass/offlinePhotoRecovery';
import type { Original, Label } from './service';

const region = { cls: 'normal_tile_alignment', polygon: [{ x: .1, y: .1 }, { x: .5, y: .1 }, { x: .5, y: .5 }] };
const photo: TrainingPhoto = { photoId: 'canvass-1', sha256: 'hash1', propertyId: 'property-1', roofSystem: 'clay_tile', width: 100, height: 80, fileName: '1.jpg', storagePath: 'company/property-1/1.jpg', storageBucket: 'canvass-photos', sourceKind: 'live_canvass', noVisibleDamage: false, regions: [region], status: 'approved', labeledBy: 'inspector-1', approvedBy: 'inspector-2' };
describe('canvassing training rules', () => {
  it('retries the same original without changing company/property/object identity', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const blob = new NodeBlob(['unchanged-original'], { type: 'image/jpeg' });
    const first = await canvassOriginalIdentity(blob, 'company', 'property-1');
    expect(await canvassOriginalIdentity(blob, 'company', 'property-1')).toEqual(first);
    expect(first.path).toMatch(/^company\/property-1\/[a-f0-9]{64}\.jpg$/);
    expect((await canvassOriginalIdentity(blob, 'other-company', 'property-1')).id).not.toBe(first.id);
    expect((await canvassOriginalIdentity(blob, 'company', 'other-property')).id).not.toBe(first.id);
    vi.unstubAllGlobals();
  });
  it('retains failed offline photos even beyond three attempts, preserving GPS/time/notes', () => {
    const original = { tenantId: 'company', userId: 'rep', retryCount: 3, propertyId: 'property-1', latitude: 30, longitude: -85, timestamp: '2026-10-19T02:48:00Z', notes: 'possible tile concern', blob: new Blob(['original']) };
    const retained = retainFailedPhoto(original);
    expect(retained).toEqual({ ...original, retryCount: 4 });
    expect(retained.blob).toBe(original.blob);
  });
  it('syncs only the signed-in employee and selected company', () => {
    const records = [{ tenantId: 'company', userId: 'rep', retryCount: 0 }, { tenantId: 'other', userId: 'rep', retryCount: 0 }, { tenantId: 'company', userId: 'other-rep', retryCount: 0 }];
    expect(queueForSession(records, 'company', 'rep')).toEqual([records[0]]);
  });
  it('preliminary rep observation cannot make an unlabeled photo eligible', () => {
    const ds = buildDatasetVersion('v1', [{ ...photo, status: 'draft', approvedBy: null, sourceMetadata: { repObservation: 'roof_damage' } }]);
    expect(ds.photos).toEqual([]);
    expect(ds.excluded[0].reason).toBe('not_approved');
  });
  it('second-inspector approved polygons enter training with the original bucket retained', () => {
    const ds = buildDatasetVersion('v1', [photo], 0, '2026-10-19', 0);
    expect(ds.photos[0].storageBucket).toBe('canvass-photos');
    expect(toCoco(ds, 'train').annotations[0].segmentation[0]).toEqual([10, 8, 50, 8, 50, 40]);
    expect(buildDatasetVersion('self', [{ ...photo, approvedBy: photo.labeledBy }]).excluded[0].reason).toBe('self_approved');
  });
  it('quarantines identical bytes attributed to different properties before splitting', () => {
    const ds = buildDatasetVersion('v1', [photo, { ...photo, photoId: 'other', propertyId: 'property-2' }]);
    expect(ds.photos).toEqual([]);
    expect(ds.excluded.map((p) => p.reason)).toEqual(['duplicate_property_conflict', 'duplicate_property_conflict']);
  });
  it('keeps every view of the same property in the same evaluation partition', () => {
    const ds = buildDatasetVersion('v1', [photo, { ...photo, photoId: 'view2', sha256: 'hash2' }]);
    expect(ds.split['view2']).toBe(ds.split['canvass-1']);
  });
  it('approved canvass counts use inspector labels, never preliminary categories or self approval', () => {
    const originals = [{ id: 'o1', source_kind: 'live_canvass' }, { id: 'o2', source_kind: 'live_canvass' }, { id: 'o3', source_kind: 'inspector_upload' }] as Original[];
    const labels = [{ original_id: 'o1', roof_system: 'clay_tile', status: 'approved', approved_by: 'b', labeled_by: 'a', no_visible_damage: false, regions: [region] }, { original_id: 'o2', roof_system: 'clay_tile', status: 'approved', approved_by: 'a', labeled_by: 'a', no_visible_damage: false, regions: [{ ...region, cls: 'broken_tile' }] }, { original_id: 'o3', roof_system: 'clay_tile', status: 'approved', approved_by: 'b', labeled_by: 'a', no_visible_damage: true, regions: [] }] as Label[];
    const counts = approvedCanvassCounts(originals, labels).find((r) => r.system === 'clay_tile');
    expect(counts).toMatchObject({ total: 1, conditions: { normal: 1, damage: 0, maintenance: 0, uncertain: 0, not_assessable: 0 } });
  });
});
import { conditionKind, type ConditionKind } from './taxonomy';
import type { TrainingPhoto, LabelRegion, DatasetVersion } from './dataset';

/** Human uncertainty is retained for review, never treated as healthy background. */
export function isLearningPhoto(p: TrainingPhoto): boolean {
  return !p.regions.some((r) => ['uncertain', 'not_assessable'].includes(conditionKind(r.cls)));
}
export function experimentReadiness(ds: DatasetVersion) {
  const train = ds.photos.filter((p) => ds.split[p.photoId] === 'train' && isLearningPhoto(p));
  const test = ds.photos.filter((p) => ds.split[p.photoId] === 'test' && isLearningPhoto(p));
  return { experimental: train.length > 0 && train.some((p) => p.regions.length > 0), validation: test.length > 0,
    trainPhotos: train.length, testPhotos: test.length, production: false as const };
}
export function conditionCounts(regions: LabelRegion[]): Record<ConditionKind, number> {
  const counts: Record<ConditionKind, number> = { normal: 0, damage: 0, maintenance: 0, uncertain: 0, not_assessable: 0 };
  for (const r of regions) counts[conditionKind(r.cls)]++;
  return counts;
}
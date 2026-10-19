/** Local held-out bbox evaluation; no deployment or external inference. */
import { readFileSync, writeFileSync } from 'node:fs';
import { evaluate } from '../../src/lib/photo-intelligence/training/evaluation';
import type { DatasetVersion } from '../../src/lib/photo-intelligence/training/dataset';
import type { Prediction } from '../../src/lib/photo-intelligence/training/evaluation';

const [manifestPath, predictionPath, outputPath] = process.argv.slice(2);
if (!manifestPath || !predictionPath || !outputPath) throw new Error('Usage: bun worker/training/evaluate_conditions.ts manifest.json heldout_predictions.json evaluation.json');
const ds = JSON.parse(readFileSync(manifestPath, 'utf8')) as DatasetVersion;
const predictions = JSON.parse(readFileSync(predictionPath, 'utf8')) as { predictions: Prediction[]; partition: string };
if (predictions.partition !== 'test') throw new Error('An independent test partition is required');
const report = evaluate(ds, predictions.predictions, .5, 'test');
writeFileSync(outputPath, JSON.stringify({ ...report, localization: 'axis_aligned_bbox_iou', materialStage: 'not_trained', componentStage: 'not_trained', productionApproved: false }, null, 2));
console.log(`Evaluated ${report.photosEvaluated} held-out photos; ${report.reviewOnlyPhotos} review-only. No production approval.`);
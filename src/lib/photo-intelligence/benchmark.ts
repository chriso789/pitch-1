/** Independent, inspector-labeled benchmark. No provider prompts or reference captions enter predictions. */
export interface BenchmarkDetection {
  photoId: string;
  category: string;
  box: { x: number; y: number; width: number; height: number };
}
export interface BenchmarkPhoto {
  photoId: string;
  input: 'unannotated_original' | 'annotation_masked' | 'annotated_reference';
  labelsReviewed: boolean;
}

export function scoreRecognition(photos: BenchmarkPhoto[], labels: BenchmarkDetection[], predictions: BenchmarkDetection[], iouThreshold = 0.5) {
  if (!photos.length || photos.some((p) => !p.labelsReviewed || p.input !== 'unannotated_original')) {
    throw new Error('Independent accuracy requires unannotated originals with inspector-reviewed labels; masked/reference images are exploratory only.');
  }
  const ids = new Set(photos.map((p) => p.photoId));
  if ([...labels, ...predictions].some((d) => !ids.has(d.photoId) || !validBox(d.box))) throw new Error('Unknown photograph or invalid normalized box in benchmark.');
  if (!(iouThreshold > 0 && iouThreshold <= 1)) throw new Error('IoU threshold must be between 0 and 1.');
  const usedPredictions = new Set<number>(), usedLabels = new Set<number>();
  const pairs: { p: number; l: number; overlap: number }[] = [];
  predictions.forEach((p, pi) => labels.forEach((l, li) => {
    if (p.photoId === l.photoId && p.category === l.category) {
      const overlap = boxIoU(p.box, l.box);
      if (overlap >= iouThreshold) pairs.push({ p: pi, l: li, overlap });
    }
  }));
  pairs.sort((a, b) => b.overlap - a.overlap);
  for (const pair of pairs) if (!usedPredictions.has(pair.p) && !usedLabels.has(pair.l)) {
    usedPredictions.add(pair.p); usedLabels.add(pair.l);
  }
  const tp = usedLabels.size, fp = predictions.length - tp, fn = labels.length - tp;
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  return { truePositive: tp, falsePositive: fp, falseNegative: fn, precision, recall,
    f1: precision !== null && recall !== null && precision + recall > 0 ? 2 * precision * recall / (precision + recall) : null,
    perCategory: [...new Set([...labels, ...predictions].map((d) => d.category))].map((category) => ({
      category,
      truePositive: [...usedLabels].filter((i) => labels[i].category === category).length,
      falsePositive: predictions.filter((d, i) => d.category === category && !usedPredictions.has(i)).length,
      falseNegative: labels.filter((d, i) => d.category === category && !usedLabels.has(i)).length,
    })),
  };
}

function validBox(b: BenchmarkDetection['box']) {
  return [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.x >= 0 && b.y >= 0 && b.width > 0 && b.height > 0 && b.x + b.width <= 1 && b.y + b.height <= 1;
}
export function boxIoU(a: BenchmarkDetection['box'], b: BenchmarkDetection['box']) {
  const overlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return overlap / (a.width * a.height + b.width * b.height - overlap);
}

/** Pairwise physical-identity accuracy; IDs must be independently adjudicated by an inspector. */
export function scoreAssociation(expected: string[], predicted: string[]) {
  if (expected.length !== predicted.length || expected.some((x) => !x) || predicted.some((x) => !x)) throw new Error('Each observation needs both an inspector identity and a predicted identity.');
  let tp = 0, fp = 0, fn = 0;
  for (let i = 0; i < expected.length; i++) for (let j = i + 1; j < expected.length; j++) {
    const sameActual = expected[i] === expected[j], samePredicted = predicted[i] === predicted[j];
    if (sameActual && samePredicted) tp++;
    if (!sameActual && samePredicted) fp++;
    if (sameActual && !samePredicted) fn++;
  }
  return { truePositivePairs: tp, falseMerges: fp, falseSplits: fn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null };
}
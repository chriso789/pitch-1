/**
 * Phase 32: Ensemble AI Detection Pipeline
 * Runs multiple AI detection passes and combines results for higher accuracy.
 */

export interface EnsembleConfig {
  passes: { prompt: string; temperature: number; weight: number }[];
  votingThreshold: number;
  minAgreement: number;
}

export interface EnsembleResult {
  combinedFeatures: any[];
  agreementScore: number;
  confidence: number;
  passResults: { passIndex: number; featureCount: number; confidence: number }[];
}

export function combineEnsembleResults(
  passResults: any[][],
  weights: number[],
  votingThreshold: number = 0.6
): EnsembleResult {
  const combinedFeatures: any[] = [];
  const featureVotes = new Map<string, { feature: any; votes: number; totalWeight: number }>();

  // Collect votes for each detected feature
  for (let i = 0; i < passResults.length; i++) {
    const features = passResults[i];
    const weight = weights[i] || 1;

    for (const feature of features) {
      const key = `${feature.type}_${Math.round(feature.startLat * 10000)}_${Math.round(feature.startLng * 10000)}`;
      const existing = featureVotes.get(key);
      
      if (existing) {
        existing.votes++;
        existing.totalWeight += weight;
        existing.feature.confidence = Math.max(existing.feature.confidence, feature.confidence);
      } else {
        featureVotes.set(key, { feature: { ...feature }, votes: 1, totalWeight: weight });
      }
    }
  }

  // Filter by voting threshold
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  for (const [, data] of featureVotes) {
    if (data.totalWeight / totalWeight >= votingThreshold) {
      combinedFeatures.push({
        ...data.feature,
        ensembleVotes: data.votes,
        ensembleWeight: data.totalWeight
      });
    }
  }

  const agreementScore = combinedFeatures.length > 0 
    ? combinedFeatures.reduce((sum, f) => sum + f.ensembleVotes, 0) / (combinedFeatures.length * passResults.length)
    : 0;

  return {
    combinedFeatures,
    agreementScore,
    confidence: Math.min(0.99, agreementScore + 0.1),
    passResults: passResults.map((p, i) => ({
      passIndex: i,
      featureCount: p.length,
      confidence: p.reduce((s, f) => s + (f.confidence || 0.7), 0) / p.length
    }))
  };
}

export const DEFAULT_ENSEMBLE_CONFIG: EnsembleConfig = {
  passes: [
    { prompt: 'standard', temperature: 0.3, weight: 1.0 },
    { prompt: 'detailed', temperature: 0.5, weight: 0.8 },
    { prompt: 'conservative', temperature: 0.2, weight: 1.2 }
  ],
  votingThreshold: 0.6,
  minAgreement: 2
};

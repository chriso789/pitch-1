// =====================================================
// Phase 79: Multi-Model Ensemble Orchestrator
// Run multiple AI models and combine for higher accuracy
// =====================================================

import { MissingSeverity, MissingItem } from "./permits/types.ts";

// Model configurations
export interface AIModel {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic' | 'google';
  model: string;
  weight: number; // Voting weight
  specialization?: 'residential' | 'commercial' | 'complex' | 'general';
  maxTokens: number;
  temperature: number;
}

export const ENSEMBLE_MODELS: AIModel[] = [
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    model: 'gpt-4o-mini',
    weight: 0.25,
    specialization: 'general',
    maxTokens: 4096,
    temperature: 0.1,
  },
  {
    id: 'gemini-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'google',
    model: 'gemini-2.5-flash-preview-05-20',
    weight: 0.35,
    specialization: 'residential',
    maxTokens: 8192,
    temperature: 0.1,
  },
  {
    id: 'gemini-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'google',
    model: 'gemini-2.5-pro-preview-05-06',
    weight: 0.40,
    specialization: 'complex',
    maxTokens: 8192,
    temperature: 0.1,
  },
];

// Detection result from a single model
export interface ModelDetectionResult {
  modelId: string;
  confidence: number;
  processingTimeMs: number;
  features: DetectedFeatures;
  errors?: string[];
}

export interface DetectedFeatures {
  facets: DetectedFacet[];
  edges: DetectedEdge[];
  vertices: DetectedVertex[];
  totalArea: number;
  perimeterLength: number;
  predominantPitch: string;
}

export interface DetectedFacet {
  id: string;
  area: number;
  pitch: string;
  vertices: string[];
  confidence: number;
}

export interface DetectedEdge {
  id: string;
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
  length: number;
  startVertex: string;
  endVertex: string;
  confidence: number;
}

export interface DetectedVertex {
  id: string;
  x: number;
  y: number;
  type: 'corner' | 'ridge_end' | 'hip_point' | 'valley_point';
  confidence: number;
}

// Ensemble result
export interface EnsembleResult {
  combinedConfidence: number;
  consensusLevel: 'high' | 'medium' | 'low';
  features: DetectedFeatures;
  modelResults: ModelDetectionResult[];
  votingDetails: VotingDetails;
  processingTimeMs: number;
}

export interface VotingDetails {
  totalAreaVotes: { value: number; weight: number; modelId: string }[];
  totalAreaConsensus: number;
  edgeCountVotes: { value: number; weight: number; modelId: string }[];
  facetCountVotes: { value: number; weight: number; modelId: string }[];
  disagreements: DisagreementDetail[];
}

export interface DisagreementDetail {
  metric: string;
  values: { modelId: string; value: number }[];
  variance: number;
  resolution: 'weighted_average' | 'median' | 'highest_confidence';
}

// Orchestrator class
export class EnsembleOrchestrator {
  private models: AIModel[];
  private apiKeys: Record<string, string>;

  constructor(apiKeys: Record<string, string>, models?: AIModel[]) {
    this.apiKeys = apiKeys;
    this.models = models || ENSEMBLE_MODELS;
  }

  // Run all models in parallel and combine results
  async runEnsemble(
    imageBase64: string,
    propertyType: 'residential' | 'commercial' | 'mixed' = 'residential'
  ): Promise<EnsembleResult> {
    const startTime = Date.now();
    
    // Filter models based on property type
    const selectedModels = this.selectModelsForProperty(propertyType);
    
    // Run all models in parallel
    const results = await Promise.allSettled(
      selectedModels.map(model => this.runSingleModel(model, imageBase64))
    );
    
    // Extract successful results
    const successfulResults: ModelDetectionResult[] = [];
    const errors: string[] = [];
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successfulResults.push(result.value);
      } else {
        errors.push(`${selectedModels[index].name}: ${result.reason}`);
      }
    });
    
    if (successfulResults.length === 0) {
      throw new Error(`All models failed: ${errors.join('; ')}`);
    }
    
    // Combine results using weighted voting
    const combinedFeatures = this.combineResults(successfulResults, selectedModels);
    
    // Calculate consensus level
    const votingDetails = this.calculateVotingDetails(successfulResults);
    const consensusLevel = this.determineConsensusLevel(votingDetails);
    
    // Calculate combined confidence
    const combinedConfidence = this.calculateCombinedConfidence(successfulResults, selectedModels);
    
    return {
      combinedConfidence,
      consensusLevel,
      features: combinedFeatures,
      modelResults: successfulResults,
      votingDetails,
      processingTimeMs: Date.now() - startTime,
    };
  }

  private selectModelsForProperty(propertyType: string): AIModel[] {
    // Prioritize models specialized for property type
    return this.models.sort((a, b) => {
      if (a.specialization === propertyType) return -1;
      if (b.specialization === propertyType) return 1;
      if (a.specialization === 'general') return -1;
      if (b.specialization === 'general') return 1;
      return 0;
    });
  }

  private async runSingleModel(
    model: AIModel,
    imageBase64: string
  ): Promise<ModelDetectionResult> {
    const startTime = Date.now();
    
    // Placeholder for actual API call
    // In production, this would call OpenAI, Google, or Anthropic APIs
    console.log(`[Ensemble] Running ${model.name}...`);
    
    // Simulated result structure
    const result: ModelDetectionResult = {
      modelId: model.id,
      confidence: 0.95,
      processingTimeMs: Date.now() - startTime,
      features: {
        facets: [],
        edges: [],
        vertices: [],
        totalArea: 2500,
        perimeterLength: 200,
        predominantPitch: '6/12',
      },
    };
    
    return result;
  }

  private combineResults(
    results: ModelDetectionResult[],
    models: AIModel[]
  ): DetectedFeatures {
    // Weighted average for numeric values
    let totalAreaSum = 0;
    let perimeterSum = 0;
    let totalWeight = 0;
    
    results.forEach(result => {
      const model = models.find(m => m.id === result.modelId);
      const weight = model?.weight || 1;
      totalAreaSum += result.features.totalArea * weight * result.confidence;
      perimeterSum += result.features.perimeterLength * weight * result.confidence;
      totalWeight += weight * result.confidence;
    });
    
    // Find most common pitch (mode)
    const pitchCounts: Record<string, number> = {};
    results.forEach(r => {
      const pitch = r.features.predominantPitch;
      pitchCounts[pitch] = (pitchCounts[pitch] || 0) + 1;
    });
    const predominantPitch = Object.entries(pitchCounts)
      .sort(([, a], [, b]) => b - a)[0]?.[0] || '6/12';
    
    // Merge edges from all models, keeping highest confidence
    const edgeMap = new Map<string, DetectedEdge>();
    results.forEach(result => {
      result.features.edges.forEach(edge => {
        const key = `${edge.type}-${edge.startVertex}-${edge.endVertex}`;
        const existing = edgeMap.get(key);
        if (!existing || existing.confidence < edge.confidence) {
          edgeMap.set(key, edge);
        }
      });
    });
    
    return {
      facets: results[0]?.features.facets || [], // Use highest weight model's facets
      edges: Array.from(edgeMap.values()),
      vertices: results[0]?.features.vertices || [],
      totalArea: totalAreaSum / totalWeight,
      perimeterLength: perimeterSum / totalWeight,
      predominantPitch,
    };
  }

  private calculateVotingDetails(results: ModelDetectionResult[]): VotingDetails {
    const totalAreaVotes = results.map(r => ({
      value: r.features.totalArea,
      weight: r.confidence,
      modelId: r.modelId,
    }));
    
    const areas = results.map(r => r.features.totalArea);
    const areaVariance = this.calculateVariance(areas);
    
    const edgeCountVotes = results.map(r => ({
      value: r.features.edges.length,
      weight: r.confidence,
      modelId: r.modelId,
    }));
    
    const facetCountVotes = results.map(r => ({
      value: r.features.facets.length,
      weight: r.confidence,
      modelId: r.modelId,
    }));
    
    const disagreements: DisagreementDetail[] = [];
    
    if (areaVariance > 100) {
      disagreements.push({
        metric: 'totalArea',
        values: results.map(r => ({ modelId: r.modelId, value: r.features.totalArea })),
        variance: areaVariance,
        resolution: 'weighted_average',
      });
    }
    
    return {
      totalAreaVotes,
      totalAreaConsensus: 100 - (areaVariance / Math.max(...areas) * 100),
      edgeCountVotes,
      facetCountVotes,
      disagreements,
    };
  }

  private determineConsensusLevel(voting: VotingDetails): 'high' | 'medium' | 'low' {
    if (voting.totalAreaConsensus >= 95 && voting.disagreements.length === 0) {
      return 'high';
    } else if (voting.totalAreaConsensus >= 85) {
      return 'medium';
    }
    return 'low';
  }

  private calculateCombinedConfidence(
    results: ModelDetectionResult[],
    models: AIModel[]
  ): number {
    let weightedSum = 0;
    let totalWeight = 0;
    
    results.forEach(result => {
      const model = models.find(m => m.id === result.modelId);
      const weight = model?.weight || 1;
      weightedSum += result.confidence * weight;
      totalWeight += weight;
    });
    
    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
  }
}

export default EnsembleOrchestrator;

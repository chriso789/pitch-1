/**
 * Phase 54: Chain-of-Thought Prompting System
 * Structured reasoning templates for AI detection with explanation requirements.
 */

export interface ChainOfThoughtStep {
  step: number;
  action: string;
  observation: string;
  reasoning: string;
  confidence: number;
}

export interface ChainOfThoughtResult {
  steps: ChainOfThoughtStep[];
  finalConclusion: string;
  overallConfidence: number;
  reasoningQuality: 'excellent' | 'good' | 'acceptable' | 'poor';
  contradictions: string[];
  assumptions: string[];
}

/**
 * Roof geometry detection prompt with step-by-step reasoning
 */
export function generateGeometryDetectionPrompt(imageContext: {
  latitude: number;
  longitude: number;
  footprintArea?: number;
  neighborhoodStyle?: string;
}): string {
  return `You are an expert roof geometry analyst. Analyze this satellite image and determine the roof structure using step-by-step reasoning.

LOCATION CONTEXT:
- Coordinates: ${imageContext.latitude}, ${imageContext.longitude}
- ${imageContext.footprintArea ? `Known footprint area: ${imageContext.footprintArea} sq ft` : 'Footprint area: unknown'}
- ${imageContext.neighborhoodStyle ? `Neighborhood style: ${imageContext.neighborhoodStyle}` : ''}

STEP-BY-STEP ANALYSIS REQUIRED:

Step 1: IDENTIFY ROOF BOUNDARIES
- Describe the exact perimeter you observe
- Count the number of corners/vertices
- Note any obstructions (trees, shadows) affecting visibility
- Confidence in boundary detection: [0-100]%

Step 2: CLASSIFY ROOF TYPE
- Examine the ridge and hip patterns
- Identify: [gable | hip | dutch-hip | gambrel | mansard | flat | shed | complex]
- Explain the visual features that led to this classification
- Confidence in type classification: [0-100]%

Step 3: DETECT RIDGES
- Mark all horizontal ridges at the highest points
- For each ridge, estimate start point, end point, and length
- Explain how you distinguished ridges from hips
- Confidence in ridge detection: [0-100]%

Step 4: DETECT HIPS AND VALLEYS
- Mark diagonal lines running from ridges to eaves (hips)
- Mark diagonal lines where roof planes meet in valleys
- Count total hips and valleys
- Confidence in hip/valley detection: [0-100]%

Step 5: ESTIMATE PITCH
- Examine shadow lengths and depth cues
- Estimate predominant pitch as X/12
- Note any varying pitches across facets
- Confidence in pitch estimation: [0-100]%

Step 6: CALCULATE AREAS
- Count distinct roof facets
- Estimate area for each major facet
- Sum to total roof area
- Cross-check against footprint if available
- Confidence in area calculation: [0-100]%

Step 7: QUALITY SELF-CHECK
- Do the ridges connect logically to form a complete structure?
- Does the total area seem reasonable for the footprint?
- Are there any contradictions in your analysis?
- List any areas of uncertainty requiring human review

OUTPUT FORMAT (JSON):
{
  "roofType": "string",
  "facetCount": number,
  "totalAreaSqFt": number,
  "pitch": "X/12",
  "ridges": [{"startLat": n, "startLng": n, "endLat": n, "endLng": n, "lengthFt": n}],
  "hips": [{"startLat": n, "startLng": n, "endLat": n, "endLng": n, "lengthFt": n}],
  "valleys": [{"startLat": n, "startLng": n, "endLat": n, "endLng": n, "lengthFt": n}],
  "reasoning": {
    "step1": {"observation": "string", "confidence": n},
    "step2": {"observation": "string", "confidence": n},
    "step3": {"observation": "string", "confidence": n},
    "step4": {"observation": "string", "confidence": n},
    "step5": {"observation": "string", "confidence": n},
    "step6": {"observation": "string", "confidence": n},
    "step7": {"selfCheckIssues": ["string"], "requiresReview": boolean}
  },
  "overallConfidence": number,
  "contradictionsFound": ["string"]
}`;
}

/**
 * Validate chain-of-thought reasoning for consistency
 */
export function validateReasoningChain(result: ChainOfThoughtResult): {
  isValid: boolean;
  issues: string[];
  adjustedConfidence: number;
} {
  const issues: string[] = [];
  let confidencePenalty = 0;

  // Check for contradictions
  if (result.contradictions.length > 0) {
    issues.push(`Found ${result.contradictions.length} contradictions in reasoning`);
    confidencePenalty += result.contradictions.length * 5;
  }

  // Check confidence progression
  const confidences = result.steps.map(s => s.confidence);
  const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
  
  if (result.overallConfidence > avgConfidence + 10) {
    issues.push('Overall confidence exceeds step average - potential overconfidence');
    confidencePenalty += 10;
  }

  // Check for unexplained assumptions
  if (result.assumptions.length > 3) {
    issues.push(`Too many assumptions (${result.assumptions.length}) - may lack sufficient evidence`);
    confidencePenalty += result.assumptions.length * 3;
  }

  // Check reasoning quality
  const hasDetailedObservations = result.steps.every(
    s => s.observation.length > 20 && s.reasoning.length > 30
  );
  
  if (!hasDetailedObservations) {
    issues.push('Reasoning lacks sufficient detail');
    confidencePenalty += 15;
  }

  // Check logical flow
  const stepConfidences = result.steps.map(s => s.confidence);
  const hasWildSwings = stepConfidences.some((c, i) => 
    i > 0 && Math.abs(c - stepConfidences[i-1]) > 30
  );
  
  if (hasWildSwings) {
    issues.push('Confidence varies wildly between steps - inconsistent analysis');
    confidencePenalty += 10;
  }

  const adjustedConfidence = Math.max(0, result.overallConfidence - confidencePenalty);

  return {
    isValid: issues.length === 0 && adjustedConfidence >= 70,
    issues,
    adjustedConfidence,
  };
}

/**
 * Parse AI response to extract chain-of-thought steps
 */
export function parseChainOfThoughtResponse(
  response: string
): ChainOfThoughtResult | null {
  try {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    
    // Build steps from reasoning sections
    const steps: ChainOfThoughtStep[] = [];
    if (parsed.reasoning) {
      Object.entries(parsed.reasoning).forEach(([key, value]: [string, any], i) => {
        if (key.startsWith('step') && typeof value === 'object') {
          steps.push({
            step: i + 1,
            action: key,
            observation: value.observation || '',
            reasoning: value.reasoning || value.observation || '',
            confidence: value.confidence || 0,
          });
        }
      });
    }

    return {
      steps,
      finalConclusion: `Detected ${parsed.roofType} roof with ${parsed.facetCount} facets`,
      overallConfidence: parsed.overallConfidence || 0,
      reasoningQuality: parsed.overallConfidence >= 90 ? 'excellent' :
                       parsed.overallConfidence >= 75 ? 'good' :
                       parsed.overallConfidence >= 60 ? 'acceptable' : 'poor',
      contradictions: parsed.contradictionsFound || [],
      assumptions: [],
    };
  } catch (e) {
    console.error('Failed to parse chain-of-thought response:', e);
    return null;
  }
}

/**
 * Generate edge case detection prompt
 */
export function generateEdgeCasePrompt(): string {
  return `Before proceeding with standard analysis, check for these unusual roof patterns:

EDGE CASE DETECTION:

1. GAMBREL ROOF
   - Two different slopes per side (steep lower, shallow upper)
   - Common in barns, some residential
   - Requires separate pitch calculations per section

2. MANSARD ROOF
   - Four-sided double-slope on all sides
   - Often with dormers
   - Requires complex facet counting

3. GEODESIC DOME
   - Triangular facet pattern
   - Curved appearance
   - Standard ridge/hip analysis does not apply

4. BUTTERFLY ROOF
   - Two inward-sloping surfaces meeting at a valley in the middle
   - Unusual drainage pattern
   - Valley at center, not perimeter

5. MULTI-LEVEL COMPLEX
   - Multiple separate roof sections at different heights
   - Connected by step flashing, not valleys
   - Each section analyzed separately

6. TURRETS/TOWERS
   - Conical or polygonal sections
   - Separate from main roof structure
   - Requires special area calculation

For each edge case, if detected:
- Flag for specialized pipeline
- Adjust confidence downward if using standard analysis
- Note specific challenges for human reviewer

Return JSON:
{
  "edgeCasesDetected": ["string"],
  "useStandardPipeline": boolean,
  "specialConsiderations": ["string"],
  "confidenceAdjustment": number
}`;
}

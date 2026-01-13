// Phase 6: Correction Tracker
// Stores and retrieves corrections for continuous learning
// Applies learned patterns to improve future measurements

type XY = [number, number];

export interface CorrectionRecord {
  measurementId?: string;
  tenantId: string;
  originalLineWkt: string;
  originalLineType: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake' | string; // Allow string for unknown types
  correctedLineWkt: string;
  deviationFt: number;
  deviationPct: number;
  correctionSource: 'user_trace' | 'manual_edit' | 'auto_correction' | 'qa_review' | string;
  buildingShape?: 'rectangle' | 'L-shape' | 'T-shape' | 'U-shape' | 'complex' | string; // Optional with default
  roofType?: 'gable' | 'hip' | 'complex' | 'flat' | string; // Optional with default
  vertexCount?: number; // Optional - will default if not provided
  propertyAddress?: string;
  lat?: number;
  lng?: number;
  correctionNotes?: string;
  createdBy?: string;
  isFeatureInjection?: boolean; // True when AI produced 0 features but user traced some - these get INJECTED not multiplied
}

export interface PatternMatch {
  pattern: string;
  avgDeviationFt: number;
  correctionCount: number;
  suggestedAdjustment: {
    type: 'offset' | 'angle' | 'endpoint';
    value: number;
    direction?: string;
  };
}

export interface LearnedAdjustment {
  buildingShape: string;
  roofType: string;
  lineType: string;
  avgCorrection: XY; // Average offset applied
  confidenceBoost: number; // How much to boost confidence when this pattern matches
  sampleCount: number;
}

/**
 * Store a correction record for learning
 */
export async function storeCorrection(
  supabaseClient: any,
  correction: CorrectionRecord
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    // Calculate vertex count from WKT if not provided
    let vertexCount = correction.vertexCount;
    if (!vertexCount && correction.correctedLineWkt) {
      const match = correction.correctedLineWkt.match(/LINESTRING\(([^)]+)\)/i);
      if (match) {
        vertexCount = match[1].split(',').length;
      }
    }
    
    // Normalize line type to valid enum values
    const validLineTypes = ['ridge', 'hip', 'valley', 'eave', 'rake'];
    const normalizedLineType = validLineTypes.includes(correction.originalLineType) 
      ? correction.originalLineType 
      : 'ridge'; // Default to ridge for unknown types
    
    // Normalize building shape
    const validShapes = ['rectangle', 'L-shape', 'T-shape', 'U-shape', 'complex'];
    const normalizedShape = correction.buildingShape && validShapes.includes(correction.buildingShape)
      ? correction.buildingShape
      : 'complex';
    
    // Normalize roof type
    const validRoofTypes = ['gable', 'hip', 'complex', 'flat'];
    const normalizedRoofType = correction.roofType && validRoofTypes.includes(correction.roofType)
      ? correction.roofType
      : 'complex';
    
    // Determine if this is a feature injection (AI had nothing, user traced something)
    const isFeatureInjection = correction.isFeatureInjection || 
      (!correction.originalLineWkt || correction.originalLineWkt.trim() === '') && 
      (correction.correctedLineWkt && correction.correctedLineWkt.trim() !== '');

    const insertData = {
      measurement_id: correction.measurementId || null,
      tenant_id: correction.tenantId,
      original_line_wkt: correction.originalLineWkt || '',
      original_line_type: normalizedLineType,
      corrected_line_wkt: correction.correctedLineWkt,
      deviation_ft: correction.deviationFt || 0,
      deviation_pct: correction.deviationPct || 0,
      correction_source: correction.correctionSource || 'user_trace',
      building_shape: normalizedShape,
      roof_type: normalizedRoofType,
      vertex_count: vertexCount || 2,
      property_address: correction.propertyAddress || null,
      lat: correction.lat || null,
      lng: correction.lng || null,
      correction_notes: correction.correctionNotes || null,
      created_by: correction.createdBy || null,
      is_feature_injection: isFeatureInjection,
    };

    console.log('Inserting correction:', {
      type: insertData.original_line_type,
      hasOriginalWkt: !!insertData.original_line_wkt,
      hasCorrectedWkt: !!insertData.corrected_line_wkt,
      deviationFt: insertData.deviation_ft,
      isFeatureInjection: insertData.is_feature_injection,
    });

    const { data, error } = await supabaseClient
      .from('measurement_corrections')
      .insert(insertData)
      .select('id')
      .single();

    if (error) {
      console.error('Failed to store correction:', error.message, error.details, error.hint);
      return { success: false, error: `${error.message}${error.hint ? ` (${error.hint})` : ''}` };
    }

    console.log(`✓ Stored correction ${data.id} for ${correction.originalLineType}`);
    return { success: true, id: data.id };
  } catch (err) {
    console.error('Exception storing correction:', err);
    return { success: false, error: String(err) };
  }
}

/**
 * Retrieve learned patterns for a building type
 */
export async function getLearnedPatterns(
  supabaseClient: any,
  tenantId: string,
  buildingShape: string,
  roofType: string,
  limit: number = 100
): Promise<LearnedAdjustment[]> {
  try {
    const { data, error } = await supabaseClient
      .from('measurement_corrections')
      .select('original_line_type, original_line_wkt, corrected_line_wkt, deviation_ft')
      .eq('tenant_id', tenantId)
      .eq('building_shape', buildingShape)
      .eq('roof_type', roofType)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data || data.length === 0) {
      return [];
    }

    // Aggregate corrections by line type
    const byType = new Map<string, Array<{
      original: XY[];
      corrected: XY[];
      deviation: number;
    }>>();

    for (const record of data) {
      const originalCoords = parseWkt(record.original_line_wkt);
      const correctedCoords = parseWkt(record.corrected_line_wkt);
      
      if (!originalCoords || !correctedCoords) continue;
      
      const existing = byType.get(record.original_line_type) || [];
      existing.push({
        original: originalCoords,
        corrected: correctedCoords,
        deviation: record.deviation_ft
      });
      byType.set(record.original_line_type, existing);
    }

    // Calculate average adjustments
    const adjustments: LearnedAdjustment[] = [];

    for (const [lineType, corrections] of byType) {
      if (corrections.length < 3) continue; // Need enough samples
      
      // Calculate average offset between original and corrected endpoints
      let totalOffsetX = 0;
      let totalOffsetY = 0;
      let validCount = 0;

      for (const c of corrections) {
        if (c.original.length >= 1 && c.corrected.length >= 1) {
          totalOffsetX += c.corrected[0][0] - c.original[0][0];
          totalOffsetY += c.corrected[0][1] - c.original[0][1];
          validCount++;
        }
      }

      if (validCount > 0) {
        adjustments.push({
          buildingShape,
          roofType,
          lineType,
          avgCorrection: [totalOffsetX / validCount, totalOffsetY / validCount],
          confidenceBoost: Math.min(0.15, corrections.length * 0.01), // Up to 15% boost
          sampleCount: corrections.length
        });
      }
    }

    console.log(`Retrieved ${adjustments.length} learned adjustments for ${buildingShape}/${roofType}`);
    return adjustments;
  } catch (err) {
    console.error('Error retrieving learned patterns:', err);
    return [];
  }
}

/**
 * Apply learned adjustments to newly generated features
 */
export function applyLearnedAdjustments(
  features: Array<{ id: string; type: string; start: XY; end: XY; confidence?: number }>,
  adjustments: LearnedAdjustment[]
): Array<{ id: string; type: string; start: XY; end: XY; confidence: number }> {
  const adjustmentMap = new Map(adjustments.map(a => [a.lineType, a]));
  
  return features.map(f => {
    const adjustment = adjustmentMap.get(f.type);
    
    if (adjustment && adjustment.sampleCount >= 5) {
      // Apply average correction offset
      const [dx, dy] = adjustment.avgCorrection;
      
      return {
        id: f.id,
        type: f.type,
        start: [f.start[0] + dx, f.start[1] + dy] as XY,
        end: [f.end[0] + dx, f.end[1] + dy] as XY,
        confidence: Math.min(0.98, (f.confidence || 0.7) + adjustment.confidenceBoost)
      };
    }
    
    return {
      ...f,
      confidence: f.confidence || 0.7
    };
  });
}

/**
 * Analyze error patterns across all corrections
 */
export async function analyzeErrorPatterns(
  supabaseClient: any,
  tenantId: string
): Promise<PatternMatch[]> {
  try {
    const { data, error } = await supabaseClient
      .from('measurement_corrections')
      .select('building_shape, roof_type, original_line_type, deviation_ft')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error || !data) return [];

    // Group by pattern (shape + roof_type + line_type)
    const patterns = new Map<string, { deviations: number[]; count: number }>();

    for (const record of data) {
      const key = `${record.building_shape}|${record.roof_type}|${record.original_line_type}`;
      const existing = patterns.get(key) || { deviations: [], count: 0 };
      existing.deviations.push(record.deviation_ft);
      existing.count++;
      patterns.set(key, existing);
    }

    // Calculate pattern metrics
    const results: PatternMatch[] = [];

    for (const [pattern, { deviations, count }] of patterns) {
      if (count < 3) continue;

      const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
      const [shape, roofType, lineType] = pattern.split('|');

      results.push({
        pattern,
        avgDeviationFt: avgDeviation,
        correctionCount: count,
        suggestedAdjustment: {
          type: 'offset',
          value: avgDeviation,
          direction: determineAdjustmentDirection(shape, lineType)
        }
      });
    }

    // Sort by frequency
    results.sort((a, b) => b.correctionCount - a.correctionCount);

    console.log(`Analyzed ${results.length} error patterns`);
    return results;
  } catch (err) {
    console.error('Error analyzing patterns:', err);
    return [];
  }
}

/**
 * Determine likely adjustment direction based on building shape and line type
 */
function determineAdjustmentDirection(buildingShape: string, lineType: string): string {
  // Common patterns observed in roof measurements
  if (lineType === 'ridge') {
    if (buildingShape === 'L-shape' || buildingShape === 'T-shape') {
      return 'inward_toward_centroid';
    }
    return 'along_primary_axis';
  }
  
  if (lineType === 'valley') {
    return 'toward_reflex_corner';
  }
  
  if (lineType === 'hip') {
    return 'toward_nearest_ridge_endpoint';
  }
  
  return 'unknown';
}

/**
 * Parse WKT to coordinates
 */
function parseWkt(wkt: string): XY[] | null {
  const lineMatch = wkt.match(/LINESTRING\(([^)]+)\)/);
  if (lineMatch) {
    return lineMatch[1].split(',').map(pair => {
      const [lng, lat] = pair.trim().split(' ').map(Number);
      return [lng, lat] as XY;
    });
  }
  return null;
}

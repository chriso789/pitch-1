/**
 * TrainingSchematicWrapper - Adapts training data to SchematicRoofDiagram
 * 
 * This wrapper converts the training view's aiLinearFeatures format
 * to what SchematicRoofDiagram expects, enabling consistent rendering
 * between the Training view and Project AI Measurements view.
 */

import { useMemo } from 'react';
import { SchematicRoofDiagram } from '@/components/measurements/SchematicRoofDiagram';

interface TrainingSchematicWrapperProps {
  aiMeasurement: {
    id: string;
    target_lat?: number;
    target_lng?: number;
    linear_features_wkt?: any;
    perimeter_wkt?: string;
    footprint_vertices_geo?: any;
    footprint_source?: string;
    footprint_confidence?: number;
    detection_method?: string;
  } | null;
  aiLinearFeatures: Array<{
    id?: string;
    type: string;
    wkt: string;
    length_ft: number;
  }>;
  satelliteImageUrl: string;
  centerLat: number;
  centerLng: number;
  width?: number;
  height?: number;
  showSatelliteOverlay?: boolean;
}

export function TrainingSchematicWrapper({
  aiMeasurement,
  aiLinearFeatures,
  satelliteImageUrl,
  centerLat,
  centerLng,
  width = 450,
  height = 350,
  showSatelliteOverlay = true,
}: TrainingSchematicWrapperProps) {
  // Build a measurement object compatible with SchematicRoofDiagram
  const adaptedMeasurement = useMemo(() => {
    if (!aiMeasurement && aiLinearFeatures.length === 0) return null;

    // Convert aiLinearFeatures array to linear_features_wkt format
    const linearFeaturesWkt = aiLinearFeatures.map((feature, index) => ({
      type: feature.type,
      wkt: feature.wkt,
      length_ft: feature.length_ft,
      plan_length_ft: feature.length_ft,
      surface_length_ft: feature.length_ft,
      source: 'ai_detection',
    }));

    return {
      id: aiMeasurement?.id || 'training-preview',
      target_lat: aiMeasurement?.target_lat ?? centerLat,
      target_lng: aiMeasurement?.target_lng ?? centerLng,
      linear_features_wkt: linearFeaturesWkt,
      perimeter_wkt: aiMeasurement?.perimeter_wkt,
      footprint_vertices_geo: aiMeasurement?.footprint_vertices_geo,
      footprint_source: aiMeasurement?.footprint_source,
      footprint_confidence: aiMeasurement?.footprint_confidence,
      detection_method: aiMeasurement?.detection_method,
      // For tags calculation
      total_adjusted_area: 0, // Will be calculated from linear features if needed
    };
  }, [aiMeasurement, aiLinearFeatures, centerLat, centerLng]);

  // Build tags for SchematicRoofDiagram
  const tags = useMemo(() => {
    const tagMap: Record<string, any> = {};
    
    // Calculate totals from linear features
    let ridgeTotal = 0, hipTotal = 0, valleyTotal = 0, eaveTotal = 0, rakeTotal = 0;
    
    aiLinearFeatures.forEach(feature => {
      switch (feature.type.toLowerCase()) {
        case 'ridge': ridgeTotal += feature.length_ft; break;
        case 'hip': hipTotal += feature.length_ft; break;
        case 'valley': valleyTotal += feature.length_ft; break;
        case 'eave': eaveTotal += feature.length_ft; break;
        case 'rake': rakeTotal += feature.length_ft; break;
      }
    });

    tagMap['linear.ridge_ft'] = ridgeTotal;
    tagMap['linear.hip_ft'] = hipTotal;
    tagMap['linear.valley_ft'] = valleyTotal;
    tagMap['linear.eave_ft'] = eaveTotal;
    tagMap['linear.rake_ft'] = rakeTotal;
    
    return tagMap;
  }, [aiLinearFeatures]);

  if (!adaptedMeasurement) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">No AI measurement data available</p>
      </div>
    );
  }

  return (
    <SchematicRoofDiagram
      measurement={adaptedMeasurement}
      tags={tags}
      measurementId={adaptedMeasurement.id}
      width={width}
      height={height}
      showLengthLabels={true}
      showLegend={false}
      showCompass={false}
      showTotals={false}
      showFacets={false}
      showQAPanel={false}
      satelliteImageUrl={showSatelliteOverlay ? satelliteImageUrl : undefined}
      showSatelliteOverlay={showSatelliteOverlay}
      satelliteOpacity={0.6}
      showDebugMarkers={false}
      showDebugPanel={false}
    />
  );
}

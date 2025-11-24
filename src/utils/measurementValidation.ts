import * as turf from '@turf/turf';

export interface ValidationError {
  type: 'error' | 'warning';
  field: string;
  message: string;
  suggestion?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

const MIN_FACET_AREA_SQFT = 10; // Minimum 10 sq ft to be a valid facet
const MAX_FACET_AREA_SQFT = 50000; // Maximum 50,000 sq ft (sanity check)
const MIN_LINEAR_FEATURE_LENGTH_FT = 1; // Minimum 1 ft for ridge/hip/valley
const MAX_COORDINATE_OFFSET_METERS = 100; // Max 100 meters from property center

/**
 * Validate a roof facet (polygon)
 */
export function validateFacet(
  facet: any,
  index: number
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check if facet has valid coordinates
  if (!facet.coordinates || !Array.isArray(facet.coordinates) || facet.coordinates.length < 3) {
    errors.push({
      type: 'error',
      field: `facet_${index}`,
      message: `Facet ${index + 1} must have at least 3 corners`,
      suggestion: 'Draw a complete polygon with 3 or more points',
    });
    return errors;
  }

  try {
    // Create Turf polygon for validation
    const coords = [...facet.coordinates, facet.coordinates[0]]; // Close the polygon
    const polygon = turf.polygon([coords]);

    // Check for self-intersecting polygon
    const kinks = turf.kinks(polygon);
    if (kinks.features.length > 0) {
      errors.push({
        type: 'error',
        field: `facet_${index}`,
        message: `Facet ${index + 1} has crossing edges (self-intersecting)`,
        suggestion: 'Adjust corners so edges don\'t cross each other',
      });
    }

    // Calculate area
    const areaSqM = turf.area(polygon);
    const areaSqFt = areaSqM * 10.764; // Convert to sq ft

    // Check minimum area
    if (areaSqFt < MIN_FACET_AREA_SQFT) {
      errors.push({
        type: 'error',
        field: `facet_${index}`,
        message: `Facet ${index + 1} is too small (${areaSqFt.toFixed(1)} sq ft)`,
        suggestion: `Minimum facet area is ${MIN_FACET_AREA_SQFT} sq ft. This may be a drawing error.`,
      });
    }

    // Check maximum area (sanity check)
    if (areaSqFt > MAX_FACET_AREA_SQFT) {
      errors.push({
        type: 'warning',
        field: `facet_${index}`,
        message: `Facet ${index + 1} is unusually large (${areaSqFt.toFixed(0)} sq ft)`,
        suggestion: 'Verify this is correct. Consider splitting into multiple facets.',
      });
    }

    // Check for very narrow/elongated polygons (aspect ratio check)
    const bbox = turf.bbox(polygon);
    const width = Math.abs(bbox[2] - bbox[0]);
    const height = Math.abs(bbox[3] - bbox[1]);
    const aspectRatio = Math.max(width / height, height / width);
    
    if (aspectRatio > 10) {
      errors.push({
        type: 'warning',
        field: `facet_${index}`,
        message: `Facet ${index + 1} is very elongated`,
        suggestion: 'Check if this facet should be split or redrawn',
      });
    }

  } catch (error) {
    errors.push({
      type: 'error',
      field: `facet_${index}`,
      message: `Facet ${index + 1} has invalid geometry`,
      suggestion: 'Redraw this facet with valid coordinates',
    });
  }

  return errors;
}

/**
 * Validate a linear feature (ridge/hip/valley)
 */
export function validateLinearFeature(
  feature: { start: [number, number]; end: [number, number] },
  type: 'ridge' | 'hip' | 'valley',
  index: number
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!feature.start || !feature.end) {
    errors.push({
      type: 'error',
      field: `${type}_${index}`,
      message: `${type} ${index + 1} is missing start or end point`,
      suggestion: 'Draw a complete line with both endpoints',
    });
    return errors;
  }

  try {
    const line = turf.lineString([feature.start, feature.end]);
    const lengthMeters = turf.length(line, { units: 'meters' });
    const lengthFeet = lengthMeters * 3.281; // Convert to feet

    if (lengthFeet < MIN_LINEAR_FEATURE_LENGTH_FT) {
      errors.push({
        type: 'error',
        field: `${type}_${index}`,
        message: `${type} ${index + 1} is too short (${lengthFeet.toFixed(1)} ft)`,
        suggestion: `Minimum length is ${MIN_LINEAR_FEATURE_LENGTH_FT} ft`,
      });
    }
  } catch (error) {
    errors.push({
      type: 'error',
      field: `${type}_${index}`,
      message: `${type} ${index + 1} has invalid coordinates`,
      suggestion: 'Redraw this feature with valid endpoints',
    });
  }

  return errors;
}

/**
 * Validate coordinate bounds relative to property center
 */
export function validateCoordinateBounds(
  coordinates: [number, number],
  propertyCenter: [number, number],
  context: string
): ValidationError[] {
  const errors: ValidationError[] = [];

  try {
    const point1 = turf.point(coordinates);
    const point2 = turf.point(propertyCenter);
    const distanceMeters = turf.distance(point1, point2, { units: 'meters' });

    if (distanceMeters > MAX_COORDINATE_OFFSET_METERS) {
      errors.push({
        type: 'warning',
        field: context,
        message: `${context} is ${distanceMeters.toFixed(0)}m from property center`,
        suggestion: 'This point may be outside the property boundary. Verify placement.',
      });
    }
  } catch (error) {
    errors.push({
      type: 'error',
      field: context,
      message: `${context} has invalid coordinates`,
      suggestion: 'Check coordinate values',
    });
  }

  return errors;
}

/**
 * Validate complete measurement data
 */
export function validateMeasurement(
  measurement: any,
  propertyCenter?: [number, number]
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // Validate facets
  if (measurement.faces && Array.isArray(measurement.faces)) {
    measurement.faces.forEach((facet: any, index: number) => {
      const facetErrors = validateFacet(facet, index);
      facetErrors.forEach(err => {
        if (err.type === 'error') {
          errors.push(err);
        } else {
          warnings.push(err);
        }
      });

      // Validate facet coordinate bounds
      if (propertyCenter && facet.coordinates) {
        facet.coordinates.forEach((coord: [number, number], coordIndex: number) => {
          const boundErrors = validateCoordinateBounds(
            coord,
            propertyCenter,
            `Facet ${index + 1} corner ${coordIndex + 1}`
          );
          boundErrors.forEach(err => {
            if (err.type === 'warning') warnings.push(err);
          });
        });
      }
    });
  }

  // Validate linear features
  if (measurement.linear_features) {
    ['ridge', 'hip', 'valley'].forEach((type) => {
      const features = measurement.linear_features[type] || [];
      features.forEach((feature: any, index: number) => {
        const featureErrors = validateLinearFeature(
          feature,
          type as 'ridge' | 'hip' | 'valley',
          index
        );
        featureErrors.forEach(err => {
          if (err.type === 'error') {
            errors.push(err);
          } else {
            warnings.push(err);
          }
        });
      });
    });
  }

  // Validate summary data
  if (measurement.summary) {
    if (!measurement.summary.total_area_sqft || measurement.summary.total_area_sqft <= 0) {
      errors.push({
        type: 'error',
        field: 'total_area',
        message: 'Total roof area is missing or invalid',
        suggestion: 'Draw at least one valid facet',
      });
    }

    if (measurement.summary.total_area_sqft > MAX_FACET_AREA_SQFT) {
      warnings.push({
        type: 'warning',
        field: 'total_area',
        message: `Total roof area is unusually large (${measurement.summary.total_area_sqft.toFixed(0)} sq ft)`,
        suggestion: 'Verify all facets are correctly sized',
      });
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Format validation errors for display
 */
export function formatValidationMessage(result: ValidationResult): string {
  const messages: string[] = [];

  if (result.errors.length > 0) {
    messages.push('❌ Errors:');
    result.errors.forEach(err => {
      messages.push(`  • ${err.message}`);
      if (err.suggestion) {
        messages.push(`    💡 ${err.suggestion}`);
      }
    });
  }

  if (result.warnings.length > 0) {
    messages.push('⚠️ Warnings:');
    result.warnings.forEach(warn => {
      messages.push(`  • ${warn.message}`);
      if (warn.suggestion) {
        messages.push(`    💡 ${warn.suggestion}`);
      }
    });
  }

  return messages.join('\n');
}

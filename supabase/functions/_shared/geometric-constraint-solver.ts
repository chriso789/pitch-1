/**
 * Phase 30: Geometric Constraint Solver
 * Applies physical construction constraints to refine AI-detected geometry.
 */

export interface GeometricConstraint {
  id: string;
  type: 'ridge_highest' | 'hip_45_degree' | 'valley_to_junction' | 'endpoint_connection' | 'no_crossing' | 'pitch_consistency';
  description: string;
  weight: number; // Importance of this constraint
  toleranceFt?: number;
  toleranceDegrees?: number;
}

export interface ConstraintViolation {
  constraintId: string;
  constraintType: string;
  severity: 'error' | 'warning' | 'info';
  featureId: string;
  description: string;
  currentValue: number;
  expectedValue: number;
  deviation: number;
}

export interface ConstraintSolverResult {
  originalGeometry: LinearFeature[];
  optimizedGeometry: LinearFeature[];
  violationsBefore: ConstraintViolation[];
  violationsAfter: ConstraintViolation[];
  adjustmentsMade: { featureId: string; adjustment: string; deltaFt: number }[];
  constraintScore: number;
  isValid: boolean;
}

export interface LinearFeature {
  id: string;
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  lengthFt: number;
}

export interface RoofGeometry {
  features: LinearFeature[];
  perimeterCorners: { lat: number; lng: number }[];
  pitch: string;
  roofType: 'hip' | 'gable' | 'dutch' | 'gambrel' | 'mansard' | 'flat';
}

const EARTH_RADIUS_FT = 20902231;

function haversineDistanceFt(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2) ** 2 + 
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2) ** 2;
  return 2 * EARTH_RADIUS_FT * Math.asin(Math.sqrt(a));
}

function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const toDeg = (rad: number) => rad * 180 / Math.PI;
  
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - 
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Define standard geometric constraints for roof construction
 */
export function defineGeometricConstraints(roofType: RoofGeometry['roofType']): GeometricConstraint[] {
  const constraints: GeometricConstraint[] = [
    {
      id: 'ridge_highest',
      type: 'ridge_highest',
      description: 'Ridge must be the highest point (above all hips/valleys)',
      weight: 1.0
    },
    {
      id: 'hip_45',
      type: 'hip_45_degree',
      description: 'Hip lines should be at approximately 45° angle from ridge',
      weight: 0.8,
      toleranceDegrees: 10
    },
    {
      id: 'valley_junction',
      type: 'valley_to_junction',
      description: 'Valley endpoints must connect to perimeter or junction points',
      weight: 0.9,
      toleranceFt: 2.0
    },
    {
      id: 'endpoint_connect',
      type: 'endpoint_connection',
      description: 'All interior lines must connect at both ends',
      weight: 1.0,
      toleranceFt: 2.0
    },
    {
      id: 'no_cross',
      type: 'no_crossing',
      description: 'Lines should not cross except at junction points',
      weight: 1.0,
      toleranceFt: 0.5
    },
    {
      id: 'pitch_consistent',
      type: 'pitch_consistency',
      description: 'Adjacent facets should have consistent pitch',
      weight: 0.7
    }
  ];
  
  // Add roof-type-specific constraints
  if (roofType === 'hip') {
    constraints.push({
      id: 'hip_count_4',
      type: 'endpoint_connection',
      description: 'Rectangular hip roof should have exactly 4 hips',
      weight: 0.9
    });
  }
  
  return constraints;
}

/**
 * Calculate constraint violations for geometry
 */
export function calculateConstraintViolations(
  geometry: RoofGeometry,
  constraints: GeometricConstraint[]
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  
  const ridges = geometry.features.filter(f => f.type === 'ridge');
  const hips = geometry.features.filter(f => f.type === 'hip');
  const valleys = geometry.features.filter(f => f.type === 'valley');
  
  for (const constraint of constraints) {
    switch (constraint.type) {
      case 'hip_45_degree':
        // Check hip angles relative to ridge
        for (const hip of hips) {
          if (ridges.length > 0) {
            const ridgeBearing = calculateBearing(
              ridges[0].startLat, ridges[0].startLng,
              ridges[0].endLat, ridges[0].endLng
            );
            const hipBearing = calculateBearing(
              hip.startLat, hip.startLng,
              hip.endLat, hip.endLng
            );
            
            let angleDiff = Math.abs(hipBearing - ridgeBearing);
            if (angleDiff > 180) angleDiff = 360 - angleDiff;
            
            // Hip should be at ~45° or ~135° from ridge
            const deviation45 = Math.abs(angleDiff - 45);
            const deviation135 = Math.abs(angleDiff - 135);
            const minDeviation = Math.min(deviation45, deviation135);
            
            if (minDeviation > (constraint.toleranceDegrees || 10)) {
              violations.push({
                constraintId: constraint.id,
                constraintType: constraint.type,
                severity: minDeviation > 20 ? 'error' : 'warning',
                featureId: hip.id,
                description: `Hip ${hip.id} angle deviates ${minDeviation.toFixed(1)}° from expected 45°`,
                currentValue: angleDiff,
                expectedValue: angleDiff > 90 ? 135 : 45,
                deviation: minDeviation
              });
            }
          }
        }
        break;
        
      case 'endpoint_connection':
        // Check that all endpoints connect
        for (const feature of [...hips, ...valleys]) {
          const startConnected = isEndpointConnected(
            feature.startLat, feature.startLng,
            geometry.features,
            geometry.perimeterCorners,
            constraint.toleranceFt || 2.0
          );
          
          const endConnected = isEndpointConnected(
            feature.endLat, feature.endLng,
            geometry.features,
            geometry.perimeterCorners,
            constraint.toleranceFt || 2.0
          );
          
          if (!startConnected) {
            violations.push({
              constraintId: constraint.id,
              constraintType: constraint.type,
              severity: 'error',
              featureId: feature.id,
              description: `${feature.type} ${feature.id} start endpoint not connected`,
              currentValue: 0,
              expectedValue: 1,
              deviation: 1
            });
          }
          
          if (!endConnected) {
            violations.push({
              constraintId: constraint.id,
              constraintType: constraint.type,
              severity: 'error',
              featureId: feature.id,
              description: `${feature.type} ${feature.id} end endpoint not connected`,
              currentValue: 0,
              expectedValue: 1,
              deviation: 1
            });
          }
        }
        break;
        
      case 'no_crossing':
        // Check for line crossings
        for (let i = 0; i < geometry.features.length; i++) {
          for (let j = i + 1; j < geometry.features.length; j++) {
            const f1 = geometry.features[i];
            const f2 = geometry.features[j];
            
            const intersection = lineIntersection(
              f1.startLat, f1.startLng, f1.endLat, f1.endLng,
              f2.startLat, f2.startLng, f2.endLat, f2.endLng
            );
            
            if (intersection && !isNearEndpoint(intersection, f1, f2, constraint.toleranceFt || 0.5)) {
              violations.push({
                constraintId: constraint.id,
                constraintType: constraint.type,
                severity: 'error',
                featureId: `${f1.id}_${f2.id}`,
                description: `Lines ${f1.id} and ${f2.id} cross unexpectedly`,
                currentValue: 1,
                expectedValue: 0,
                deviation: 1
              });
            }
          }
        }
        break;
    }
  }
  
  return violations;
}

/**
 * Check if endpoint is connected to another feature or perimeter
 */
function isEndpointConnected(
  lat: number,
  lng: number,
  features: LinearFeature[],
  perimeterCorners: { lat: number; lng: number }[],
  toleranceFt: number
): boolean {
  // Check perimeter corners
  for (const corner of perimeterCorners) {
    if (haversineDistanceFt(lat, lng, corner.lat, corner.lng) <= toleranceFt) {
      return true;
    }
  }
  
  // Check other feature endpoints
  for (const feature of features) {
    if (haversineDistanceFt(lat, lng, feature.startLat, feature.startLng) <= toleranceFt) {
      return true;
    }
    if (haversineDistanceFt(lat, lng, feature.endLat, feature.endLng) <= toleranceFt) {
      return true;
    }
  }
  
  return false;
}

/**
 * Calculate line intersection
 */
function lineIntersection(
  lat1: number, lng1: number, lat2: number, lng2: number,
  lat3: number, lng3: number, lat4: number, lng4: number
): { lat: number; lng: number } | null {
  const denom = (lat4 - lat3) * (lng2 - lng1) - (lng4 - lng3) * (lat2 - lat1);
  if (Math.abs(denom) < 1e-10) return null;
  
  const ua = ((lng4 - lng3) * (lat1 - lat3) - (lat4 - lat3) * (lng1 - lng3)) / denom;
  const ub = ((lng2 - lng1) * (lat1 - lat3) - (lat2 - lat1) * (lng1 - lng3)) / denom;
  
  if (ua >= 0.01 && ua <= 0.99 && ub >= 0.01 && ub <= 0.99) {
    return {
      lat: lat1 + ua * (lat2 - lat1),
      lng: lng1 + ua * (lng2 - lng1)
    };
  }
  
  return null;
}

/**
 * Check if intersection is near an endpoint
 */
function isNearEndpoint(
  point: { lat: number; lng: number },
  f1: LinearFeature,
  f2: LinearFeature,
  toleranceFt: number
): boolean {
  const endpoints = [
    { lat: f1.startLat, lng: f1.startLng },
    { lat: f1.endLat, lng: f1.endLng },
    { lat: f2.startLat, lng: f2.startLng },
    { lat: f2.endLat, lng: f2.endLng }
  ];
  
  return endpoints.some(ep => 
    haversineDistanceFt(point.lat, point.lng, ep.lat, ep.lng) <= toleranceFt
  );
}

/**
 * Optimize geometry to satisfy constraints using gradient descent
 */
export function optimizeGeometryToConstraints(
  geometry: RoofGeometry,
  constraints: GeometricConstraint[],
  maxIterations: number = 100
): { optimized: LinearFeature[]; adjustments: { featureId: string; adjustment: string; deltaFt: number }[] } {
  const optimized: LinearFeature[] = JSON.parse(JSON.stringify(geometry.features));
  const adjustments: { featureId: string; adjustment: string; deltaFt: number }[] = [];
  
  const learningRate = 0.0000001; // Very small for lat/lng adjustments
  
  for (let iter = 0; iter < maxIterations; iter++) {
    const violations = calculateConstraintViolations(
      { ...geometry, features: optimized },
      constraints
    );
    
    if (violations.length === 0) break;
    
    // Apply corrections for each violation
    for (const violation of violations) {
      const featureIndex = optimized.findIndex(f => f.id === violation.featureId);
      if (featureIndex === -1) continue;
      
      const feature = optimized[featureIndex];
      
      switch (violation.constraintType) {
        case 'hip_45_degree':
          // Adjust hip angle toward 45°
          const ridge = geometry.features.find(f => f.type === 'ridge');
          if (ridge) {
            const correctionAngle = violation.deviation * learningRate * 1000;
            const adjustment = rotateEndpoint(feature, correctionAngle, 'end');
            optimized[featureIndex] = adjustment;
            adjustments.push({
              featureId: feature.id,
              adjustment: `Rotated ${correctionAngle.toFixed(2)}°`,
              deltaFt: violation.deviation
            });
          }
          break;
          
        case 'endpoint_connection':
          // Snap endpoint to nearest valid connection
          const nearestConnection = findNearestConnection(
            feature,
            geometry.features,
            geometry.perimeterCorners,
            violation.description.includes('start')
          );
          
          if (nearestConnection) {
            if (violation.description.includes('start')) {
              optimized[featureIndex] = {
                ...feature,
                startLat: nearestConnection.lat,
                startLng: nearestConnection.lng
              };
            } else {
              optimized[featureIndex] = {
                ...feature,
                endLat: nearestConnection.lat,
                endLng: nearestConnection.lng
              };
            }
            adjustments.push({
              featureId: feature.id,
              adjustment: 'Snapped endpoint to connection',
              deltaFt: haversineDistanceFt(
                feature.endLat, feature.endLng,
                nearestConnection.lat, nearestConnection.lng
              )
            });
          }
          break;
      }
    }
  }
  
  // Recalculate lengths
  for (const feature of optimized) {
    feature.lengthFt = haversineDistanceFt(
      feature.startLat, feature.startLng,
      feature.endLat, feature.endLng
    );
  }
  
  return { optimized, adjustments };
}

/**
 * Rotate endpoint around start point
 */
function rotateEndpoint(
  feature: LinearFeature,
  angleDegrees: number,
  which: 'start' | 'end'
): LinearFeature {
  const angleRad = angleDegrees * Math.PI / 180;
  
  if (which === 'end') {
    const dx = feature.endLng - feature.startLng;
    const dy = feature.endLat - feature.startLat;
    
    const newDx = dx * Math.cos(angleRad) - dy * Math.sin(angleRad);
    const newDy = dx * Math.sin(angleRad) + dy * Math.cos(angleRad);
    
    return {
      ...feature,
      endLat: feature.startLat + newDy,
      endLng: feature.startLng + newDx
    };
  }
  
  return feature;
}

/**
 * Find nearest valid connection point
 */
function findNearestConnection(
  feature: LinearFeature,
  allFeatures: LinearFeature[],
  perimeterCorners: { lat: number; lng: number }[],
  checkStart: boolean
): { lat: number; lng: number } | null {
  const point = checkStart 
    ? { lat: feature.startLat, lng: feature.startLng }
    : { lat: feature.endLat, lng: feature.endLng };
  
  let nearest: { lat: number; lng: number } | null = null;
  let minDist = Infinity;
  
  // Check perimeter corners
  for (const corner of perimeterCorners) {
    const dist = haversineDistanceFt(point.lat, point.lng, corner.lat, corner.lng);
    if (dist < minDist && dist < 10) { // Max 10ft snap distance
      minDist = dist;
      nearest = corner;
    }
  }
  
  // Check feature endpoints
  for (const f of allFeatures) {
    if (f.id === feature.id) continue;
    
    for (const ep of [
      { lat: f.startLat, lng: f.startLng },
      { lat: f.endLat, lng: f.endLng }
    ]) {
      const dist = haversineDistanceFt(point.lat, point.lng, ep.lat, ep.lng);
      if (dist < minDist && dist < 10) {
        minDist = dist;
        nearest = ep;
      }
    }
  }
  
  return nearest;
}

/**
 * Main constraint solver function
 */
export function solveGeometricConstraints(
  geometry: RoofGeometry
): ConstraintSolverResult {
  const constraints = defineGeometricConstraints(geometry.roofType);
  
  // Calculate initial violations
  const violationsBefore = calculateConstraintViolations(geometry, constraints);
  
  // Optimize geometry
  const { optimized, adjustments } = optimizeGeometryToConstraints(geometry, constraints);
  
  // Calculate remaining violations
  const violationsAfter = calculateConstraintViolations(
    { ...geometry, features: optimized },
    constraints
  );
  
  // Calculate constraint satisfaction score
  const maxPossibleViolations = geometry.features.length * constraints.length;
  const score = 100 * (1 - violationsAfter.length / maxPossibleViolations);
  
  return {
    originalGeometry: geometry.features,
    optimizedGeometry: optimized,
    violationsBefore,
    violationsAfter,
    adjustmentsMade: adjustments,
    constraintScore: score,
    isValid: violationsAfter.filter(v => v.severity === 'error').length === 0
  };
}

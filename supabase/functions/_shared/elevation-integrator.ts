/**
 * Phase 43: 3D Elevation Integration System
 * Uses USGS 3DEP LiDAR data to improve pitch detection and vertex height calculation
 */

interface ElevationData {
  groundElevationFt: number;
  ridgeElevationFt: number;
  eaveElevationFt: number;
  calculatedRidgeHeightFt: number;
  elevationDerivedPitch: string;
  pitchConfidence: number;
  dataSource: 'usgs_3dep' | 'lidar' | 'photogrammetry' | 'estimated';
  dataQuality: 'high' | 'medium' | 'low' | 'unknown';
  resolutionMeters: number;
  acquisitionDate: string | null;
}

interface LiDARPoint {
  x: number;
  y: number;
  z: number;
  classification: number;
}

interface ElevationProfile {
  points: { distance: number; elevation: number }[];
  minElevation: number;
  maxElevation: number;
  averageSlope: number;
}

// Fetch elevation data from USGS 3DEP
export async function fetchUSGS3DEPElevation(
  lat: number,
  lng: number,
  radiusFt: number = 100
): Promise<ElevationData> {
  try {
    // Convert radius to degrees (approximate)
    const radiusDeg = radiusFt / 364000;
    
    // Query USGS 3DEP endpoint
    const bbox = `${lng - radiusDeg},${lat - radiusDeg},${lng + radiusDeg},${lat + radiusDeg}`;
    const url = `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/query?` +
      `geometry=${lng},${lat}&geometryType=esriGeometryPoint&` +
      `returnGeometry=false&returnCountOnly=false&f=json&` +
      `pixelSize=1`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      console.log('USGS 3DEP unavailable, using fallback');
      return estimateElevationData(lat, lng);
    }
    
    const data = await response.json();
    
    // Extract elevation values
    const groundElevation = data.value || data.elevation || 0;
    
    // Query multiple points around the building to estimate ridge height
    const elevationPoints = await queryMultipleElevations(lat, lng, radiusFt);
    
    const ridgeElevation = Math.max(...elevationPoints.map(p => p.elevation));
    const eaveElevation = Math.min(...elevationPoints.filter(p => p.classification === 'building').map(p => p.elevation)) || groundElevation;
    
    const ridgeHeight = ridgeElevation - groundElevation;
    const buildingWidth = estimateBuildingWidth(elevationPoints);
    
    // Calculate pitch from elevation difference
    const { pitch, confidence } = calculatePitchFromElevation(ridgeHeight, buildingWidth);
    
    return {
      groundElevationFt: groundElevation * 3.28084, // Convert meters to feet
      ridgeElevationFt: ridgeElevation * 3.28084,
      eaveElevationFt: eaveElevation * 3.28084,
      calculatedRidgeHeightFt: ridgeHeight * 3.28084,
      elevationDerivedPitch: pitch,
      pitchConfidence: confidence,
      dataSource: 'usgs_3dep',
      dataQuality: determineDataQuality(data),
      resolutionMeters: data.resolution || 1,
      acquisitionDate: data.acquisitionDate || null
    };
  } catch (error) {
    console.error('Error fetching 3DEP elevation:', error);
    return estimateElevationData(lat, lng);
  }
}

// Query multiple elevation points around building
async function queryMultipleElevations(
  centerLat: number,
  centerLng: number,
  radiusFt: number
): Promise<{ lat: number; lng: number; elevation: number; classification: string }[]> {
  const points: { lat: number; lng: number; elevation: number; classification: string }[] = [];
  const radiusDeg = radiusFt / 364000;
  
  // Create grid of points
  const gridSize = 5;
  for (let i = -gridSize; i <= gridSize; i++) {
    for (let j = -gridSize; j <= gridSize; j++) {
      const lat = centerLat + (i / gridSize) * radiusDeg;
      const lng = centerLng + (j / gridSize) * radiusDeg;
      
      try {
        const url = `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/identify?` +
          `geometry=${lng},${lat}&geometryType=esriGeometryPoint&f=json`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        points.push({
          lat,
          lng,
          elevation: data.value || 0,
          classification: classifyPoint(i, j, gridSize)
        });
      } catch {
        // Skip failed points
      }
    }
  }
  
  return points;
}

function classifyPoint(i: number, j: number, gridSize: number): string {
  // Center points are likely on building
  const distFromCenter = Math.sqrt(i * i + j * j);
  if (distFromCenter < gridSize * 0.3) return 'building_center';
  if (distFromCenter < gridSize * 0.6) return 'building';
  return 'ground';
}

function estimateBuildingWidth(points: { lat: number; lng: number; elevation: number; classification: string }[]): number {
  const buildingPoints = points.filter(p => p.classification.startsWith('building'));
  if (buildingPoints.length < 2) return 30; // Default 30ft width
  
  // Calculate bounding box of building points
  const lats = buildingPoints.map(p => p.lat);
  const lngs = buildingPoints.map(p => p.lng);
  
  const latRange = Math.max(...lats) - Math.min(...lats);
  const lngRange = Math.max(...lngs) - Math.min(...lngs);
  
  // Convert to feet (approximate)
  const widthFt = Math.max(latRange, lngRange) * 364000;
  return Math.max(20, Math.min(100, widthFt)); // Clamp to reasonable range
}

// Calculate pitch from elevation data
export function calculatePitchFromElevation(
  ridgeHeightFt: number,
  buildingWidthFt: number
): { pitch: string; confidence: number } {
  // Assume symmetric gable roof - half width is the run
  const run = buildingWidthFt / 2;
  const rise = ridgeHeightFt;
  
  // Calculate pitch as rise/run (pitch = rise per 12" run)
  const pitchValue = (rise / run) * 12;
  
  // Round to nearest common pitch
  const commonPitches = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18];
  const nearestPitch = commonPitches.reduce((prev, curr) => 
    Math.abs(curr - pitchValue) < Math.abs(prev - pitchValue) ? curr : prev
  );
  
  // Calculate confidence based on how close we are to a common pitch
  const deviation = Math.abs(pitchValue - nearestPitch);
  const confidence = Math.max(0.3, 1 - (deviation / 3));
  
  return {
    pitch: `${nearestPitch}/12`,
    confidence: Math.round(confidence * 100) / 100
  };
}

// Cross-validate pitch from multiple sources
export function crossValidatePitchMethods(
  shadowPitch: string | null,
  elevationPitch: string | null,
  solarPitch: string | null,
  aerialPitch: string | null
): { 
  finalPitch: string; 
  confidence: number; 
  sources: string[];
  agreement: number;
} {
  const pitches: { source: string; pitch: string; weight: number }[] = [];
  
  if (shadowPitch) pitches.push({ source: 'shadow', pitch: shadowPitch, weight: 0.8 });
  if (elevationPitch) pitches.push({ source: 'elevation', pitch: elevationPitch, weight: 0.9 });
  if (solarPitch) pitches.push({ source: 'solar_api', pitch: solarPitch, weight: 0.95 });
  if (aerialPitch) pitches.push({ source: 'aerial_ai', pitch: aerialPitch, weight: 0.7 });
  
  if (pitches.length === 0) {
    return { finalPitch: 'unknown', confidence: 0, sources: [], agreement: 0 };
  }
  
  // Convert pitches to numeric values
  const numericPitches = pitches.map(p => ({
    ...p,
    value: parsePitchToNumber(p.pitch)
  })).filter(p => p.value !== null);
  
  if (numericPitches.length === 0) {
    return { finalPitch: pitches[0].pitch, confidence: 0.5, sources: [pitches[0].source], agreement: 0 };
  }
  
  // Calculate weighted average
  const totalWeight = numericPitches.reduce((sum, p) => sum + p.weight, 0);
  const weightedAverage = numericPitches.reduce((sum, p) => sum + (p.value! * p.weight), 0) / totalWeight;
  
  // Round to nearest common pitch
  const commonPitches = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18];
  const finalPitchValue = commonPitches.reduce((prev, curr) => 
    Math.abs(curr - weightedAverage) < Math.abs(prev - weightedAverage) ? curr : prev
  );
  
  // Calculate agreement (how close all sources are)
  const variance = numericPitches.reduce((sum, p) => sum + Math.pow(p.value! - weightedAverage, 2), 0) / numericPitches.length;
  const agreement = Math.max(0, 1 - (Math.sqrt(variance) / 6)); // 6/12 pitch difference = 0% agreement
  
  // Confidence based on agreement and number of sources
  const sourceBonus = Math.min(0.2, numericPitches.length * 0.05);
  const confidence = Math.min(0.99, agreement * 0.8 + sourceBonus);
  
  return {
    finalPitch: `${finalPitchValue}/12`,
    confidence: Math.round(confidence * 100) / 100,
    sources: numericPitches.map(p => p.source),
    agreement: Math.round(agreement * 100) / 100
  };
}

function parsePitchToNumber(pitch: string): number | null {
  const match = pitch.match(/(\d+(?:\.\d+)?)\s*[/:]\s*12/i);
  if (match) return parseFloat(match[1]);
  
  // Try just a number
  const num = parseFloat(pitch);
  if (!isNaN(num) && num >= 0 && num <= 24) return num;
  
  return null;
}

// Derive pitch from ridge height calculation
export function derivePitchFromRidgeHeight(
  ridgeHeightFt: number,
  buildingWidthFt: number,
  roofType: 'gable' | 'hip' | 'shed' | 'flat' = 'gable'
): { pitch: string; confidence: number } {
  let effectiveRun: number;
  
  switch (roofType) {
    case 'gable':
      effectiveRun = buildingWidthFt / 2;
      break;
    case 'hip':
      effectiveRun = buildingWidthFt / 2 * 0.9; // Hip roofs have slightly shorter run
      break;
    case 'shed':
      effectiveRun = buildingWidthFt;
      break;
    case 'flat':
      return { pitch: '0/12', confidence: 0.95 };
    default:
      effectiveRun = buildingWidthFt / 2;
  }
  
  return calculatePitchFromElevation(ridgeHeightFt, effectiveRun * 2);
}

// Generate elevation profile along a line
export async function generateElevationProfile(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  numSamples: number = 20
): Promise<ElevationProfile> {
  const points: { distance: number; elevation: number }[] = [];
  
  for (let i = 0; i <= numSamples; i++) {
    const t = i / numSamples;
    const lat = startLat + t * (endLat - startLat);
    const lng = startLng + t * (endLng - startLng);
    
    try {
      const url = `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/identify?` +
        `geometry=${lng},${lat}&geometryType=esriGeometryPoint&f=json`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      const distance = i * calculateHaversineDistance(startLat, startLng, endLat, endLng) / numSamples;
      points.push({
        distance,
        elevation: (data.value || 0) * 3.28084 // Convert to feet
      });
    } catch {
      // Skip failed points
    }
  }
  
  if (points.length === 0) {
    return {
      points: [],
      minElevation: 0,
      maxElevation: 0,
      averageSlope: 0
    };
  }
  
  const elevations = points.map(p => p.elevation);
  const minElevation = Math.min(...elevations);
  const maxElevation = Math.max(...elevations);
  
  // Calculate average slope
  let totalSlope = 0;
  for (let i = 1; i < points.length; i++) {
    const rise = points[i].elevation - points[i-1].elevation;
    const run = points[i].distance - points[i-1].distance;
    if (run > 0) {
      totalSlope += Math.abs(rise / run);
    }
  }
  const averageSlope = totalSlope / (points.length - 1);
  
  return {
    points,
    minElevation,
    maxElevation,
    averageSlope
  };
}

function calculateHaversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 20902231; // Earth radius in feet
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function determineDataQuality(data: any): 'high' | 'medium' | 'low' | 'unknown' {
  if (!data) return 'unknown';
  
  const resolution = data.resolution || 10;
  if (resolution <= 1) return 'high';
  if (resolution <= 3) return 'medium';
  if (resolution <= 10) return 'low';
  return 'unknown';
}

function estimateElevationData(lat: number, lng: number): ElevationData {
  return {
    groundElevationFt: 0,
    ridgeElevationFt: 0,
    eaveElevationFt: 0,
    calculatedRidgeHeightFt: 0,
    elevationDerivedPitch: 'unknown',
    pitchConfidence: 0,
    dataSource: 'estimated',
    dataQuality: 'unknown',
    resolutionMeters: 0,
    acquisitionDate: null
  };
}

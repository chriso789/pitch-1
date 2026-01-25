// =====================================================
// Phase 88: Synthetic Roof Generator
// Generate realistic synthetic roof geometries for testing
// =====================================================

export type RoofShape = 'simple_hip' | 'simple_gable' | 'cross_hip' | 'cross_gable' | 
  'l_shape' | 't_shape' | 'u_shape' | 'complex' | 'mansard' | 'gambrel';

export interface SyntheticRoof {
  id: string;
  shape: RoofShape;
  expectedMeasurements: ExpectedMeasurements;
  vertices: Vertex[];
  edges: Edge[];
  facets: Facet[];
  imageDescription: string;
  difficulty: 'easy' | 'medium' | 'hard' | 'expert';
}

export interface ExpectedMeasurements {
  totalAreaSqft: number;
  ridgeLength: number;
  hipLength: number;
  valleyLength: number;
  eaveLength: number;
  rakeLength: number;
  predominantPitch: string;
  facetCount: number;
  tolerance: {
    area: number; // percentage
    linear: number; // percentage
  };
}

export interface Vertex {
  id: string;
  x: number;
  y: number;
  z: number;
  type: 'corner' | 'ridge_end' | 'hip_point' | 'valley_point' | 'gable_peak';
}

export interface Edge {
  id: string;
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
  startVertexId: string;
  endVertexId: string;
  length: number;
}

export interface Facet {
  id: string;
  area: number;
  pitch: string;
  pitchDegrees: number;
  vertexIds: string[];
  orientation: 'north' | 'south' | 'east' | 'west';
}

// Generator class
export class SyntheticRoofGenerator {
  private counter = 0;

  // Generate a single synthetic roof
  generateRoof(
    shape: RoofShape = 'simple_hip',
    options: {
      baseWidth?: number;
      baseLength?: number;
      pitch?: string;
      complexity?: number;
    } = {}
  ): SyntheticRoof {
    const {
      baseWidth = this.randomInRange(30, 60),
      baseLength = this.randomInRange(40, 80),
      pitch = this.randomPitch(),
      complexity = 1,
    } = options;

    this.counter++;
    const id = `synthetic-${this.counter}-${Date.now()}`;

    switch (shape) {
      case 'simple_hip':
        return this.generateSimpleHip(id, baseWidth, baseLength, pitch);
      case 'simple_gable':
        return this.generateSimpleGable(id, baseWidth, baseLength, pitch);
      case 'cross_hip':
        return this.generateCrossHip(id, baseWidth, baseLength, pitch);
      case 'l_shape':
        return this.generateLShape(id, baseWidth, baseLength, pitch);
      case 't_shape':
        return this.generateTShape(id, baseWidth, baseLength, pitch);
      default:
        return this.generateSimpleHip(id, baseWidth, baseLength, pitch);
    }
  }

  // Generate batch of synthetic roofs for testing
  generateTestBatch(count: number = 100): SyntheticRoof[] {
    const shapes: RoofShape[] = [
      'simple_hip', 'simple_gable', 'cross_hip', 
      'l_shape', 't_shape', 'complex'
    ];
    
    const roofs: SyntheticRoof[] = [];
    
    for (let i = 0; i < count; i++) {
      const shape = shapes[i % shapes.length];
      roofs.push(this.generateRoof(shape, {
        baseWidth: 30 + Math.random() * 40,
        baseLength: 40 + Math.random() * 50,
        pitch: this.randomPitch(),
      }));
    }
    
    return roofs;
  }

  private generateSimpleHip(
    id: string,
    width: number,
    length: number,
    pitch: string
  ): SyntheticRoof {
    const pitchMultiplier = this.pitchToMultiplier(pitch);
    const roofHeight = (width / 2) * Math.tan(this.pitchToRadians(pitch));
    
    // Calculate ridge length (centered)
    const ridgeLength = length - width;
    const hipLength = Math.sqrt(Math.pow(width / 2, 2) + Math.pow(width / 2, 2));
    
    // Calculate areas
    const frontBackArea = 2 * (0.5 * width * (width / 2) * pitchMultiplier);
    const sideArea = 2 * (ridgeLength * (width / 2) * pitchMultiplier);
    const totalArea = frontBackArea + sideArea;
    
    const vertices: Vertex[] = [
      { id: 'v1', x: 0, y: 0, z: 0, type: 'corner' },
      { id: 'v2', x: length, y: 0, z: 0, type: 'corner' },
      { id: 'v3', x: length, y: width, z: 0, type: 'corner' },
      { id: 'v4', x: 0, y: width, z: 0, type: 'corner' },
      { id: 'v5', x: width / 2, y: width / 2, z: roofHeight, type: 'ridge_end' },
      { id: 'v6', x: length - width / 2, y: width / 2, z: roofHeight, type: 'ridge_end' },
    ];
    
    const edges: Edge[] = [
      { id: 'e1', type: 'eave', startVertexId: 'v1', endVertexId: 'v2', length: length },
      { id: 'e2', type: 'eave', startVertexId: 'v2', endVertexId: 'v3', length: width },
      { id: 'e3', type: 'eave', startVertexId: 'v3', endVertexId: 'v4', length: length },
      { id: 'e4', type: 'eave', startVertexId: 'v4', endVertexId: 'v1', length: width },
      { id: 'e5', type: 'ridge', startVertexId: 'v5', endVertexId: 'v6', length: ridgeLength },
      { id: 'e6', type: 'hip', startVertexId: 'v1', endVertexId: 'v5', length: hipLength * pitchMultiplier },
      { id: 'e7', type: 'hip', startVertexId: 'v2', endVertexId: 'v6', length: hipLength * pitchMultiplier },
      { id: 'e8', type: 'hip', startVertexId: 'v3', endVertexId: 'v6', length: hipLength * pitchMultiplier },
      { id: 'e9', type: 'hip', startVertexId: 'v4', endVertexId: 'v5', length: hipLength * pitchMultiplier },
    ];
    
    const facets: Facet[] = [
      { id: 'f1', area: sideArea / 2, pitch, pitchDegrees: this.pitchToDegrees(pitch), vertexIds: ['v1', 'v2', 'v6', 'v5'], orientation: 'south' },
      { id: 'f2', area: frontBackArea / 2, pitch, pitchDegrees: this.pitchToDegrees(pitch), vertexIds: ['v2', 'v3', 'v6'], orientation: 'east' },
      { id: 'f3', area: sideArea / 2, pitch, pitchDegrees: this.pitchToDegrees(pitch), vertexIds: ['v3', 'v4', 'v5', 'v6'], orientation: 'north' },
      { id: 'f4', area: frontBackArea / 2, pitch, pitchDegrees: this.pitchToDegrees(pitch), vertexIds: ['v4', 'v1', 'v5'], orientation: 'west' },
    ];
    
    return {
      id,
      shape: 'simple_hip',
      expectedMeasurements: {
        totalAreaSqft: totalArea,
        ridgeLength,
        hipLength: hipLength * 4 * pitchMultiplier,
        valleyLength: 0,
        eaveLength: 2 * (length + width),
        rakeLength: 0,
        predominantPitch: pitch,
        facetCount: 4,
        tolerance: { area: 2, linear: 3 },
      },
      vertices,
      edges,
      facets,
      imageDescription: `Simple hip roof, ${width.toFixed(0)}' x ${length.toFixed(0)}', ${pitch} pitch`,
      difficulty: 'easy',
    };
  }

  private generateSimpleGable(
    id: string,
    width: number,
    length: number,
    pitch: string
  ): SyntheticRoof {
    const pitchMultiplier = this.pitchToMultiplier(pitch);
    const roofHeight = (width / 2) * Math.tan(this.pitchToRadians(pitch));
    const rakeLength = Math.sqrt(Math.pow(width / 2, 2) + Math.pow(roofHeight, 2));
    
    const sideArea = length * rakeLength;
    const totalArea = sideArea * 2;
    
    const vertices: Vertex[] = [
      { id: 'v1', x: 0, y: 0, z: 0, type: 'corner' },
      { id: 'v2', x: length, y: 0, z: 0, type: 'corner' },
      { id: 'v3', x: length, y: width, z: 0, type: 'corner' },
      { id: 'v4', x: 0, y: width, z: 0, type: 'corner' },
      { id: 'v5', x: 0, y: width / 2, z: roofHeight, type: 'gable_peak' },
      { id: 'v6', x: length, y: width / 2, z: roofHeight, type: 'gable_peak' },
    ];
    
    const edges: Edge[] = [
      { id: 'e1', type: 'eave', startVertexId: 'v1', endVertexId: 'v2', length: length },
      { id: 'e2', type: 'rake', startVertexId: 'v2', endVertexId: 'v6', length: rakeLength },
      { id: 'e3', type: 'rake', startVertexId: 'v6', endVertexId: 'v3', length: rakeLength },
      { id: 'e4', type: 'eave', startVertexId: 'v3', endVertexId: 'v4', length: length },
      { id: 'e5', type: 'rake', startVertexId: 'v4', endVertexId: 'v5', length: rakeLength },
      { id: 'e6', type: 'rake', startVertexId: 'v5', endVertexId: 'v1', length: rakeLength },
      { id: 'e7', type: 'ridge', startVertexId: 'v5', endVertexId: 'v6', length: length },
    ];
    
    const facets: Facet[] = [
      { id: 'f1', area: sideArea, pitch, pitchDegrees: this.pitchToDegrees(pitch), vertexIds: ['v1', 'v2', 'v6', 'v5'], orientation: 'south' },
      { id: 'f2', area: sideArea, pitch, pitchDegrees: this.pitchToDegrees(pitch), vertexIds: ['v5', 'v6', 'v3', 'v4'], orientation: 'north' },
    ];
    
    return {
      id,
      shape: 'simple_gable',
      expectedMeasurements: {
        totalAreaSqft: totalArea,
        ridgeLength: length,
        hipLength: 0,
        valleyLength: 0,
        eaveLength: length * 2,
        rakeLength: rakeLength * 4,
        predominantPitch: pitch,
        facetCount: 2,
        tolerance: { area: 2, linear: 3 },
      },
      vertices,
      edges,
      facets,
      imageDescription: `Simple gable roof, ${width.toFixed(0)}' x ${length.toFixed(0)}', ${pitch} pitch`,
      difficulty: 'easy',
    };
  }

  private generateCrossHip(
    id: string,
    width: number,
    length: number,
    pitch: string
  ): SyntheticRoof {
    // Simplified cross-hip calculation
    const mainArea = width * length * this.pitchToMultiplier(pitch);
    const crossArea = mainArea * 0.4;
    const totalArea = mainArea + crossArea;
    
    return {
      id,
      shape: 'cross_hip',
      expectedMeasurements: {
        totalAreaSqft: totalArea,
        ridgeLength: length * 0.6 + width * 0.3,
        hipLength: width * 1.5,
        valleyLength: width * 0.5,
        eaveLength: (length + width) * 2.5,
        rakeLength: 0,
        predominantPitch: pitch,
        facetCount: 8,
        tolerance: { area: 3, linear: 4 },
      },
      vertices: [],
      edges: [],
      facets: [],
      imageDescription: `Cross hip roof, ${width.toFixed(0)}' x ${length.toFixed(0)}' with cross section, ${pitch} pitch`,
      difficulty: 'medium',
    };
  }

  private generateLShape(
    id: string,
    width: number,
    length: number,
    pitch: string
  ): SyntheticRoof {
    const mainArea = width * length * 0.7 * this.pitchToMultiplier(pitch);
    const wingArea = width * 0.5 * length * 0.5 * this.pitchToMultiplier(pitch);
    const totalArea = mainArea + wingArea;
    
    return {
      id,
      shape: 'l_shape',
      expectedMeasurements: {
        totalAreaSqft: totalArea,
        ridgeLength: length * 0.5 + width * 0.3,
        hipLength: width * 1.2,
        valleyLength: width * 0.4,
        eaveLength: (length + width) * 2,
        rakeLength: 0,
        predominantPitch: pitch,
        facetCount: 6,
        tolerance: { area: 3, linear: 4 },
      },
      vertices: [],
      edges: [],
      facets: [],
      imageDescription: `L-shaped hip roof, ${width.toFixed(0)}' x ${length.toFixed(0)}', ${pitch} pitch`,
      difficulty: 'medium',
    };
  }

  private generateTShape(
    id: string,
    width: number,
    length: number,
    pitch: string
  ): SyntheticRoof {
    const mainArea = width * length * this.pitchToMultiplier(pitch);
    const wingArea = width * 0.4 * length * 0.3 * this.pitchToMultiplier(pitch);
    const totalArea = mainArea + wingArea;
    
    return {
      id,
      shape: 't_shape',
      expectedMeasurements: {
        totalAreaSqft: totalArea,
        ridgeLength: length * 0.6 + width * 0.2,
        hipLength: width * 1.4,
        valleyLength: width * 0.6,
        eaveLength: (length + width) * 2.2,
        rakeLength: 0,
        predominantPitch: pitch,
        facetCount: 8,
        tolerance: { area: 3, linear: 5 },
      },
      vertices: [],
      edges: [],
      facets: [],
      imageDescription: `T-shaped hip roof, ${width.toFixed(0)}' x ${length.toFixed(0)}', ${pitch} pitch`,
      difficulty: 'hard',
    };
  }

  // Utility methods
  private randomInRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  private randomPitch(): string {
    const pitches = ['4/12', '5/12', '6/12', '7/12', '8/12', '9/12', '10/12'];
    return pitches[Math.floor(Math.random() * pitches.length)];
  }

  private pitchToMultiplier(pitch: string): number {
    const [rise, run] = pitch.split('/').map(Number);
    const radians = Math.atan(rise / run);
    return 1 / Math.cos(radians);
  }

  private pitchToRadians(pitch: string): number {
    const [rise, run] = pitch.split('/').map(Number);
    return Math.atan(rise / run);
  }

  private pitchToDegrees(pitch: string): number {
    return this.pitchToRadians(pitch) * (180 / Math.PI);
  }
}

export default SyntheticRoofGenerator;

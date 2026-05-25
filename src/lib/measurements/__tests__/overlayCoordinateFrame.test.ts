import { describe, it, expect } from 'vitest';
import {
  resolveSourceRasterSize,
  classifyCoordinateSpace,
  computeDisplayTransform,
  projectPxPoint,
  detectFrameMismatch,
  hasDsmToRasterTransform,
} from '../overlayCoordinateFrame';

describe('overlayCoordinateFrame', () => {
  describe('resolveSourceRasterSize', () => {
    it('prefers overlay_debug.raster_size', () => {
      const r = resolveSourceRasterSize(
        {
          geometry_report_json: {
            overlay_debug: { raster_size: { width: 1280, height: 1280 } },
            raster_size: { width: 640, height: 640 },
          },
          analysis_image_size: { width: 800, height: 800 },
        },
        'https://maps.googleapis.com/maps/api/staticmap?size=640x640&scale=2',
      );
      expect(r).toEqual({ width: 1280, height: 1280, source: 'overlay_debug' });
    });

    it('falls back to URL parsing', () => {
      const r = resolveSourceRasterSize(
        {},
        'https://maps.googleapis.com/maps/api/staticmap?size=640x640&scale=2',
      );
      expect(r).toEqual({ width: 1280, height: 1280, source: 'parsed_from_url' });
    });

    it('falls back to image natural size', () => {
      const r = resolveSourceRasterSize({}, null, { width: 1024, height: 512 });
      expect(r).toEqual({ width: 1024, height: 512, source: 'image_natural' });
    });

    it('returns unresolved when no source available (no silent 800/1280 fallback)', () => {
      const r = resolveSourceRasterSize({}, null, null);
      expect(r.source).toBe('unresolved');
      expect(r.width).toBeNull();
      expect(r.height).toBeNull();
    });
  });

  describe('classifyCoordinateSpace', () => {
    it('classifies raster_px fields', () => {
      expect(classifyCoordinateSpace('debug_layers.raw_perimeter_px')).toBe('raster_px');
      expect(classifyCoordinateSpace('perimeter_topology.perimeter_ring_px')).toBe('raster_px');
      expect(classifyCoordinateSpace('aerial_candidate_roof_graph.perimeter_ring_px')).toBe('raster_px');
      expect(classifyCoordinateSpace('footprint_px')).toBe('raster_px');
    });

    it('classifies DSM-space fields', () => {
      expect(classifyCoordinateSpace('overlay_debug.edges_px')).toBe('dsm_px');
      expect(classifyCoordinateSpace('dsm_perimeter_px')).toBe('dsm_px');
    });
  });

  describe('computeDisplayTransform (contain)', () => {
    it('scales 1280 source into a 640x640 display correctly', () => {
      const t = computeDisplayTransform({
        sourceRasterSize: { width: 1280, height: 1280 },
        displayedImageSize: { width: 640, height: 640 },
      });
      expect(t.scaleX).toBeCloseTo(0.5);
      expect(t.scaleY).toBeCloseTo(0.5);
      expect(t.offsetX).toBeCloseTo(0);
      expect(t.offsetY).toBeCloseTo(0);
      const [px, py] = projectPxPoint([640, 640], t);
      expect(px).toBeCloseTo(320);
      expect(py).toBeCloseTo(320);
    });

    it('letterboxes a 1280x1280 source into a 900x600 display (contain)', () => {
      const t = computeDisplayTransform({
        sourceRasterSize: { width: 1280, height: 1280 },
        displayedImageSize: { width: 900, height: 600 },
      });
      // min(900/1280, 600/1280) = 600/1280 = 0.46875
      expect(t.scaleX).toBeCloseTo(0.46875);
      expect(t.scaleY).toBeCloseTo(0.46875);
      expect(t.offsetX).toBeCloseTo((900 - 1280 * 0.46875) / 2);
      expect(t.offsetY).toBeCloseTo(0);
      const [px, py] = projectPxPoint([640, 640], t);
      expect(px).toBeCloseTo(450); // display center x
      expect(py).toBeCloseTo(300); // display center y
    });

    it('returns unresolved transform for missing source size', () => {
      const t = computeDisplayTransform({
        sourceRasterSize: { width: null, height: null },
        displayedImageSize: { width: 800, height: 800 },
      });
      expect(t.resolved).toBe(false);
    });
  });

  describe('detectFrameMismatch', () => {
    it('passes when polygon center aligns with confirmed center', () => {
      const t = computeDisplayTransform({
        sourceRasterSize: { width: 1280, height: 1280 },
        displayedImageSize: { width: 640, height: 640 },
      });
      const r = detectFrameMismatch({
        perimeterPxSource: [
          [580, 550], [710, 550], [710, 702], [580, 702],
        ],
        confirmedCenterPxSource: [640, 640],
        sourceRasterSize: { width: 1280, height: 1280 },
        transform: t,
      });
      expect(r.mismatch).toBe(false);
    });

    it('flags mismatch when polygon is in a different quadrant', () => {
      const t = computeDisplayTransform({
        sourceRasterSize: { width: 800, height: 800 }, // wrong assumed size
        displayedImageSize: { width: 800, height: 800 },
      });
      const r = detectFrameMismatch({
        perimeterPxSource: [
          [580, 550], [710, 550], [710, 702], [580, 702],
        ],
        confirmedCenterPxSource: [400, 400], // center of an 800 frame
        sourceRasterSize: { width: 800, height: 800 },
        transform: t,
      });
      expect(r.mismatch).toBe(true);
    });
  });

  describe('hasDsmToRasterTransform', () => {
    it('returns false when not persisted', () => {
      expect(hasDsmToRasterTransform({})).toBe(false);
      expect(hasDsmToRasterTransform({ geometry_report_json: {} })).toBe(false);
    });
    it('returns true when persisted on overlay_debug', () => {
      expect(
        hasDsmToRasterTransform({
          geometry_report_json: { overlay_debug: { dsm_to_raster_transform: { a: 1 } } },
        }),
      ).toBe(true);
    });
  });
});

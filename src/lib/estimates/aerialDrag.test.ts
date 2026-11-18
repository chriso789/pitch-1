import { describe, it, expect } from 'vitest';
import { aerialDragToPanDelta } from './aerialDrag';

describe('aerialDragToPanDelta', () => {
  it('dragging the picture right moves the map center west', () => {
    const { dPanX, dPanY } = aerialDragToPanDelta({ dx: 100, dy: 0, displayWidth: 800, rotationDeg: 0, lat: 27 });
    expect(dPanX).toBeLessThan(0);
    expect(Math.abs(dPanY)).toBeLessThan(1e-9);
  });

  it('dragging the picture down moves the map center north', () => {
    const { dPanX, dPanY } = aerialDragToPanDelta({ dx: 0, dy: 100, displayWidth: 800, rotationDeg: 0, lat: 27 });
    expect(dPanY).toBeLessThan(0);
    expect(Math.abs(dPanX)).toBeLessThan(1e-9);
  });

  it('keeps the dragged point under the cursor: a full-width drag shifts the center one image width', () => {
    // 800 logical px at 256px/tile with 4 tiles per 100 pan units = 78.125 units
    const { dPanX } = aerialDragToPanDelta({ dx: 400, dy: 0, displayWidth: 400, rotationDeg: 0, lat: 0 });
    expect(dPanX).toBeCloseTo(-78.125, 5);
  });

  it('follows the rotated picture: at 90° a rightward drag moves the map vertically', () => {
    const { dPanX, dPanY } = aerialDragToPanDelta({ dx: 100, dy: 0, displayWidth: 800, rotationDeg: 90, lat: 0 });
    expect(Math.abs(dPanX)).toBeLessThan(1e-9);
    expect(dPanY).not.toBe(0);
  });
});

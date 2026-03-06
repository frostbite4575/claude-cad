import { describe, it, expect } from 'vitest';
import { setupOC, getBoundingBox } from './test-helpers.js';
import { createBox, createCylinder, createSphere, createPolygonExtrusion, revolveShape } from './primitives.js';
import { createSketchRectangle } from './sketches.js';

describe('primitives', () => {
  const getOC = setupOC();

  describe('createBox', () => {
    it('creates a box with correct dimensions', () => {
      const oc = getOC();
      const shape = createBox(oc, 4, 3, 2);
      const bb = getBoundingBox(oc, shape);
      expect(bb.width).toBeCloseTo(4, 4);
      expect(bb.height).toBeCloseTo(3, 4);
      expect(bb.depth).toBeCloseTo(2, 4);
    });

    it('creates a thin plate', () => {
      const oc = getOC();
      const shape = createBox(oc, 10, 10, 0.05);
      const bb = getBoundingBox(oc, shape);
      expect(bb.depth).toBeCloseTo(0.05, 4);
    });

    it('starts at origin', () => {
      const oc = getOC();
      const shape = createBox(oc, 2, 3, 4);
      const bb = getBoundingBox(oc, shape);
      expect(bb.xMin).toBeCloseTo(0, 4);
      expect(bb.yMin).toBeCloseTo(0, 4);
      expect(bb.zMin).toBeCloseTo(0, 4);
    });
  });

  describe('createCylinder', () => {
    it('creates a cylinder with correct bounding box', () => {
      const oc = getOC();
      const shape = createCylinder(oc, 2, 5);
      const bb = getBoundingBox(oc, shape);
      expect(bb.width).toBeCloseTo(4, 1); // diameter
      expect(bb.height).toBeCloseTo(4, 1);
      expect(bb.depth).toBeCloseTo(5, 1); // height
    });

    it('is centered at origin in XY', () => {
      const oc = getOC();
      const shape = createCylinder(oc, 3, 1);
      const bb = getBoundingBox(oc, shape);
      expect(bb.xMin).toBeCloseTo(-3, 1);
      expect(bb.xMax).toBeCloseTo(3, 1);
    });
  });

  describe('createSphere', () => {
    it('creates a sphere with correct bounding box', () => {
      const oc = getOC();
      const shape = createSphere(oc, 3);
      const bb = getBoundingBox(oc, shape);
      expect(bb.width).toBeCloseTo(6, 1);
      expect(bb.height).toBeCloseTo(6, 1);
      expect(bb.depth).toBeCloseTo(6, 1);
    });

    it('is centered at origin', () => {
      const oc = getOC();
      const shape = createSphere(oc, 2);
      const bb = getBoundingBox(oc, shape);
      expect(bb.xMin).toBeCloseTo(-2, 1);
      expect(bb.xMax).toBeCloseTo(2, 1);
    });
  });

  describe('createPolygonExtrusion', () => {
    it('creates a triangular prism', () => {
      const oc = getOC();
      const points: [number, number][] = [[0, 0], [4, 0], [2, 3]];
      const shape = createPolygonExtrusion(oc, points, 2);
      const bb = getBoundingBox(oc, shape);
      expect(bb.width).toBeCloseTo(4, 1);
      expect(bb.height).toBeCloseTo(3, 1);
      expect(bb.depth).toBeCloseTo(2, 1);
    });

    it('throws with fewer than 3 points', () => {
      const oc = getOC();
      expect(() => createPolygonExtrusion(oc, [[0, 0], [1, 1]], 1)).toThrow();
    });

    it('creates an L-shaped extrusion', () => {
      const oc = getOC();
      const points: [number, number][] = [
        [0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3],
      ];
      const shape = createPolygonExtrusion(oc, points, 1);
      const bb = getBoundingBox(oc, shape);
      expect(bb.width).toBeCloseTo(3, 1);
      expect(bb.height).toBeCloseTo(3, 1);
    });
  });

  describe('revolveShape', () => {
    it('creates a revolved solid from a sketch profile', () => {
      const oc = getOC();
      const face = createSketchRectangle(oc, 2, 0, 1, 1);
      const shape = revolveShape(oc, face, 0, 0, 0, 0, 1, 0, 360);
      const bb = getBoundingBox(oc, shape);
      // After full revolution around Y axis, shape should extend in X and Z
      expect(bb.width).toBeGreaterThan(2);
      expect(bb.depth).toBeGreaterThan(2);
    });
  });
});

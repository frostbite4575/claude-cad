import { describe, it, expect } from 'vitest';
import { setupOC, getBoundingBox } from './test-helpers.js';
import {
  createSketchLine,
  createSketchRectangle,
  createSketchCircle,
  createSketchArc,
  createFlatProfile,
  extrudeShape,
  transformToPlane,
} from './sketches.js';

describe('sketches', () => {
  const getOC = setupOC();

  describe('createSketchLine', () => {
    it('creates a line with correct bounding box', () => {
      const oc = getOC();
      const shape = createSketchLine(oc, 0, 0, 5, 0);
      const bb = getBoundingBox(oc, shape);
      expect(bb.width).toBeCloseTo(5, 1);
      expect(bb.height).toBeCloseTo(0, 1);
    });

    it('creates a diagonal line', () => {
      const oc = getOC();
      const shape = createSketchLine(oc, 0, 0, 3, 4);
      const bb = getBoundingBox(oc, shape);
      expect(bb.width).toBeCloseTo(3, 1);
      expect(bb.height).toBeCloseTo(4, 1);
    });
  });

  describe('createSketchRectangle', () => {
    it('creates a rectangle with correct dimensions', () => {
      const oc = getOC();
      const shape = createSketchRectangle(oc, 0, 0, 5, 3);
      const bb = getBoundingBox(oc, shape);
      expect(bb.width).toBeCloseTo(5, 1);
      expect(bb.height).toBeCloseTo(3, 1);
    });

    it('creates at offset position', () => {
      const oc = getOC();
      const shape = createSketchRectangle(oc, 2, 3, 4, 5);
      const bb = getBoundingBox(oc, shape);
      expect(bb.xMin).toBeCloseTo(2, 1);
      expect(bb.yMin).toBeCloseTo(3, 1);
    });

    it('can be extruded into a solid', () => {
      const oc = getOC();
      const face = createSketchRectangle(oc, 0, 0, 3, 4);
      const solid = extrudeShape(oc, face, 2);
      const bb = getBoundingBox(oc, solid);
      expect(bb.width).toBeCloseTo(3, 1);
      expect(bb.height).toBeCloseTo(4, 1);
      expect(bb.depth).toBeCloseTo(2, 1);
    });
  });

  describe('createSketchCircle', () => {
    it('creates a circle with correct diameter', () => {
      const oc = getOC();
      const shape = createSketchCircle(oc, 5, 5, 3);
      const bb = getBoundingBox(oc, shape);
      expect(bb.width).toBeCloseTo(6, 1);
      expect(bb.height).toBeCloseTo(6, 1);
    });

    it('can be extruded into a cylinder', () => {
      const oc = getOC();
      const face = createSketchCircle(oc, 0, 0, 2);
      const solid = extrudeShape(oc, face, 5);
      const bb = getBoundingBox(oc, solid);
      expect(bb.width).toBeCloseTo(4, 1); // diameter
      expect(bb.depth).toBeCloseTo(5, 1); // height
    });
  });

  describe('createSketchArc', () => {
    it('creates an arc with correct bounding box', () => {
      const oc = getOC();
      const shape = createSketchArc(oc, 0, 0, 3, 0, 90);
      const bb = getBoundingBox(oc, shape);
      expect(bb.width).toBeCloseTo(3, 1);
      expect(bb.height).toBeCloseTo(3, 1);
    });
  });

  describe('createFlatProfile', () => {
    it('creates a triangular profile', () => {
      const oc = getOC();
      const points = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 3 }];
      const shape = createFlatProfile(oc, points);
      const bb = getBoundingBox(oc, shape);
      expect(bb.width).toBeCloseTo(4, 1);
      expect(bb.height).toBeCloseTo(3, 1);
    });

    it('throws with fewer than 3 points', () => {
      const oc = getOC();
      expect(() => createFlatProfile(oc, [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toThrow();
    });

    it('can be extruded', () => {
      const oc = getOC();
      const points = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }];
      const face = createFlatProfile(oc, points);
      const solid = extrudeShape(oc, face, 2);
      const bb = getBoundingBox(oc, solid);
      expect(bb.width).toBeCloseTo(4, 1);
      expect(bb.height).toBeCloseTo(3, 1);
      expect(bb.depth).toBeCloseTo(2, 1);
    });
  });

  describe('extrudeShape', () => {
    it('extrudes along Z by default', () => {
      const oc = getOC();
      const face = createSketchRectangle(oc, 0, 0, 2, 3);
      const solid = extrudeShape(oc, face, 5);
      const bb = getBoundingBox(oc, solid);
      expect(bb.depth).toBeCloseTo(5, 1);
    });

    it('extrudes along custom direction', () => {
      const oc = getOC();
      const face = createSketchRectangle(oc, 0, 0, 2, 2);
      const solid = extrudeShape(oc, face, 3, 1, 0, 0); // along X
      const bb = getBoundingBox(oc, solid);
      expect(bb.width).toBeCloseTo(5, 1); // 2 (face width) + 3 (extrusion along X)
    });

    it('throws on zero direction', () => {
      const oc = getOC();
      const face = createSketchRectangle(oc, 0, 0, 2, 2);
      expect(() => extrudeShape(oc, face, 5, 0, 0, 0)).toThrow();
    });
  });

  describe('transformToPlane', () => {
    it('XY is identity', () => {
      const oc = getOC();
      const face = createSketchRectangle(oc, 0, 0, 2, 3);
      const result = transformToPlane(oc, face, 'XY');
      expect(result).toBe(face);
    });

    it('XZ transforms Y to Z', () => {
      const oc = getOC();
      const face = createSketchRectangle(oc, 0, 0, 2, 3);
      const result = transformToPlane(oc, face, 'XZ');
      const bb = getBoundingBox(oc, result);
      expect(bb.width).toBeCloseTo(2, 1);
      expect(bb.depth).toBeCloseTo(3, 1);
    });
  });
});

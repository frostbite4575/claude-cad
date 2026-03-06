import { describe, it, expect } from 'vitest';
import { setupOC, getBoundingBox } from './test-helpers.js';
import { createBox, createCylinder } from './primitives.js';
import { translateShape } from './transforms.js';
import { booleanUnion, booleanSubtract, booleanIntersect } from './booleans.js';

describe('booleans', () => {
  const getOC = setupOC();

  describe('booleanUnion', () => {
    it('fuses two overlapping boxes', () => {
      const oc = getOC();
      const box1 = createBox(oc, 2, 2, 2);
      const box2Raw = createBox(oc, 2, 2, 2);
      const box2 = translateShape(oc, box2Raw, 1, 0, 0);
      const result = booleanUnion(oc, box1, box2);
      const bb = getBoundingBox(oc, result);
      expect(bb.width).toBeCloseTo(3, 1);
      expect(bb.height).toBeCloseTo(2, 1);
      expect(bb.depth).toBeCloseTo(2, 1);
    });

    it('throws on null shapes', () => {
      const oc = getOC();
      const box = createBox(oc, 1, 1, 1);
      expect(() => booleanUnion(oc, box, null)).toThrow();
      expect(() => booleanUnion(oc, null, box)).toThrow();
    });
  });

  describe('booleanSubtract', () => {
    it('removes material from a box', () => {
      const oc = getOC();
      const box = createBox(oc, 4, 4, 1);
      const cyl = createCylinder(oc, 0.5, 2);
      const positioned = translateShape(oc, cyl, 2, 2, -0.5);
      const result = booleanSubtract(oc, box, positioned);
      const bb = getBoundingBox(oc, result);
      // Bounding box should still be 4x4x1 (hole doesn't change outer bounds)
      expect(bb.width).toBeCloseTo(4, 1);
      expect(bb.height).toBeCloseTo(4, 1);
      expect(bb.depth).toBeCloseTo(1, 1);
    });

    it('throws on null shapes', () => {
      const oc = getOC();
      const box = createBox(oc, 1, 1, 1);
      expect(() => booleanSubtract(oc, box, null)).toThrow();
    });
  });

  describe('booleanIntersect', () => {
    it('keeps only overlapping region', () => {
      const oc = getOC();
      const box1 = createBox(oc, 2, 2, 2);
      const box2Raw = createBox(oc, 2, 2, 2);
      const box2 = translateShape(oc, box2Raw, 1, 1, 0);
      const result = booleanIntersect(oc, box1, box2);
      const bb = getBoundingBox(oc, result);
      // Intersection should be 1x1x2
      expect(bb.width).toBeCloseTo(1, 1);
      expect(bb.height).toBeCloseTo(1, 1);
      expect(bb.depth).toBeCloseTo(2, 1);
    });

    it('throws on null shapes', () => {
      const oc = getOC();
      const box = createBox(oc, 1, 1, 1);
      expect(() => booleanIntersect(oc, null, box)).toThrow();
    });
  });
});

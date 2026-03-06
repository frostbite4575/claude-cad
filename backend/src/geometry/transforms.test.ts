import { describe, it, expect } from 'vitest';
import { setupOC, getBoundingBox } from './test-helpers.js';
import { createBox } from './primitives.js';
import {
  translateShape,
  rotateShape,
  mirrorShape,
  scaleShape,
  linearPatternCopies,
  circularPatternCopies,
} from './transforms.js';

describe('transforms', () => {
  const getOC = setupOC();

  describe('translateShape', () => {
    it('moves a box by offset', () => {
      const oc = getOC();
      const box = createBox(oc, 2, 2, 2);
      const moved = translateShape(oc, box, 5, 3, 1);
      const bb = getBoundingBox(oc, moved);
      expect(bb.xMin).toBeCloseTo(5, 1);
      expect(bb.yMin).toBeCloseTo(3, 1);
      expect(bb.zMin).toBeCloseTo(1, 1);
    });

    it('preserves dimensions', () => {
      const oc = getOC();
      const box = createBox(oc, 3, 4, 5);
      const moved = translateShape(oc, box, 10, 20, 30);
      const bb = getBoundingBox(oc, moved);
      expect(bb.width).toBeCloseTo(3, 1);
      expect(bb.height).toBeCloseTo(4, 1);
      expect(bb.depth).toBeCloseTo(5, 1);
    });
  });

  describe('rotateShape', () => {
    it('rotates 90° around Z axis', () => {
      const oc = getOC();
      const box = createBox(oc, 4, 1, 1); // long along X
      const rotated = rotateShape(oc, box, 0, 0, 1, 90);
      const bb = getBoundingBox(oc, rotated);
      // After 90° Z rotation, X and Y swap
      expect(bb.width).toBeCloseTo(1, 0);
      expect(bb.height).toBeCloseTo(4, 0);
    });

    it('preserves bounding box size for 180°', () => {
      const oc = getOC();
      const box = createBox(oc, 2, 3, 4);
      const rotated = rotateShape(oc, box, 0, 0, 1, 180);
      const bb = getBoundingBox(oc, rotated);
      expect(bb.width).toBeCloseTo(2, 1);
      expect(bb.height).toBeCloseTo(3, 1);
      expect(bb.depth).toBeCloseTo(4, 1);
    });
  });

  describe('mirrorShape', () => {
    it('mirrors across YZ plane', () => {
      const oc = getOC();
      const box = createBox(oc, 2, 2, 2);
      const mirrored = mirrorShape(oc, box, 'YZ', 0);
      const bb = getBoundingBox(oc, mirrored);
      expect(bb.xMax).toBeCloseTo(0, 1);
      expect(bb.xMin).toBeCloseTo(-2, 1);
    });

    it('mirrors with offset', () => {
      const oc = getOC();
      const box = createBox(oc, 1, 1, 1);
      const mirrored = mirrorShape(oc, box, 'YZ', 5);
      const bb = getBoundingBox(oc, mirrored);
      expect(bb.xMin).toBeCloseTo(9, 1);
      expect(bb.xMax).toBeCloseTo(10, 1);
    });

    it('preserves dimensions', () => {
      const oc = getOC();
      const box = createBox(oc, 2, 3, 4);
      const mirrored = mirrorShape(oc, box, 'XZ');
      const bb = getBoundingBox(oc, mirrored);
      expect(bb.width).toBeCloseTo(2, 1);
      expect(bb.height).toBeCloseTo(3, 1);
      expect(bb.depth).toBeCloseTo(4, 1);
    });
  });

  describe('scaleShape', () => {
    it('doubles size', () => {
      const oc = getOC();
      const box = createBox(oc, 1, 1, 1);
      const scaled = scaleShape(oc, box, 2);
      const bb = getBoundingBox(oc, scaled);
      expect(bb.width).toBeCloseTo(2, 1);
      expect(bb.height).toBeCloseTo(2, 1);
      expect(bb.depth).toBeCloseTo(2, 1);
    });

    it('halves size', () => {
      const oc = getOC();
      const box = createBox(oc, 4, 4, 4);
      const scaled = scaleShape(oc, box, 0.5);
      const bb = getBoundingBox(oc, scaled);
      expect(bb.width).toBeCloseTo(2, 1);
      expect(bb.height).toBeCloseTo(2, 1);
      expect(bb.depth).toBeCloseTo(2, 1);
    });
  });

  describe('linearPatternCopies', () => {
    it('creates correct number of copies', () => {
      const oc = getOC();
      const box = createBox(oc, 1, 1, 1);
      const copies = linearPatternCopies(oc, box, 3, 2, 0, 0);
      expect(copies).toHaveLength(3);
    });

    it('spaces copies correctly', () => {
      const oc = getOC();
      const box = createBox(oc, 1, 1, 1);
      const copies = linearPatternCopies(oc, box, 2, 5, 0, 0);
      const bb1 = getBoundingBox(oc, copies[0]);
      const bb2 = getBoundingBox(oc, copies[1]);
      expect(bb1.xMin).toBeCloseTo(5, 1); // first copy offset by 1*5
      expect(bb2.xMin).toBeCloseTo(10, 1); // second by 2*5
    });
  });

  describe('circularPatternCopies', () => {
    it('creates correct number of copies', () => {
      const oc = getOC();
      const box = createBox(oc, 1, 1, 1);
      const copies = circularPatternCopies(oc, box, 5, 0, 0, 0, 0, 0, 1, 360);
      expect(copies).toHaveLength(5);
    });

    it('preserves dimensions in copies', () => {
      const oc = getOC();
      const box = createBox(oc, 1, 1, 1);
      const copies = circularPatternCopies(oc, box, 3, 0, 0, 0, 0, 0, 1, 360);
      for (const copy of copies) {
        const bb = getBoundingBox(oc, copy);
        expect(bb.width).toBeCloseTo(1, 1);
        expect(bb.height).toBeCloseTo(1, 1);
        expect(bb.depth).toBeCloseTo(1, 1);
      }
    });
  });
});

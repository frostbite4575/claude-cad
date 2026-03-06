import { initOC, type OpenCascadeInstance } from './oc-init.js';
import { beforeAll } from 'vitest';

let oc: OpenCascadeInstance;

/**
 * Shared WASM init for geometry tests. Call in a describe() block.
 * Returns a getter function for the OC instance.
 */
export function setupOC(): () => OpenCascadeInstance {
  beforeAll(async () => {
    oc = await initOC();
  }, 30_000); // WASM init can take a while

  return () => {
    if (!oc) throw new Error('OC not initialized — did beforeAll run?');
    return oc;
  };
}

/**
 * Get bounding box dimensions of a shape.
 */
export function getBoundingBox(oc: OpenCascadeInstance, shape: any) {
  const bbox = new oc.Bnd_Box_1();
  oc.BRepBndLib.Add(shape, bbox, false);
  const min = bbox.CornerMin();
  const max = bbox.CornerMax();
  const result = {
    xMin: min.X(), yMin: min.Y(), zMin: min.Z(),
    xMax: max.X(), yMax: max.Y(), zMax: max.Z(),
    width: max.X() - min.X(),
    height: max.Y() - min.Y(),
    depth: max.Z() - min.Z(),
  };
  min.delete(); max.delete(); bbox.delete();
  return result;
}

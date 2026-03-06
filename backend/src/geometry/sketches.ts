import type { OpenCascadeInstance } from './oc-init.js';
import { withCleanup, DisposableCollector } from './oc-cleanup.js';

export type SketchPlane = 'XY' | 'XZ' | 'YZ';

/**
 * Transform a shape created on XY plane to another plane.
 * XY: no-op. XZ: rotate -90° around X. YZ: rotate 90° around Z then -90° around X.
 */
export function transformToPlane(oc: OpenCascadeInstance, shape: any, plane: SketchPlane): any {
  if (plane === 'XY') return shape;

  const trsf = new oc.gp_Trsf_1();

  if (plane === 'XZ') {
    const origin = new oc.gp_Pnt_3(0, 0, 0);
    const dir = new oc.gp_Dir_4(1, 0, 0);
    const ax = new oc.gp_Ax1_2(origin, dir);
    trsf.SetRotation_1(ax, -Math.PI / 2);
    try { ax.delete(); } catch {}
    try { origin.delete(); } catch {}
    try { dir.delete(); } catch {}
  } else if (plane === 'YZ') {
    const origin = new oc.gp_Pnt_3(0, 0, 0);
    const dir = new oc.gp_Dir_4(0, 1, 0);
    const ax = new oc.gp_Ax1_2(origin, dir);
    trsf.SetRotation_1(ax, Math.PI / 2);
    try { ax.delete(); } catch {}
    try { origin.delete(); } catch {}
    try { dir.delete(); } catch {}
  }

  const transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
  return withCleanup([transformer, trsf], () => transformer.Shape());
}

/**
 * Create a line edge (open geometry — cannot be extruded).
 */
export function createSketchLine(
  oc: OpenCascadeInstance,
  x1: number, y1: number,
  x2: number, y2: number,
  z: number = 0
): any {
  const p1 = new oc.gp_Pnt_3(x1, y1, z);
  const p2 = new oc.gp_Pnt_3(x2, y2, z);
  const edgeMaker = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
  return withCleanup([edgeMaker, p1, p2], () => edgeMaker.Edge());
}

/**
 * Create a rectangular face (closed — can be extruded).
 * (x, y) is the corner, width along X, height along Y.
 */
export function createSketchRectangle(
  oc: OpenCascadeInstance,
  x: number, y: number,
  width: number, height: number,
  z: number = 0
): any {
  const gc = new DisposableCollector();
  try {
    const corners = [
      gc.track(new oc.gp_Pnt_3(x, y, z)),
      gc.track(new oc.gp_Pnt_3(x + width, y, z)),
      gc.track(new oc.gp_Pnt_3(x + width, y + height, z)),
      gc.track(new oc.gp_Pnt_3(x, y + height, z)),
    ];

    const edges: any[] = [];
    for (let i = 0; i < 4; i++) {
      const next = (i + 1) % 4;
      const edgeMaker = gc.track(new oc.BRepBuilderAPI_MakeEdge_3(corners[i], corners[next]));
      edges.push(edgeMaker.Edge());
    }

    const wireBuilder = gc.track(new oc.BRepBuilderAPI_MakeWire_1());
    for (const edge of edges) {
      wireBuilder.Add_1(edge);
    }
    const wire = wireBuilder.Wire();

    const faceMaker = gc.track(new oc.BRepBuilderAPI_MakeFace_15(wire, true));
    const face = faceMaker.Shape();

    // Clean up intermediate shapes not tracked by gc
    for (const e of edges) try { e.delete(); } catch {}
    try { wire.delete(); } catch {}

    return face;
  } finally {
    gc.cleanup();
  }
}

/**
 * Create a circular face (closed — can be extruded).
 */
export function createSketchCircle(
  oc: OpenCascadeInstance,
  centerX: number, centerY: number,
  radius: number,
  z: number = 0
): any {
  const center = new oc.gp_Pnt_3(centerX, centerY, z);
  const dir = new oc.gp_Dir_4(0, 0, 1);
  const ax2 = new oc.gp_Ax2_3(center, dir);
  const circ = new oc.gp_Circ_2(ax2, radius);
  const edgeMaker = new oc.BRepBuilderAPI_MakeEdge_8(circ);
  const edge = edgeMaker.Edge();
  const wireBuilder = new oc.BRepBuilderAPI_MakeWire_2(edge);
  const wire = wireBuilder.Wire();
  const faceMaker = new oc.BRepBuilderAPI_MakeFace_15(wire, true);

  try {
    return faceMaker.Shape();
  } finally {
    try { faceMaker.delete(); } catch {}
    try { wire.delete(); } catch {}
    try { wireBuilder.delete(); } catch {}
    try { edge.delete(); } catch {}
    try { edgeMaker.delete(); } catch {}
    try { circ.delete(); } catch {}
    try { ax2.delete(); } catch {}
    try { dir.delete(); } catch {}
    try { center.delete(); } catch {}
  }
}

/**
 * Create an arc edge (open geometry — cannot be extruded).
 * Angles in degrees, converted to radians internally.
 */
export function createSketchArc(
  oc: OpenCascadeInstance,
  centerX: number, centerY: number,
  radius: number,
  startAngleDeg: number, endAngleDeg: number,
  z: number = 0
): any {
  const center = new oc.gp_Pnt_3(centerX, centerY, z);
  const dir = new oc.gp_Dir_4(0, 0, 1);
  const ax2 = new oc.gp_Ax2_3(center, dir);
  const circ = new oc.gp_Circ_2(ax2, radius);

  const startRad = (startAngleDeg * Math.PI) / 180;
  const endRad = (endAngleDeg * Math.PI) / 180;

  const edgeMaker = new oc.BRepBuilderAPI_MakeEdge_9(circ, startRad, endRad);
  return withCleanup([edgeMaker, circ, ax2, dir, center], () => edgeMaker.Edge());
}

/**
 * Create a closed 2D profile (face) from an array of {x, y} points.
 * Connects points in order, closes the loop, and makes a face.
 * Minimum 3 points required.
 */
export function createFlatProfile(
  oc: OpenCascadeInstance,
  points: { x: number; y: number }[],
  z: number = 0
): any {
  if (points.length < 3) {
    throw new Error('Flat profile requires at least 3 points');
  }

  const gc = new DisposableCollector();
  try {
    const ocPoints = points.map(p => gc.track(new oc.gp_Pnt_3(p.x, p.y, z)));

    const edges: any[] = [];
    for (let i = 0; i < ocPoints.length; i++) {
      const next = (i + 1) % ocPoints.length;
      const edgeMaker = gc.track(new oc.BRepBuilderAPI_MakeEdge_3(ocPoints[i], ocPoints[next]));
      edges.push(edgeMaker.Edge());
    }

    const wireBuilder = gc.track(new oc.BRepBuilderAPI_MakeWire_1());
    for (const edge of edges) {
      wireBuilder.Add_1(edge);
    }
    const wire = wireBuilder.Wire();

    const faceMaker = gc.track(new oc.BRepBuilderAPI_MakeFace_15(wire, true));
    const face = faceMaker.Shape();

    // Clean up intermediate shapes not tracked by gc
    for (const e of edges) try { e.delete(); } catch {}
    try { wire.delete(); } catch {}

    return face;
  } finally {
    gc.cleanup();
  }
}

/**
 * Extrude a face (sketch) into a 3D solid along a direction vector.
 * Default direction is Z-up.
 */
export function extrudeShape(
  oc: OpenCascadeInstance,
  shape: any,
  height: number,
  dirX: number = 0, dirY: number = 0, dirZ: number = 1
): any {
  // Normalize direction and scale by height
  const len = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);
  if (len === 0) throw new Error('Extrusion direction cannot be zero');
  const vec = new oc.gp_Vec_4(
    (dirX / len) * height,
    (dirY / len) * height,
    (dirZ / len) * height
  );

  const prism = new oc.BRepPrimAPI_MakePrism_1(shape, vec, false, true);
  return withCleanup([prism, vec], () => prism.Shape());
}

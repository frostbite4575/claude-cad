import type { OpenCascadeInstance } from './oc-init.js';

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
  const edge = edgeMaker.Edge();
  edgeMaker.delete();
  p1.delete();
  p2.delete();
  return edge;
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
  const corners = [
    new oc.gp_Pnt_3(x, y, z),
    new oc.gp_Pnt_3(x + width, y, z),
    new oc.gp_Pnt_3(x + width, y + height, z),
    new oc.gp_Pnt_3(x, y + height, z),
  ];

  const edges: any[] = [];
  for (let i = 0; i < 4; i++) {
    const next = (i + 1) % 4;
    const edgeMaker = new oc.BRepBuilderAPI_MakeEdge_3(corners[i], corners[next]);
    edges.push(edgeMaker.Edge());
    edgeMaker.delete();
  }

  const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();
  for (const edge of edges) {
    wireBuilder.Add_1(edge);
  }
  const wire = wireBuilder.Wire();

  const faceMaker = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
  const face = faceMaker.Shape();

  // Cleanup
  faceMaker.delete();
  wire.delete();
  wireBuilder.delete();
  for (const e of edges) e.delete();
  for (const c of corners) c.delete();

  return face;
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
  const face = faceMaker.Shape();

  // Cleanup
  faceMaker.delete();
  wire.delete();
  wireBuilder.delete();
  edge.delete();
  edgeMaker.delete();
  circ.delete();
  ax2.delete();
  dir.delete();
  center.delete();

  return face;
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
  const edge = edgeMaker.Edge();

  edgeMaker.delete();
  circ.delete();
  ax2.delete();
  dir.delete();
  center.delete();

  return edge;
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

  const ocPoints = points.map(p => new oc.gp_Pnt_3(p.x, p.y, z));

  const edges: any[] = [];
  for (let i = 0; i < ocPoints.length; i++) {
    const next = (i + 1) % ocPoints.length;
    const edgeMaker = new oc.BRepBuilderAPI_MakeEdge_3(ocPoints[i], ocPoints[next]);
    edges.push(edgeMaker.Edge());
    edgeMaker.delete();
  }

  const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();
  for (const edge of edges) {
    wireBuilder.Add_1(edge);
  }
  const wire = wireBuilder.Wire();

  const faceMaker = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
  const face = faceMaker.Shape();

  // Cleanup
  faceMaker.delete();
  wire.delete();
  wireBuilder.delete();
  for (const e of edges) e.delete();
  for (const c of ocPoints) c.delete();

  return face;
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
  const solid = prism.Shape();

  prism.delete();
  vec.delete();

  return solid;
}

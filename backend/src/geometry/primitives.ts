import type { OpenCascadeInstance } from './oc-init.js';

export function createBox(oc: OpenCascadeInstance, width: number, height: number, depth: number): any {
  const maker = new oc.BRepPrimAPI_MakeBox_1(width, height, depth);
  const shape = maker.Shape();
  maker.delete();
  return shape;
}

export function createCylinder(oc: OpenCascadeInstance, radius: number, height: number): any {
  const maker = new oc.BRepPrimAPI_MakeCylinder_1(radius, height);
  const shape = maker.Shape();
  maker.delete();
  return shape;
}

export function createSphere(oc: OpenCascadeInstance, radius: number): any {
  const maker = new oc.BRepPrimAPI_MakeSphere_1(radius);
  const shape = maker.Shape();
  maker.delete();
  return shape;
}

/**
 * Create an extruded solid from a 2D polygon defined by points.
 * Points are [x, y] pairs on the XY plane. The shape is extruded along Z by `height`.
 */
export function createPolygonExtrusion(
  oc: OpenCascadeInstance,
  points: [number, number][],
  height: number
): any {
  if (points.length < 3) throw new Error('Polygon needs at least 3 points');

  // Build edges between consecutive points
  const edges: any[] = [];
  const ocPoints: any[] = [];
  for (const [x, y] of points) {
    ocPoints.push(new oc.gp_Pnt_3(x, y, 0));
  }

  for (let i = 0; i < ocPoints.length; i++) {
    const next = (i + 1) % ocPoints.length;
    const edgeMaker = new oc.BRepBuilderAPI_MakeEdge_3(ocPoints[i], ocPoints[next]);
    edges.push(edgeMaker.Edge());
    edgeMaker.delete();
  }

  // Build wire from edges
  const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();
  for (const edge of edges) {
    wireBuilder.Add_1(edge);
  }
  const wire = wireBuilder.Wire();

  // Make face from wire
  const faceMaker = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
  const face = faceMaker.Shape();

  // Extrude along Z
  const dir = new oc.gp_Vec_4(0, 0, height);
  const prism = new oc.BRepPrimAPI_MakePrism_1(face, dir, false, true);
  const solid = prism.Shape();

  // Cleanup
  prism.delete();
  dir.delete();
  face.delete();
  faceMaker.delete();
  wire.delete();
  wireBuilder.delete();
  for (const e of edges) e.delete();
  for (const p of ocPoints) p.delete();

  return solid;
}

/**
 * Revolve a shape (sketch face or solid) around an axis.
 * axisPoint: point on the axis, axisDir: direction of the axis.
 * angleDeg: angle of revolution in degrees (360 = full revolution).
 */
export function revolveShape(
  oc: OpenCascadeInstance,
  shape: any,
  axisPointX: number, axisPointY: number, axisPointZ: number,
  axisDirX: number, axisDirY: number, axisDirZ: number,
  angleDeg: number
): any {
  const pnt = new oc.gp_Pnt_3(axisPointX, axisPointY, axisPointZ);
  const dir = new oc.gp_Dir_4(axisDirX, axisDirY, axisDirZ);
  const axis = new oc.gp_Ax1_2(pnt, dir);

  const angleRad = (angleDeg * Math.PI) / 180;
  const revol = new oc.BRepPrimAPI_MakeRevol_1(shape, axis, angleRad, true);
  const result = revol.Shape();

  revol.delete();
  axis.delete();
  dir.delete();
  pnt.delete();

  return result;
}

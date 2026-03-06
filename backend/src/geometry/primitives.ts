import type { OpenCascadeInstance } from './oc-init.js';
import { withCleanup, DisposableCollector } from './oc-cleanup.js';

export function createBox(oc: OpenCascadeInstance, width: number, height: number, depth: number): any {
  const maker = new oc.BRepPrimAPI_MakeBox_1(width, height, depth);
  return withCleanup([maker], () => maker.Shape());
}

export function createCylinder(oc: OpenCascadeInstance, radius: number, height: number): any {
  const maker = new oc.BRepPrimAPI_MakeCylinder_1(radius, height);
  return withCleanup([maker], () => maker.Shape());
}

export function createSphere(oc: OpenCascadeInstance, radius: number): any {
  const maker = new oc.BRepPrimAPI_MakeSphere_1(radius);
  return withCleanup([maker], () => maker.Shape());
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

  const gc = new DisposableCollector();
  try {
    const ocPoints = points.map(([x, y]) => gc.track(new oc.gp_Pnt_3(x, y, 0)));

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

    const dir = gc.track(new oc.gp_Vec_4(0, 0, height));
    const prism = gc.track(new oc.BRepPrimAPI_MakePrism_1(face, dir, false, true));
    const solid = prism.Shape();

    // Clean up intermediate shapes that aren't tracked by gc
    for (const e of edges) try { e.delete(); } catch {}
    try { wire.delete(); } catch {}
    try { face.delete(); } catch {}

    return solid;
  } finally {
    gc.cleanup();
  }
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

  return withCleanup([revol, axis, dir, pnt], () => revol.Shape());
}

import type { OpenCascadeInstance } from './oc-init.js';

export type EdgeFilter = 'all' | 'vertical' | 'horizontal' | 'top' | 'bottom';

/**
 * Collect edges from a shape, optionally filtered by orientation.
 * - 'all': every edge
 * - 'vertical': edges primarily along Z axis
 * - 'horizontal': edges primarily in XY plane
 * - 'top': edges near the max-Z bounding box face
 * - 'bottom': edges near the min-Z bounding box face
 * - indices: specific 0-based edge indices
 */
function collectEdges(
  oc: OpenCascadeInstance,
  shape: any,
  filter: EdgeFilter = 'all',
  indices?: number[]
): any[] {
  const edges: any[] = [];
  const explorer = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);

  // If filtering by top/bottom, compute bounding box first
  let zMin = 0, zMax = 0;
  if (filter === 'top' || filter === 'bottom') {
    const bbox = new oc.Bnd_Box_1();
    oc.BRepBndLib.Add(shape, bbox, false);
    const bMin = bbox.CornerMin();
    const bMax = bbox.CornerMax();
    zMin = bMin.Z();
    zMax = bMax.Z();
    bMin.delete(); bMax.delete(); bbox.delete();
  }

  const tolerance = 0.01; // inches — edge-midpoint must be within this of face
  let idx = 0;

  try {
    while (explorer.More()) {
      const edge = oc.TopoDS.Edge_1(explorer.Current());

      if (indices) {
        // Filter by specific indices
        if (indices.includes(idx)) {
          edges.push(edge);
        }
      } else if (filter === 'all') {
        edges.push(edge);
      } else {
        // Get edge midpoint direction
        const adaptor = new oc.BRepAdaptor_Curve_2(edge);
        const first = adaptor.FirstParameter();
        const last = adaptor.LastParameter();
        const p0 = adaptor.Value(first);
        const p1 = adaptor.Value(last);
        const mid = adaptor.Value((first + last) / 2);

        const dx = Math.abs(p1.X() - p0.X());
        const dy = Math.abs(p1.Y() - p0.Y());
        const dz = Math.abs(p1.Z() - p0.Z());
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

        let include = false;
        if (filter === 'vertical' && len > tolerance) {
          include = (dz / len) > 0.8; // primarily Z-aligned
        } else if (filter === 'horizontal' && len > tolerance) {
          include = (dz / len) < 0.2; // primarily in XY
        } else if (filter === 'top') {
          include = Math.abs(mid.Z() - zMax) < tolerance;
        } else if (filter === 'bottom') {
          include = Math.abs(mid.Z() - zMin) < tolerance;
        }

        if (include) edges.push(edge);

        p0.delete(); p1.delete(); mid.delete();
        adaptor.delete();
      }

      idx++;
      explorer.Next();
    }
  } finally {
    explorer.delete();
  }

  return edges;
}

/** Count total edges on a shape */
export function countEdges(oc: OpenCascadeInstance, shape: any): number {
  const explorer = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  let count = 0;
  while (explorer.More()) { count++; explorer.Next(); }
  explorer.delete();
  return count;
}

export function filletAllEdges(oc: OpenCascadeInstance, shape: any, radius: number): any {
  return filletEdges(oc, shape, radius, 'all');
}

export function filletEdges(
  oc: OpenCascadeInstance,
  shape: any,
  radius: number,
  filter: EdgeFilter = 'all',
  indices?: number[]
): any {
  const edges = collectEdges(oc, shape, filter, indices);
  if (edges.length === 0) {
    throw new Error(`No edges match filter '${filter}'${indices ? ` indices [${indices.join(',')}]` : ''}`);
  }

  const filletShape = (oc as any).ChFi3d_FilletShape.ChFi3d_Rational;
  const fillet = new (oc as any).BRepFilletAPI_MakeFillet(shape, filletShape);

  try {
    for (const edge of edges) {
      fillet.Add_2(radius, edge);
    }
    return fillet.Shape();
  } finally {
    fillet.delete();
  }
}

export function chamferAllEdges(oc: OpenCascadeInstance, shape: any, distance: number): any {
  return chamferEdges(oc, shape, distance, 'all');
}

export function chamferEdges(
  oc: OpenCascadeInstance,
  shape: any,
  distance: number,
  filter: EdgeFilter = 'all',
  indices?: number[]
): any {
  const edges = collectEdges(oc, shape, filter, indices);
  if (edges.length === 0) {
    throw new Error(`No edges match filter '${filter}'${indices ? ` indices [${indices.join(',')}]` : ''}`);
  }

  const chamfer = new oc.BRepFilletAPI_MakeChamfer(shape);

  try {
    for (const edge of edges) {
      chamfer.Add_2(distance, edge);
    }
    return chamfer.Shape();
  } finally {
    chamfer.delete();
  }
}

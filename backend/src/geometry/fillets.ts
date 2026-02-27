import type { OpenCascadeInstance } from './oc-init.js';

export function filletAllEdges(oc: OpenCascadeInstance, shape: any, radius: number): any {
  const filletShape = (oc as any).ChFi3d_FilletShape.ChFi3d_Rational;
  const fillet = new (oc as any).BRepFilletAPI_MakeFillet(shape, filletShape);

  const explorer = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  let edgeCount = 0;
  while (explorer.More()) {
    const edge = oc.TopoDS.Edge_1(explorer.Current());
    fillet.Add_2(radius, edge);
    edgeCount++;
    explorer.Next();
  }
  explorer.delete();

  if (edgeCount === 0) {
    fillet.delete();
    throw new Error('Shape has no edges to fillet');
  }

  const result = fillet.Shape();
  fillet.delete();
  return result;
}

export function chamferAllEdges(oc: OpenCascadeInstance, shape: any, distance: number): any {
  const chamfer = new oc.BRepFilletAPI_MakeChamfer(shape);

  const explorer = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  let edgeCount = 0;
  while (explorer.More()) {
    const edge = oc.TopoDS.Edge_1(explorer.Current());
    chamfer.Add_2(distance, edge);
    edgeCount++;
    explorer.Next();
  }
  explorer.delete();

  if (edgeCount === 0) {
    chamfer.delete();
    throw new Error('Shape has no edges to chamfer');
  }

  const result = chamfer.Shape();
  chamfer.delete();
  return result;
}

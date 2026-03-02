import type { OpenCascadeInstance } from './oc-init.js';

/**
 * Shell (hollow) a solid by removing specified faces and offsetting the rest.
 * If no faces are specified, removes the top face (highest Z) by default.
 * wallThickness > 0 offsets outward, < 0 offsets inward.
 */
export function shellShape(
  oc: OpenCascadeInstance,
  shape: any,
  wallThickness: number,
  facesToRemove?: any[]
): any {
  // If no faces specified, find the top face (highest Z centroid)
  if (!facesToRemove || facesToRemove.length === 0) {
    facesToRemove = [findTopFace(oc, shape)];
  }

  // Build TopTools_ListOfShape of faces to remove
  const faceList = new oc.TopTools_ListOfShape_1();
  for (const face of facesToRemove) {
    faceList.Append_1(face);
  }

  const maker = new oc.BRepOffsetAPI_MakeThickSolid();
  // MakeThickSolidByJoin(shape, facesToRemove, offset, tolerance, mode, intersection, selfInter, join, removeIntEdges)
  maker.MakeThickSolidByJoin(
    shape,
    faceList,
    wallThickness,
    1e-3,              // tolerance
    oc.BRepOffset_Mode.BRepOffset_Skin,
    false,             // intersection
    false,             // selfInter
    oc.GeomAbs_JoinType.GeomAbs_Arc,
    false              // removeIntEdges
  );

  const result = maker.Shape();
  maker.delete();
  faceList.delete();
  return result;
}

/**
 * Find the top face (highest average Z) of a solid.
 */
function findTopFace(oc: any, shape: any): any {
  const explorer = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  let bestFace: any = null;
  let bestZ = -Infinity;

  while (explorer.More()) {
    const face = oc.TopoDS.Face_1(explorer.Current());
    // Get face centroid via surface properties
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.SurfaceProperties(face, props, false);
    const centroid = props.CentreOfMass();
    const z = centroid.Z();
    centroid.delete();
    props.delete();

    if (z > bestZ) {
      bestZ = z;
      if (bestFace) bestFace.delete();
      bestFace = face;
    } else {
      face.delete();
    }
    explorer.Next();
  }
  explorer.delete();
  return bestFace;
}

/**
 * Loft between two or more wire profiles (cross-sections) to create a solid.
 * wires: array of TopoDS_Wire shapes (profiles).
 * isSolid: true to make a solid, false for a shell.
 */
export function loftShapes(
  oc: OpenCascadeInstance,
  wires: any[],
  isSolid: boolean = true
): any {
  if (wires.length < 2) throw new Error('Loft requires at least 2 profiles');

  const loft = new oc.BRepOffsetAPI_ThruSections(isSolid, false, 1e-6);
  for (const wire of wires) {
    // If it's a face, extract the outer wire
    const shapeType = wire.ShapeType();
    if (shapeType === oc.TopAbs_ShapeEnum.TopAbs_WIRE) {
      loft.AddWire(oc.TopoDS.Wire_1(wire));
    } else if (shapeType === oc.TopAbs_ShapeEnum.TopAbs_FACE) {
      const outerWire = oc.BRepTools.OuterWire(oc.TopoDS.Face_1(wire));
      loft.AddWire(outerWire);
    } else {
      throw new Error(`Loft profile must be a wire or face, got shape type ${shapeType}`);
    }
  }

  loft.Build(new oc.Message_ProgressRange_1());
  const result = loft.Shape();
  loft.delete();
  return result;
}

/**
 * Sweep a profile along a path (spine) to create a solid or shell.
 * profile: TopoDS_Wire or TopoDS_Face (the cross-section)
 * spine: TopoDS_Wire (the path)
 */
export function sweepShape(
  oc: OpenCascadeInstance,
  profile: any,
  spine: any
): any {
  // Ensure profile is a wire
  let wire: any;
  const shapeType = profile.ShapeType();
  if (shapeType === oc.TopAbs_ShapeEnum.TopAbs_WIRE) {
    wire = oc.TopoDS.Wire_1(profile);
  } else if (shapeType === oc.TopAbs_ShapeEnum.TopAbs_FACE) {
    wire = oc.BRepTools.OuterWire(oc.TopoDS.Face_1(profile));
  } else {
    throw new Error(`Sweep profile must be a wire or face`);
  }

  const spineWire = oc.TopoDS.Wire_1(spine);
  const pipe = new oc.BRepOffsetAPI_MakePipe_1(spineWire, wire);
  const result = pipe.Shape();
  pipe.delete();
  return result;
}

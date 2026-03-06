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

  const faceList = new oc.TopTools_ListOfShape_1();
  for (const face of facesToRemove) {
    faceList.Append_1(face);
  }

  const maker = new oc.BRepOffsetAPI_MakeThickSolid();
  try {
    maker.MakeThickSolidByJoin(
      shape,
      faceList,
      wallThickness,
      1e-3,
      oc.BRepOffset_Mode.BRepOffset_Skin,
      false,
      false,
      oc.GeomAbs_JoinType.GeomAbs_Arc,
      false
    );
    return maker.Shape();
  } finally {
    try { maker.delete(); } catch {}
    try { faceList.delete(); } catch {}
  }
}

/**
 * Find the top face (highest average Z) of a solid.
 */
function findTopFace(oc: any, shape: any): any {
  const explorer = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  let bestFace: any = null;
  let bestZ = -Infinity;

  try {
    while (explorer.More()) {
      const face = oc.TopoDS.Face_1(explorer.Current());
      const props = new oc.GProp_GProps_1();
      try {
        oc.BRepGProp.SurfaceProperties(face, props, false);
        const centroid = props.CentreOfMass();
        const z = centroid.Z();
        try { centroid.delete(); } catch {}

        if (z > bestZ) {
          bestZ = z;
          if (bestFace) try { bestFace.delete(); } catch {}
          bestFace = face;
        } else {
          try { face.delete(); } catch {}
        }
      } finally {
        try { props.delete(); } catch {}
      }
      explorer.Next();
    }
  } finally {
    try { explorer.delete(); } catch {}
  }
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
  const progress = new oc.Message_ProgressRange_1();
  try {
    for (const wire of wires) {
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

    loft.Build(progress);
    return loft.Shape();
  } finally {
    try { loft.delete(); } catch {}
    try { progress.delete(); } catch {}
  }
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
  try {
    return pipe.Shape();
  } finally {
    try { pipe.delete(); } catch {}
  }
}

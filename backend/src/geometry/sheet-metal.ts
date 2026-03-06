import type { OpenCascadeInstance } from './oc-init.js';
import type { BendLine } from '../materials/materials.js';
import { calculateBend } from '../materials/materials.js';
import { booleanIntersect } from './booleans.js';
import { translateShape } from './transforms.js';
import { DisposableCollector } from './oc-cleanup.js';

/**
 * Create a flat plate (thin box) on the XY plane with thickness in Z.
 */
export function createFlatPlate(
  oc: OpenCascadeInstance,
  width: number,
  length: number,
  thickness: number
): any {
  const maker = new oc.BRepPrimAPI_MakeBox_1(width, length, thickness);
  try {
    return maker.Shape();
  } finally {
    try { maker.delete(); } catch {}
  }
}

/**
 * Build a 3D folded shape from a flat plate definition with bend lines.
 * Supports mixed-axis bends by processing each axis group independently.
 *
 * If sourceShape is provided (the actual plate with holes/cutouts), segments
 * are extracted from it via boolean intersection, preserving all cutout features.
 *
 * - X-axis bends: bend line runs along X, divides Y dimension, folds in Y-Z plane
 * - Y-axis bends: bend line runs along Y, divides X dimension, folds in X-Z plane
 */
export function buildFoldedShape(
  oc: OpenCascadeInstance,
  width: number,
  length: number,
  thickness: number,
  bend_radius: number,
  k_factor: number,
  bendLines: BendLine[],
  sourceShape?: any
): any {
  if (bendLines.length === 0) {
    return sourceShape ?? createFlatPlate(oc, width, length, thickness);
  }

  // Split bends by axis
  const xBends = bendLines.filter(b => b.axis === 'X');
  const yBends = bendLines.filter(b => b.axis === 'Y');

  // If all bends are on the same axis, use the single-axis chain
  if (yBends.length === 0) {
    return buildSingleAxisFold(oc, width, length, thickness, bend_radius, k_factor, xBends, 'X', sourceShape);
  }
  if (xBends.length === 0) {
    return buildSingleAxisFold(oc, width, length, thickness, bend_radius, k_factor, yBends, 'Y', sourceShape);
  }

  // Mixed-axis: fold each group independently and compound the results
  const xFolded = buildSingleAxisFold(oc, width, length, thickness, bend_radius, k_factor, xBends, 'X', sourceShape);
  const yFolded = buildSingleAxisFold(oc, width, length, thickness, bend_radius, k_factor, yBends, 'Y', sourceShape);

  return buildCompound(oc, [xFolded, yFolded]);
}

/**
 * Build a folded shape for bends along a single axis.
 * If sourceShape is provided, segments are sliced from it (preserving holes).
 */
function buildSingleAxisFold(
  oc: OpenCascadeInstance,
  width: number,
  length: number,
  thickness: number,
  bend_radius: number,
  k_factor: number,
  bends: BendLine[],
  axis: 'X' | 'Y',
  sourceShape?: any
): any {
  // Sort bends by position
  const sorted = [...bends].sort((a, b) => a.position - b.position);

  // The dimension along the bend direction
  const totalLength = axis === 'X' ? length : width;
  const crossWidth = axis === 'X' ? width : length;

  // Calculate bend deductions
  const bendCalcs = sorted.map(b =>
    calculateBend(thickness, bend_radius, k_factor, b.angle_deg)
  );

  // Build segment boundaries: [0, bend1.pos, bend2.pos, ..., totalLength]
  const boundaries = [0, ...sorted.map(b => b.position), totalLength];

  // Compute flat segment lengths, adjusted by half-deduction at each adjacent bend
  const segmentLengths: number[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    let len = boundaries[i + 1] - boundaries[i];
    if (i > 0) {
      len -= bendCalcs[i - 1].bend_deduction / 2;
    }
    if (i < sorted.length) {
      len -= bendCalcs[i].bend_deduction / 2;
    }
    segmentLengths.push(Math.max(len, 0.001));
  }

  // Build segments — either from source shape (preserving holes) or fresh boxes
  const segments: any[] = [];
  let cumulativeAngle = 0;
  let penPrimary = 0;
  let penZ = 0;

  for (let i = 0; i < segmentLengths.length; i++) {
    const segLen = segmentLengths[i];

    // Create or extract segment
    let seg: any;

    if (sourceShape) {
      seg = extractSegmentFromSource(oc, sourceShape, axis, boundaries[i], boundaries[i + 1], width, length, thickness);
      if (!seg) {
        seg = createSegmentBox(oc, segLen, crossWidth, thickness, axis);
      }
    } else {
      seg = createSegmentBox(oc, segLen, crossWidth, thickness, axis);
    }

    if (i > 0) {
      const gc = new DisposableCollector();
      try {
        const tTranslate = gc.track(new oc.gp_Trsf_1());
        const transVec = axis === 'X'
          ? gc.track(new oc.gp_Vec_4(0, penPrimary, penZ))
          : gc.track(new oc.gp_Vec_4(penPrimary, 0, penZ));
        tTranslate.SetTranslation_1(transVec);

        const tRotate = gc.track(new oc.gp_Trsf_1());
        if (cumulativeAngle !== 0) {
          const rotPnt = axis === 'X'
            ? gc.track(new oc.gp_Pnt_3(0, penPrimary, penZ))
            : gc.track(new oc.gp_Pnt_3(penPrimary, 0, penZ));
          const rotDir = axis === 'X'
            ? gc.track(new oc.gp_Dir_4(1, 0, 0))
            : gc.track(new oc.gp_Dir_4(0, 1, 0));
          const rotAxis = gc.track(new oc.gp_Ax1_2(rotPnt, rotDir));
          tRotate.SetRotation_1(rotAxis, cumulativeAngle);
        }

        const combined = gc.track(new oc.gp_Trsf_1());
        if (cumulativeAngle !== 0) {
          combined.Multiply(tRotate);
          combined.Multiply(tTranslate);
        } else {
          combined.Multiply(tTranslate);
        }

        const xform = gc.track(new oc.BRepBuilderAPI_Transform_2(seg, combined, true));
        seg = xform.Shape();
      } finally {
        gc.cleanup();
      }
    }

    segments.push(seg);

    // Advance pen position
    penPrimary += segLen * Math.cos(cumulativeAngle);
    penZ += segLen * Math.sin(cumulativeAngle);

    // Create bend radius visualization at this bend position
    if (i < sorted.length && bend_radius > 0.001) {
      try {
        const bendAngleRad = sorted[i].angle_deg * Math.PI / 180;
        const sign = sorted[i].direction === 'up' ? 1 : -1;
        const bendZone = createBendZone(
          oc, axis, crossWidth, thickness, bend_radius,
          bendAngleRad, sign, penPrimary, penZ, cumulativeAngle
        );
        if (bendZone) segments.push(bendZone);
      } catch {
        // Bend zone creation failed — skip (sharp corners still work)
      }
    }

    // Apply bend angle
    if (i < sorted.length) {
      const bendAngle = sorted[i].angle_deg * Math.PI / 180;
      const sign = sorted[i].direction === 'up' ? 1 : -1;
      cumulativeAngle += sign * bendAngle;
    }
  }

  // Combine segments
  if (segments.length === 1) {
    return segments[0];
  }

  // Try boolean fuse
  try {
    let result = segments[0];
    for (let i = 1; i < segments.length; i++) {
      const fuse = new oc.BRepAlgoAPI_Fuse_3(result, segments[i]);
      try {
        if (fuse.IsDone()) {
          result = fuse.Shape();
        } else {
          return buildCompound(oc, segments);
        }
      } finally {
        try { fuse.delete(); } catch {}
      }
    }
    return result;
  } catch {
    return buildCompound(oc, segments);
  }
}

/** Create a fresh box segment at origin */
function createSegmentBox(
  oc: OpenCascadeInstance,
  segLen: number,
  crossWidth: number,
  thickness: number,
  axis: 'X' | 'Y'
): any {
  let segW: number, segL: number;
  if (axis === 'X') {
    segW = crossWidth;
    segL = segLen;
  } else {
    segW = segLen;
    segL = crossWidth;
  }
  const maker = new oc.BRepPrimAPI_MakeBox_1(segW, segL, thickness);
  try {
    return maker.Shape();
  } finally {
    try { maker.delete(); } catch {}
  }
}

/**
 * Extract a segment from the source shape by boolean intersection with a cutting box.
 */
function extractSegmentFromSource(
  oc: OpenCascadeInstance,
  sourceShape: any,
  axis: 'X' | 'Y',
  posStart: number,
  posEnd: number,
  plateWidth: number,
  plateLength: number,
  thickness: number
): any | null {
  try {
    const margin = 0.001;
    let cutterW: number, cutterL: number;
    let offX: number, offY: number;

    if (axis === 'X') {
      cutterW = plateWidth + margin * 2;
      cutterL = posEnd - posStart + margin * 2;
      offX = -margin;
      offY = posStart - margin;
    } else {
      cutterW = posEnd - posStart + margin * 2;
      cutterL = plateLength + margin * 2;
      offX = posStart - margin;
      offY = -margin;
    }

    const cutterMaker = new oc.BRepPrimAPI_MakeBox_1(cutterW, cutterL, thickness + margin * 2);
    let cutter: any;
    try {
      cutter = cutterMaker.Shape();
    } finally {
      try { cutterMaker.delete(); } catch {}
    }

    // Position the cutter
    const positioned = translateShape(oc, cutter, offX, offY, -margin);
    try { cutter.delete(); } catch {}

    // Boolean intersect to extract the segment
    const segment = booleanIntersect(oc, sourceShape, positioned);
    try { positioned.delete(); } catch {}

    // Translate segment back to origin
    if (axis === 'X') {
      const result = translateShape(oc, segment, 0, -posStart, 0);
      try { segment.delete(); } catch {}
      return result;
    } else {
      const result = translateShape(oc, segment, -posStart, 0, 0);
      try { segment.delete(); } catch {}
      return result;
    }
  } catch {
    return null;
  }
}

/**
 * Create a cylindrical bend zone at a bend position.
 */
function createBendZone(
  oc: OpenCascadeInstance,
  axis: 'X' | 'Y',
  crossWidth: number,
  thickness: number,
  bendRadius: number,
  bendAngleRad: number,
  sign: number,
  penPrimary: number,
  penZ: number,
  cumulativeAngle: number
): any | null {
  const gc = new DisposableCollector();
  try {
    let p1: any, p2: any, p3: any, p4: any;

    if (axis === 'X') {
      p1 = gc.track(new oc.gp_Pnt_3(0, 0, sign * bendRadius));
      p2 = gc.track(new oc.gp_Pnt_3(crossWidth, 0, sign * bendRadius));
      p3 = gc.track(new oc.gp_Pnt_3(crossWidth, 0, sign * (bendRadius + thickness)));
      p4 = gc.track(new oc.gp_Pnt_3(0, 0, sign * (bendRadius + thickness)));
    } else {
      p1 = gc.track(new oc.gp_Pnt_3(0, 0, sign * bendRadius));
      p2 = gc.track(new oc.gp_Pnt_3(0, crossWidth, sign * bendRadius));
      p3 = gc.track(new oc.gp_Pnt_3(0, crossWidth, sign * (bendRadius + thickness)));
      p4 = gc.track(new oc.gp_Pnt_3(0, 0, sign * (bendRadius + thickness)));
    }

    // Build wire from 4 edges
    const e1 = gc.track(new oc.BRepBuilderAPI_MakeEdge_3(p1, p2));
    const e2 = gc.track(new oc.BRepBuilderAPI_MakeEdge_3(p2, p3));
    const e3 = gc.track(new oc.BRepBuilderAPI_MakeEdge_3(p3, p4));
    const e4 = gc.track(new oc.BRepBuilderAPI_MakeEdge_3(p4, p1));

    const wireBuilder = gc.track(new oc.BRepBuilderAPI_MakeWire_1());
    wireBuilder.Add_1(e1.Edge());
    wireBuilder.Add_1(e2.Edge());
    wireBuilder.Add_1(e3.Edge());
    wireBuilder.Add_1(e4.Edge());
    const wire = wireBuilder.Wire();

    const faceMaker = gc.track(new oc.BRepBuilderAPI_MakeFace_15(wire, true));
    const face = faceMaker.Shape();

    // Revolve axis
    const revolPnt = axis === 'X'
      ? gc.track(new oc.gp_Pnt_3(0, 0, 0))
      : gc.track(new oc.gp_Pnt_3(0, 0, 0));
    const revolDir = axis === 'X'
      ? gc.track(new oc.gp_Dir_4(1, 0, 0))
      : gc.track(new oc.gp_Dir_4(0, 1, 0));
    const revolAxis = gc.track(new oc.gp_Ax1_2(revolPnt, revolDir));

    const revol = gc.track(new oc.BRepPrimAPI_MakeRevol_1(face, revolAxis, bendAngleRad, true));
    let bendShape = revol.Shape();

    // Translate to pen position and rotate by cumulative angle
    const tTranslate = gc.track(new oc.gp_Trsf_1());
    const transVec = axis === 'X'
      ? gc.track(new oc.gp_Vec_4(0, penPrimary, penZ))
      : gc.track(new oc.gp_Vec_4(penPrimary, 0, penZ));
    tTranslate.SetTranslation_1(transVec);

    const tRotate = gc.track(new oc.gp_Trsf_1());
    if (cumulativeAngle !== 0) {
      const rotPnt = axis === 'X'
        ? gc.track(new oc.gp_Pnt_3(0, penPrimary, penZ))
        : gc.track(new oc.gp_Pnt_3(penPrimary, 0, penZ));
      const rotDir2 = axis === 'X'
        ? gc.track(new oc.gp_Dir_4(1, 0, 0))
        : gc.track(new oc.gp_Dir_4(0, 1, 0));
      const rotAx = gc.track(new oc.gp_Ax1_2(rotPnt, rotDir2));
      tRotate.SetRotation_1(rotAx, cumulativeAngle);
    }

    const combined = gc.track(new oc.gp_Trsf_1());
    if (cumulativeAngle !== 0) {
      combined.Multiply(tRotate);
      combined.Multiply(tTranslate);
    } else {
      combined.Multiply(tTranslate);
    }

    const xform = gc.track(new oc.BRepBuilderAPI_Transform_2(bendShape, combined, true));
    bendShape = xform.Shape();

    // Clean up intermediate shapes not tracked by gc
    try { wire.delete(); } catch {}
    try { face.delete(); } catch {}

    return bendShape;
  } catch {
    return null;
  } finally {
    gc.cleanup();
  }
}

/** Group shapes into a TopoDS_Compound as fallback when fuse fails */
function buildCompound(oc: OpenCascadeInstance, shapes: any[]): any {
  const compound = new oc.TopoDS_Compound();
  const builder = new oc.BRep_Builder();
  builder.MakeCompound(compound);
  for (const s of shapes) {
    builder.Add(compound, s);
  }
  return compound;
}

import type { OpenCascadeInstance } from './oc-init.js';
import type { BendLine } from '../materials/materials.js';
import { calculateBend } from '../materials/materials.js';

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
  const shape = maker.Shape();
  maker.delete();
  return shape;
}

/**
 * Build a 3D folded shape from a flat plate definition with bend lines.
 * V1: sharp folds only (no cylindrical bend geometry). Single-axis bends only.
 *
 * Strategy: create each segment as a box at origin, then apply a compound
 * transform (translate to pen position + rotate by cumulative angle around
 * the bend axis at the pen position).
 */
export function buildFoldedShape(
  oc: OpenCascadeInstance,
  width: number,
  length: number,
  thickness: number,
  bend_radius: number,
  k_factor: number,
  bendLines: BendLine[]
): any {
  if (bendLines.length === 0) {
    return createFlatPlate(oc, width, length, thickness);
  }

  // Determine bend axis — all bends must be on the same axis for V1
  const axis = bendLines[0].axis;

  // Sort bends by position
  const sorted = [...bendLines].sort((a, b) => a.position - b.position);

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

  // Build segments as boxes, positioned and rotated.
  // We track a "pen" position and a cumulative direction angle.
  // For axis='X': bends rotate in the Y-Z plane, pen tracks (penY, penZ)
  // For axis='Y': bends rotate in the X-Z plane, pen tracks (penX, penZ)
  const segments: any[] = [];
  let cumulativeAngle = 0; // radians, direction the current segment extends in
  let penPrimary = 0; // position along the bend direction (Y for axis=X, X for axis=Y)
  let penZ = 0;

  for (let i = 0; i < segmentLengths.length; i++) {
    const segLen = segmentLengths[i];

    // Create segment box at origin
    let segW: number, segL: number;
    if (axis === 'X') {
      segW = crossWidth; // X dimension
      segL = segLen;     // Y dimension (bend direction)
    } else {
      segW = segLen;     // X dimension (bend direction)
      segL = crossWidth; // Y dimension
    }

    const maker = new oc.BRepPrimAPI_MakeBox_1(segW, segL, thickness);
    let seg = maker.Shape();
    maker.delete();

    if (i > 0) {
      // Need to: translate origin of segment to pen position, then rotate
      // around the bend axis at the pen position by cumulative angle.

      // Step 1: Translate segment to pen position
      const tTranslate = new oc.gp_Trsf_1();
      if (axis === 'X') {
        tTranslate.SetTranslation_1(new oc.gp_Vec_4(0, penPrimary, penZ));
      } else {
        tTranslate.SetTranslation_1(new oc.gp_Vec_4(penPrimary, 0, penZ));
      }

      // Step 2: Rotate around the bend axis at the pen position
      const tRotate = new oc.gp_Trsf_1();
      if (cumulativeAngle !== 0) {
        let rotAxis;
        if (axis === 'X') {
          rotAxis = new oc.gp_Ax1_2(
            new oc.gp_Pnt_3(0, penPrimary, penZ),
            new oc.gp_Dir_4(1, 0, 0)
          );
        } else {
          rotAxis = new oc.gp_Ax1_2(
            new oc.gp_Pnt_3(penPrimary, 0, penZ),
            new oc.gp_Dir_4(0, 1, 0)
          );
        }
        tRotate.SetRotation_1(rotAxis, cumulativeAngle);
        rotAxis.delete();
      }

      // Combine: first translate, then rotate around pen
      const combined = new oc.gp_Trsf_1();
      if (cumulativeAngle !== 0) {
        combined.Multiply(tRotate);
        combined.Multiply(tTranslate);
      } else {
        combined.Multiply(tTranslate);
      }

      const xform = new oc.BRepBuilderAPI_Transform_2(seg, combined, true);
      seg = xform.Shape();
      xform.delete();
      tTranslate.delete();
      tRotate.delete();
      combined.delete();
    }

    segments.push(seg);

    // Advance pen position for next segment
    // The current segment extends along direction `cumulativeAngle` from its start
    penPrimary += segLen * Math.cos(cumulativeAngle);
    penZ += segLen * Math.sin(cumulativeAngle);

    // Apply bend angle if there's a bend after this segment
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

  // Try boolean fuse (BRepAlgoAPI_Fuse_3 takes 2 args, no ProgressRange in this WASM build)
  try {
    let result = segments[0];
    for (let i = 1; i < segments.length; i++) {
      const fuse = new oc.BRepAlgoAPI_Fuse_3(result, segments[i]);
      if (fuse.IsDone()) {
        result = fuse.Shape();
      } else {
        fuse.delete();
        return buildCompound(oc, segments);
      }
      fuse.delete();
    }
    return result;
  } catch {
    return buildCompound(oc, segments);
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

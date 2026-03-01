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
 * Process:
 * 1. Sort bends by position along their axis
 * 2. Split plate into segments between bends
 * 3. Adjust segment lengths by bend deduction
 * 4. Create each segment as a box, rotate by cumulative angle, translate to position
 * 5. Boolean-fuse all segments (fallback to compound if fuse fails)
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
    // Subtract half deduction for bend on left side (if exists)
    if (i > 0) {
      len -= bendCalcs[i - 1].bend_deduction / 2;
    }
    // Subtract half deduction for bend on right side (if exists)
    if (i < sorted.length) {
      len -= bendCalcs[i].bend_deduction / 2;
    }
    segmentLengths.push(Math.max(len, 0.001)); // ensure positive
  }

  // Build segments as boxes, positioned and rotated
  const segments: any[] = [];
  let cumulativeAngle = 0; // radians
  // Current "pen" position in 3D space (where the next segment starts)
  let penX = 0;
  let penY = 0;
  let penZ = 0;

  for (let i = 0; i < segmentLengths.length; i++) {
    const segLen = segmentLengths[i];

    // Create segment box: crossWidth along X, segLen along Y (bend direction), thickness along Z
    let segW: number, segL: number;
    if (axis === 'X') {
      // Bends along X → segments stacked along Y
      segW = crossWidth;
      segL = segLen;
    } else {
      // Bends along Y → segments stacked along X
      segW = segLen;
      segL = crossWidth;
    }

    const maker = new oc.BRepPrimAPI_MakeBox_1(segW, segL, thickness);
    let seg = maker.Shape();
    maker.delete();

    // Apply cumulative rotation and translation
    const trsf = new oc.gp_Trsf_1();

    if (axis === 'X') {
      // Translate to pen position, then rotate around X axis
      if (cumulativeAngle !== 0) {
        const rotAxis = new oc.gp_Ax1_2(
          new oc.gp_Pnt_3(0, penY, penZ),
          new oc.gp_Dir_4(1, 0, 0)
        );
        trsf.SetRotation_1(rotAxis, cumulativeAngle);
        rotAxis.delete();
      }
      // Build translation for the segment origin
      const translated = new oc.gp_Trsf_1();
      if (i > 0) {
        // Offset along rotated Y direction
        // For simplicity in V1: place at pen position
        translated.SetTranslation_1(new oc.gp_Vec_4(penX, penY, penZ));
      }

      if (i === 0 && cumulativeAngle === 0) {
        // First segment, no transform needed
      } else {
        const xform = new oc.BRepBuilderAPI_Transform_2(seg, trsf, true);
        const newSeg = xform.Shape();
        xform.delete();
        seg = newSeg;
      }

      translated.delete();
    } else {
      // Bends along Y axis
      if (cumulativeAngle !== 0) {
        const rotAxis = new oc.gp_Ax1_2(
          new oc.gp_Pnt_3(penX, 0, penZ),
          new oc.gp_Dir_4(0, 1, 0)
        );
        trsf.SetRotation_1(rotAxis, cumulativeAngle);
        rotAxis.delete();
      }

      if (i === 0 && cumulativeAngle === 0) {
        // First segment, no transform needed
      } else {
        const xform = new oc.BRepBuilderAPI_Transform_2(seg, trsf, true);
        const newSeg = xform.Shape();
        xform.delete();
        seg = newSeg;
      }
    }

    trsf.delete();
    segments.push(seg);

    // Advance pen position for next segment
    if (i < sorted.length) {
      const bendAngle = sorted[i].angle_deg * Math.PI / 180;
      const sign = sorted[i].direction === 'up' ? 1 : -1;
      cumulativeAngle += sign * bendAngle;

      if (axis === 'X') {
        // Moving along Y-Z plane
        penY += segLen * Math.cos(cumulativeAngle - sign * bendAngle);
        penZ += segLen * Math.sin(cumulativeAngle - sign * bendAngle);
      } else {
        // Moving along X-Z plane
        penX += segLen * Math.cos(cumulativeAngle - sign * bendAngle);
        penZ += segLen * Math.sin(cumulativeAngle - sign * bendAngle);
      }
    }
  }

  // Try to fuse all segments into one solid
  if (segments.length === 1) {
    return segments[0];
  }

  // Try boolean fuse
  try {
    let result = segments[0];
    for (let i = 1; i < segments.length; i++) {
      const fuse = new oc.BRepAlgoAPI_Fuse_3(result, segments[i]);
      fuse.Build(new oc.Message_ProgressRange_1());
      if (fuse.IsDone()) {
        result = fuse.Shape();
      } else {
        // Fuse failed — fall back to compound
        fuse.delete();
        return buildCompound(oc, segments);
      }
      fuse.delete();
    }
    return result;
  } catch {
    // Fallback: group as compound
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

import type { OpenCascadeInstance } from './oc-init.js';
import { withCleanup } from './oc-cleanup.js';

export function translateShape(oc: OpenCascadeInstance, shape: any, x: number, y: number, z: number): any {
  const trsf = new oc.gp_Trsf_1();
  const vec = new oc.gp_Vec_4(x, y, z);
  trsf.SetTranslation_1(vec);
  const transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
  return withCleanup([transformer, trsf, vec], () => transformer.Shape());
}

export function rotateShape(
  oc: OpenCascadeInstance,
  shape: any,
  axisX: number,
  axisY: number,
  axisZ: number,
  angleDeg: number
): any {
  const origin = new oc.gp_Pnt_3(0, 0, 0);
  const dir = new oc.gp_Dir_4(axisX, axisY, axisZ);
  const axis = new oc.gp_Ax1_2(origin, dir);
  const trsf = new oc.gp_Trsf_1();
  trsf.SetRotation_1(axis, (angleDeg * Math.PI) / 180);
  const transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
  return withCleanup([transformer, trsf, axis, origin, dir], () => transformer.Shape());
}

export function mirrorShape(
  oc: OpenCascadeInstance,
  shape: any,
  plane: 'XY' | 'XZ' | 'YZ',
  offset: number = 0
): any {
  let origin: any, normal: any;
  switch (plane) {
    case 'YZ':
      origin = new oc.gp_Pnt_3(offset, 0, 0);
      normal = new oc.gp_Dir_4(1, 0, 0);
      break;
    case 'XZ':
      origin = new oc.gp_Pnt_3(0, offset, 0);
      normal = new oc.gp_Dir_4(0, 1, 0);
      break;
    case 'XY':
      origin = new oc.gp_Pnt_3(0, 0, offset);
      normal = new oc.gp_Dir_4(0, 0, 1);
      break;
  }
  const ax2 = new oc.gp_Ax2_3(origin, normal);
  const trsf = new oc.gp_Trsf_1();
  trsf.SetMirror_3(ax2);
  const transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
  return withCleanup([transformer, trsf, ax2, origin, normal], () => transformer.Shape());
}

export function scaleShape(
  oc: OpenCascadeInstance,
  shape: any,
  factor: number,
  centerX: number = 0,
  centerY: number = 0,
  centerZ: number = 0
): any {
  const center = new oc.gp_Pnt_3(centerX, centerY, centerZ);
  const trsf = new oc.gp_Trsf_1();
  trsf.SetScale(center, factor);
  const transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
  return withCleanup([transformer, trsf, center], () => transformer.Shape());
}

export function linearPatternCopies(
  oc: OpenCascadeInstance,
  shape: any,
  count: number,
  sx: number,
  sy: number,
  sz: number
): any[] {
  const copies: any[] = [];
  for (let i = 1; i <= count; i++) {
    const trsf = new oc.gp_Trsf_1();
    const vec = new oc.gp_Vec_4(i * sx, i * sy, i * sz);
    trsf.SetTranslation_1(vec);
    const transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
    copies.push(withCleanup([transformer, trsf, vec], () => transformer.Shape()));
  }
  return copies;
}

export function circularPatternCopies(
  oc: OpenCascadeInstance,
  shape: any,
  count: number,
  cx: number,
  cy: number,
  cz: number,
  ax: number,
  ay: number,
  az: number,
  totalAngleDeg: number
): any[] {
  const copies: any[] = [];
  // When full 360°, divide by (count+1) so last copy doesn't overlap the original
  const isFullCircle = Math.abs(totalAngleDeg - 360) < 0.01;
  const angleStep = isFullCircle ? 360 / (count + 1) : totalAngleDeg / count;
  const axisPt = new oc.gp_Pnt_3(cx, cy, cz);
  const axisDir = new oc.gp_Dir_4(ax, ay, az);
  const axis = new oc.gp_Ax1_2(axisPt, axisDir);
  try {
    for (let i = 1; i <= count; i++) {
      const trsf = new oc.gp_Trsf_1();
      trsf.SetRotation_1(axis, (i * angleStep * Math.PI) / 180);
      const transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
      copies.push(withCleanup([transformer, trsf], () => transformer.Shape()));
    }
    return copies;
  } finally {
    try { axis.delete(); } catch {}
    try { axisPt.delete(); } catch {}
    try { axisDir.delete(); } catch {}
  }
}

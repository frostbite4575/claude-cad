import type { OpenCascadeInstance } from './oc-init.js';

export function translateShape(oc: OpenCascadeInstance, shape: any, x: number, y: number, z: number): any {
  const trsf = new oc.gp_Trsf_1();
  trsf.SetTranslation_1(new oc.gp_Vec_4(x, y, z));
  const transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
  const result = transformer.Shape();
  transformer.delete();
  trsf.delete();
  return result;
}

export function rotateShape(
  oc: OpenCascadeInstance,
  shape: any,
  axisX: number,
  axisY: number,
  axisZ: number,
  angleDeg: number
): any {
  const axis = new oc.gp_Ax1_2(
    new oc.gp_Pnt_3(0, 0, 0),
    new oc.gp_Dir_4(axisX, axisY, axisZ)
  );
  const trsf = new oc.gp_Trsf_1();
  trsf.SetRotation_1(axis, (angleDeg * Math.PI) / 180);
  const transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
  const result = transformer.Shape();
  transformer.delete();
  trsf.delete();
  axis.delete();
  return result;
}

export function mirrorShape(
  oc: OpenCascadeInstance,
  shape: any,
  plane: 'XY' | 'XZ' | 'YZ',
  offset: number = 0
): any {
  // Build the mirror plane origin and normal based on plane choice
  let origin: any, normal: any;
  switch (plane) {
    case 'YZ': // mirror across YZ plane (normal along X)
      origin = new oc.gp_Pnt_3(offset, 0, 0);
      normal = new oc.gp_Dir_4(1, 0, 0);
      break;
    case 'XZ': // mirror across XZ plane (normal along Y)
      origin = new oc.gp_Pnt_3(0, offset, 0);
      normal = new oc.gp_Dir_4(0, 1, 0);
      break;
    case 'XY': // mirror across XY plane (normal along Z)
      origin = new oc.gp_Pnt_3(0, 0, offset);
      normal = new oc.gp_Dir_4(0, 0, 1);
      break;
  }
  const ax2 = new oc.gp_Ax2_3(origin, normal);
  const trsf = new oc.gp_Trsf_1();
  trsf.SetMirror_3(ax2);
  const transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
  const result = transformer.Shape();
  transformer.delete();
  trsf.delete();
  ax2.delete();
  origin.delete();
  normal.delete();
  return result;
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
    trsf.SetTranslation_1(new oc.gp_Vec_4(i * sx, i * sy, i * sz));
    const transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
    copies.push(transformer.Shape());
    transformer.delete();
    trsf.delete();
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
  const angleStep = totalAngleDeg / count;
  const axisPt = new oc.gp_Pnt_3(cx, cy, cz);
  const axisDir = new oc.gp_Dir_4(ax, ay, az);
  const axis = new oc.gp_Ax1_2(axisPt, axisDir);
  for (let i = 1; i <= count; i++) {
    const trsf = new oc.gp_Trsf_1();
    trsf.SetRotation_1(axis, (i * angleStep * Math.PI) / 180);
    const transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
    copies.push(transformer.Shape());
    transformer.delete();
    trsf.delete();
  }
  axis.delete();
  axisPt.delete();
  axisDir.delete();
  return copies;
}

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

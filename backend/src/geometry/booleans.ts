import type { OpenCascadeInstance } from './oc-init.js';

export function booleanUnion(oc: OpenCascadeInstance, shape1: any, shape2: any): any {
  const fuse = new oc.BRepAlgoAPI_Fuse_3(shape1, shape2);
  const result = fuse.Shape();
  fuse.delete();
  return result;
}

export function booleanSubtract(oc: OpenCascadeInstance, shape1: any, shape2: any): any {
  const cut = new oc.BRepAlgoAPI_Cut_3(shape1, shape2);
  const result = cut.Shape();
  cut.delete();
  return result;
}

export function booleanIntersect(oc: OpenCascadeInstance, shape1: any, shape2: any): any {
  const common = new oc.BRepAlgoAPI_Common_3(shape1, shape2);
  const result = common.Shape();
  common.delete();
  return result;
}

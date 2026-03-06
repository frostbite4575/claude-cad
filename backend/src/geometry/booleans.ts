import type { OpenCascadeInstance } from './oc-init.js';

export function booleanUnion(oc: OpenCascadeInstance, shape1: any, shape2: any): any {
  if (!shape1 || !shape2) throw new Error('Boolean union: both shapes must be valid');
  const fuse = new oc.BRepAlgoAPI_Fuse_3(shape1, shape2);
  try {
    if (!fuse.IsDone()) {
      throw new Error('Boolean union failed — shapes may not overlap or be compatible');
    }
    return fuse.Shape();
  } finally {
    try { fuse.delete(); } catch {}
  }
}

export function booleanSubtract(oc: OpenCascadeInstance, shape1: any, shape2: any): any {
  if (!shape1 || !shape2) throw new Error('Boolean subtract: both shapes must be valid');
  const cut = new oc.BRepAlgoAPI_Cut_3(shape1, shape2);
  try {
    if (!cut.IsDone()) {
      throw new Error('Boolean subtract failed — shapes may not overlap or be compatible');
    }
    return cut.Shape();
  } finally {
    try { cut.delete(); } catch {}
  }
}

export function booleanIntersect(oc: OpenCascadeInstance, shape1: any, shape2: any): any {
  if (!shape1 || !shape2) throw new Error('Boolean intersect: both shapes must be valid');
  const common = new oc.BRepAlgoAPI_Common_3(shape1, shape2);
  try {
    if (!common.IsDone()) {
      throw new Error('Boolean intersect failed — shapes may not overlap or be compatible');
    }
    return common.Shape();
  } finally {
    try { common.delete(); } catch {}
  }
}

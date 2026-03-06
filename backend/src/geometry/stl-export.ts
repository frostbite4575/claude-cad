import type { OpenCascadeInstance } from './oc-init.js';

export interface StlExportResult {
  stlContent: string;
  warnings: string[];
}

/**
 * Export shapes to ASCII STL format using OpenCASCADE tessellation.
 */
export function exportStl(oc: OpenCascadeInstance, shapes: any[]): StlExportResult {
  const warnings: string[] = [];

  // Build a compound of all shapes
  const builder = new oc.BRep_Builder();
  const compound = new oc.TopoDS_Compound();
  builder.MakeCompound(compound);
  for (const shape of shapes) {
    builder.Add(compound, shape);
  }

  // Mesh first (tessellate)
  const progress = new oc.Message_ProgressRange_1();
  const mesh = new oc.BRepMesh_IncrementalMesh_2(compound, 0.01, false, 0.5, false);
  try {
    mesh.Perform(progress);
  } finally {
    try { mesh.delete(); } catch {}
    try { progress.delete(); } catch {}
  }

  // Build STL from tessellation data
  const triangles: string[] = [];
  const faceExplorer = new oc.TopExp_Explorer_2(compound, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);

  try {
    while (faceExplorer.More()) {
      const face = oc.TopoDS.Face_1(faceExplorer.Current());
      const location = new oc.TopLoc_Location_1();
      try {
        const triangulation = oc.BRep_Tool.Triangulation(face, location, 0);

        if (triangulation && !triangulation.IsNull()) {
          const trsf = location.Transformation();
          const nbTriangles = triangulation.get().NbTriangles();

          for (let i = 1; i <= nbTriangles; i++) {
            const tri = triangulation.get().Triangle(i);
            const n1 = tri.Value(1);
            const n2 = tri.Value(2);
            const n3 = tri.Value(3);

            const p1 = triangulation.get().Node(n1).Transformed(trsf);
            const p2 = triangulation.get().Node(n2).Transformed(trsf);
            const p3 = triangulation.get().Node(n3).Transformed(trsf);

            // Calculate face normal
            const ux = p2.X() - p1.X(), uy = p2.Y() - p1.Y(), uz = p2.Z() - p1.Z();
            const vx = p3.X() - p1.X(), vy = p3.Y() - p1.Y(), vz = p3.Z() - p1.Z();
            let nx = uy * vz - uz * vy;
            let ny = uz * vx - ux * vz;
            let nz = ux * vy - uy * vx;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            if (len > 1e-10) { nx /= len; ny /= len; nz /= len; }

            triangles.push(
              `  facet normal ${nx} ${ny} ${nz}\n` +
              `    outer loop\n` +
              `      vertex ${p1.X()} ${p1.Y()} ${p1.Z()}\n` +
              `      vertex ${p2.X()} ${p2.Y()} ${p2.Z()}\n` +
              `      vertex ${p3.X()} ${p3.Y()} ${p3.Z()}\n` +
              `    endloop\n` +
              `  endfacet`
            );

            try { p1.delete(); } catch {}
            try { p2.delete(); } catch {}
            try { p3.delete(); } catch {}
          }

          try { trsf.delete(); } catch {}
        }
      } finally {
        try { location.delete(); } catch {}
      }
      faceExplorer.Next();
    }
  } finally {
    try { faceExplorer.delete(); } catch {}
    try { compound.delete(); } catch {}
  }

  if (triangles.length === 0) {
    warnings.push('No triangles generated — shape may be empty or a sketch (2D only).');
  }

  const stlContent = `solid ClaudeCAD\n${triangles.join('\n')}\nendsolid ClaudeCAD\n`;
  return { stlContent, warnings };
}

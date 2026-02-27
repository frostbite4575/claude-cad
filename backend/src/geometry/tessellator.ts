import type { OpenCascadeInstance } from './oc-init.js';
import type { TessellatedMesh } from '../../../shared/index.js';

export function tessellate(oc: OpenCascadeInstance, shape: any): TessellatedMesh {
  const vertices: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const edges: number[] = [];

  // Tessellate the shape
  const mesh = new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false);

  // Extract faces (triangles)
  const faceExplorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  );

  let vertexOffset = 0;

  while (faceExplorer.More()) {
    const face = oc.TopoDS.Face_1(faceExplorer.Current());
    const location = new oc.TopLoc_Location_1();
    const triHandle = oc.BRep_Tool.Triangulation(face, location);

    if (!triHandle.IsNull()) {
      const tri = triHandle.get();
      const nbNodes = tri.NbNodes();
      const nbTriangles = tri.NbTriangles();
      const transform = location.Transformation();
      const reversed = face.Orientation_1().value === oc.TopAbs_Orientation.TopAbs_REVERSED.value;

      // Extract vertices
      for (let i = 1; i <= nbNodes; i++) {
        const node = tri.Node(i);
        const transformed = node.Transformed(transform);
        vertices.push(transformed.X(), transformed.Y(), transformed.Z());
      }

      // Extract normals if available
      if (tri.HasNormals()) {
        for (let i = 1; i <= nbNodes; i++) {
          const normal = tri.Normal(i);
          if (reversed) {
            normals.push(-normal.X(), -normal.Y(), -normal.Z());
          } else {
            normals.push(normal.X(), normal.Y(), normal.Z());
          }
        }
      }

      // Extract triangle indices (1-based → 0-based, flip winding if reversed)
      for (let i = 1; i <= nbTriangles; i++) {
        const triangle = tri.Triangle(i);
        const n1 = triangle.Value(1) - 1 + vertexOffset;
        const n2 = triangle.Value(2) - 1 + vertexOffset;
        const n3 = triangle.Value(3) - 1 + vertexOffset;
        if (reversed) {
          indices.push(n1, n3, n2);
        } else {
          indices.push(n1, n2, n3);
        }
      }

      vertexOffset += nbNodes;
    }

    location.delete();
    faceExplorer.Next();
  }

  faceExplorer.delete();

  // Extract edges — Polygon3D may be null (common for simple shapes),
  // in which case the frontend falls back to THREE.EdgesGeometry
  const edgeExplorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  );

  while (edgeExplorer.More()) {
    const edge = oc.TopoDS.Edge_1(edgeExplorer.Current());
    const location = new oc.TopLoc_Location_1();

    try {
      const polygon = oc.BRep_Tool.Polygon3D(edge, location);
      if (!polygon.IsNull()) {
        const poly = polygon.get();
        const nbNodes = poly.NbNodes();
        const transform = location.Transformation();
        const nodes = poly.Nodes();

        for (let i = 1; i < nbNodes; i++) {
          const p1 = nodes.Value(i).Transformed(transform);
          const p2 = nodes.Value(i + 1).Transformed(transform);
          edges.push(p1.X(), p1.Y(), p1.Z());
          edges.push(p2.X(), p2.Y(), p2.Z());
        }
      }
    } catch {
      // Polygon3D not available — frontend will use EdgesGeometry
    }

    location.delete();
    edgeExplorer.Next();
  }

  edgeExplorer.delete();
  mesh.delete();

  return { vertices, indices, normals, edges };
}

import type { OpenCascadeInstance } from './oc-init.js';

// --- DXF Entity Types ---

interface DxfLine {
  type: 'LINE';
  x1: number; y1: number;
  x2: number; y2: number;
}

interface DxfArc {
  type: 'ARC';
  cx: number; cy: number;
  radius: number;
  startAngle: number; // degrees
  endAngle: number;   // degrees
}

interface DxfCircle {
  type: 'CIRCLE';
  cx: number; cy: number;
  radius: number;
}

type DxfEntity = DxfLine | DxfArc | DxfCircle;

// --- Constants ---

const Z_TOLERANCE = 0.001; // inches
const POINT_TOLERANCE = 0.0001; // for deduplication
const APPROXIMATION_SEGMENTS = 32;

// --- Edge Extraction ---

/** Round to avoid floating-point noise in dedup keys */
function snap(v: number): number {
  return Math.round(v / POINT_TOLERANCE) * POINT_TOLERANCE;
}

function lineKey(x1: number, y1: number, x2: number, y2: number): string {
  // Normalize direction so (A→B) and (B→A) produce the same key
  const s1 = snap(x1), s2 = snap(y1), s3 = snap(x2), s4 = snap(y2);
  if (s1 < s3 || (s1 === s3 && s2 < s4)) {
    return `${s1},${s2},${s3},${s4}`;
  }
  return `${s3},${s4},${s1},${s2}`;
}

function arcKey(cx: number, cy: number, r: number, sa: number, ea: number): string {
  return `${snap(cx)},${snap(cy)},${snap(r)},${Math.round(sa * 100)},${Math.round(ea * 100)}`;
}

function circleKey(cx: number, cy: number, r: number): string {
  return `${snap(cx)},${snap(cy)},${snap(r)}`;
}

/**
 * Extract 2D DXF entities from an OpenCascade shape by iterating edges.
 * Projects onto XY plane (drops Z). Returns warnings for non-zero Z.
 */
export function extractEdges(oc: OpenCascadeInstance, shape: any): { entities: DxfEntity[]; warnings: string[] } {
  const entities: DxfEntity[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  let hasZWarning = false;

  const explorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  );

  while (explorer.More()) {
    const edge = oc.TopoDS.Edge_1(explorer.Current());

    try {
      const adaptor = new oc.BRepAdaptor_Curve_2(edge);
      const curveType = adaptor.GetType();
      const first = adaptor.FirstParameter();
      const last = adaptor.LastParameter();

      // Check for Z variation at endpoints
      if (!hasZWarning) {
        const p0 = adaptor.Value(first);
        const p1 = adaptor.Value(last);
        if (Math.abs(p0.Z()) > Z_TOLERANCE || Math.abs(p1.Z()) > Z_TOLERANCE) {
          hasZWarning = true;
          warnings.push('Some edges have non-zero Z coordinates. They were projected onto the XY plane.');
        }
        p0.delete();
        p1.delete();
      }

      if (curveType === oc.GeomAbs_CurveType.GeomAbs_Line) {
        const p0 = adaptor.Value(first);
        const p1 = adaptor.Value(last);
        const x1 = p0.X(), y1 = p0.Y();
        const x2 = p1.X(), y2 = p1.Y();
        p0.delete();
        p1.delete();

        // Skip zero-length lines
        const dx = x2 - x1, dy = y2 - y1;
        if (Math.sqrt(dx * dx + dy * dy) < POINT_TOLERANCE) {
          adaptor.delete();
          explorer.Next();
          continue;
        }

        const key = `L:${lineKey(x1, y1, x2, y2)}`;
        if (!seen.has(key)) {
          seen.add(key);
          entities.push({ type: 'LINE', x1, y1, x2, y2 });
        }
      } else if (curveType === oc.GeomAbs_CurveType.GeomAbs_Circle) {
        const circ = adaptor.Circle();
        const loc = circ.Location();
        const cx = loc.X(), cy = loc.Y();
        const radius = circ.Radius();

        // Full circle vs arc
        const paramRange = Math.abs(last - first);
        const isFullCircle = Math.abs(paramRange - 2 * Math.PI) < 0.001;

        if (isFullCircle) {
          const key = `C:${circleKey(cx, cy, radius)}`;
          if (!seen.has(key)) {
            seen.add(key);
            entities.push({ type: 'CIRCLE', cx, cy, radius });
          }
        } else {
          // Convert radian parameters to degrees for DXF
          // DXF arcs use counter-clockwise angles from +X axis
          let startAngle = (first * 180) / Math.PI;
          let endAngle = (last * 180) / Math.PI;

          // Check if edge is reversed — swap angles
          const orientation = edge.Orientation_1();
          if (orientation.value === oc.TopAbs_Orientation.TopAbs_REVERSED.value) {
            [startAngle, endAngle] = [endAngle, startAngle];
          }

          // Normalize to [0, 360)
          startAngle = ((startAngle % 360) + 360) % 360;
          endAngle = ((endAngle % 360) + 360) % 360;

          const key = `A:${arcKey(cx, cy, radius, startAngle, endAngle)}`;
          if (!seen.has(key)) {
            seen.add(key);
            entities.push({ type: 'ARC', cx, cy, radius, startAngle, endAngle });
          }
        }

        loc.delete();
        circ.delete();
      } else {
        // BSpline, Ellipse, etc. — approximate with line segments
        const step = (last - first) / APPROXIMATION_SEGMENTS;
        for (let i = 0; i < APPROXIMATION_SEGMENTS; i++) {
          const t0 = first + i * step;
          const t1 = first + (i + 1) * step;
          const p0 = adaptor.Value(t0);
          const p1 = adaptor.Value(t1);
          const x1 = p0.X(), y1 = p0.Y();
          const x2 = p1.X(), y2 = p1.Y();
          p0.delete();
          p1.delete();

          const dx = x2 - x1, dy = y2 - y1;
          if (Math.sqrt(dx * dx + dy * dy) < POINT_TOLERANCE) continue;

          const key = `L:${lineKey(x1, y1, x2, y2)}`;
          if (!seen.has(key)) {
            seen.add(key);
            entities.push({ type: 'LINE', x1, y1, x2, y2 });
          }
        }
      }

      adaptor.delete();
    } catch (err: any) {
      warnings.push(`Failed to extract edge: ${err.message || String(err)}`);
    }

    explorer.Next();
  }

  explorer.delete();
  return { entities, warnings };
}

// --- DXF Writer ---

function dxfGroupCode(code: number, value: string | number): string {
  const codeStr = code.toString().padStart(3, ' ');
  return `${codeStr}\n${value}\n`;
}

function writeDxfHeader(): string {
  let s = '';
  s += dxfGroupCode(0, 'SECTION');
  s += dxfGroupCode(2, 'HEADER');
  // Units: inches
  s += dxfGroupCode(9, '$INSUNITS');
  s += dxfGroupCode(70, 1); // 1 = inches
  s += dxfGroupCode(9, '$MEASUREMENT');
  s += dxfGroupCode(70, 0); // 0 = Imperial
  s += dxfGroupCode(0, 'ENDSEC');
  return s;
}

function writeDxfEntity(entity: DxfEntity, layer: string = '0'): string {
  let s = '';

  switch (entity.type) {
    case 'LINE':
      s += dxfGroupCode(0, 'LINE');
      s += dxfGroupCode(8, layer);
      s += dxfGroupCode(10, entity.x1); // start X
      s += dxfGroupCode(20, entity.y1); // start Y
      s += dxfGroupCode(30, 0);         // start Z
      s += dxfGroupCode(11, entity.x2); // end X
      s += dxfGroupCode(21, entity.y2); // end Y
      s += dxfGroupCode(31, 0);         // end Z
      break;

    case 'ARC':
      s += dxfGroupCode(0, 'ARC');
      s += dxfGroupCode(8, layer);
      s += dxfGroupCode(10, entity.cx);     // center X
      s += dxfGroupCode(20, entity.cy);     // center Y
      s += dxfGroupCode(30, 0);             // center Z
      s += dxfGroupCode(40, entity.radius); // radius
      s += dxfGroupCode(50, entity.startAngle); // start angle (degrees)
      s += dxfGroupCode(51, entity.endAngle);   // end angle (degrees)
      break;

    case 'CIRCLE':
      s += dxfGroupCode(0, 'CIRCLE');
      s += dxfGroupCode(8, layer);
      s += dxfGroupCode(10, entity.cx);
      s += dxfGroupCode(20, entity.cy);
      s += dxfGroupCode(30, 0);
      s += dxfGroupCode(40, entity.radius);
      break;
  }

  return s;
}

/** A DXF entity with an explicit layer assignment */
export interface LayeredDxfEntity {
  entity: DxfEntity;
  layer: string;
}

/** Build a complete DXF string from entities, with optional extra layered entities */
export function writeDxf(entities: DxfEntity[], extraLayered?: LayeredDxfEntity[]): string {
  let s = '';
  s += writeDxfHeader();

  // ENTITIES section
  s += dxfGroupCode(0, 'SECTION');
  s += dxfGroupCode(2, 'ENTITIES');

  for (const entity of entities) {
    s += writeDxfEntity(entity);
  }

  if (extraLayered) {
    for (const { entity, layer } of extraLayered) {
      s += writeDxfEntity(entity, layer);
    }
  }

  s += dxfGroupCode(0, 'ENDSEC');
  s += dxfGroupCode(0, 'EOF');

  return s;
}

/**
 * Generate DXF LINE entities for bend lines on a sheet metal plate.
 * Each bend line spans the full cross-dimension of the plate.
 */
export function buildBendLineDxfEntities(
  bendLines: { position: number; axis: 'X' | 'Y' }[],
  plateWidth: number,
  plateLength: number
): LayeredDxfEntity[] {
  const result: LayeredDxfEntity[] = [];
  for (const bend of bendLines) {
    let line: DxfLine;
    if (bend.axis === 'X') {
      // Bend runs along X, at Y = position
      line = { type: 'LINE', x1: 0, y1: bend.position, x2: plateWidth, y2: bend.position };
    } else {
      // Bend runs along Y, at X = position
      line = { type: 'LINE', x1: bend.position, y1: 0, x2: bend.position, y2: plateLength };
    }
    result.push({ entity: line, layer: 'BEND' });
  }
  return result;
}

// --- Top-level Export ---

export interface DxfExportResult {
  dxfContent: string;
  entityCount: number;
  warnings: string[];
}

/**
 * Export one or more OC shapes to DXF format.
 * Extracts edges, deduplicates, projects to XY, writes DXF string.
 * Optionally includes extra layered entities (e.g. bend lines on BEND layer).
 */
export function exportDxf(oc: OpenCascadeInstance, shapes: any[], extraLayered?: LayeredDxfEntity[]): DxfExportResult {
  const allEntities: DxfEntity[] = [];
  const allWarnings: string[] = [];
  const globalSeen = new Set<string>();

  for (const shape of shapes) {
    const { entities, warnings } = extractEdges(oc, shape);
    allWarnings.push(...warnings);

    // Deduplicate across shapes
    for (const entity of entities) {
      let key: string;
      switch (entity.type) {
        case 'LINE':
          key = `L:${lineKey(entity.x1, entity.y1, entity.x2, entity.y2)}`;
          break;
        case 'ARC':
          key = `A:${arcKey(entity.cx, entity.cy, entity.radius, entity.startAngle, entity.endAngle)}`;
          break;
        case 'CIRCLE':
          key = `C:${circleKey(entity.cx, entity.cy, entity.radius)}`;
          break;
      }
      if (!globalSeen.has(key)) {
        globalSeen.add(key);
        allEntities.push(entity);
      }
    }
  }

  // Deduplicate warnings
  const uniqueWarnings = [...new Set(allWarnings)];

  const dxfContent = writeDxf(allEntities, extraLayered);
  const totalCount = allEntities.length + (extraLayered?.length ?? 0);

  return {
    dxfContent,
    entityCount: totalCount,
    warnings: uniqueWarnings,
  };
}

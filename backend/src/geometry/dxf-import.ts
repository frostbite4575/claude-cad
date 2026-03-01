import type { OpenCascadeInstance } from './oc-init.js';

// --- DXF Parser Types ---

interface DxfParsedLine {
  type: 'LINE';
  layer: string;
  x1: number; y1: number;
  x2: number; y2: number;
}

interface DxfParsedArc {
  type: 'ARC';
  layer: string;
  cx: number; cy: number;
  radius: number;
  startAngle: number; // degrees
  endAngle: number;   // degrees
}

interface DxfParsedCircle {
  type: 'CIRCLE';
  layer: string;
  cx: number; cy: number;
  radius: number;
}

type DxfParsedEntity = DxfParsedLine | DxfParsedArc | DxfParsedCircle;

export interface DxfImportResult {
  entities: DxfParsedEntity[];
  layers: string[];
  warnings: string[];
  skipped: number; // count of unsupported entity types skipped
}

// --- DXF Parser ---

/**
 * Parse a DXF file string into structured entities.
 * Supports LINE, ARC, CIRCLE — the only types a plasma table needs.
 * Ignores LWPOLYLINE/POLYLINE, SPLINE, TEXT, DIMENSION, etc.
 */
export function parseDxf(content: string): DxfImportResult {
  const lines = content.split(/\r?\n/);
  const entities: DxfParsedEntity[] = [];
  const layerSet = new Set<string>();
  const warnings: string[] = [];
  let skipped = 0;

  // Find ENTITIES section
  let i = 0;
  let inEntities = false;

  while (i < lines.length) {
    const code = lines[i]?.trim();
    const value = lines[i + 1]?.trim();

    if (code === '0' && value === 'SECTION') {
      // Check if next group is ENTITIES
      if (i + 2 < lines.length && lines[i + 2]?.trim() === '2' && lines[i + 3]?.trim() === 'ENTITIES') {
        inEntities = true;
        i += 4;
        continue;
      }
    }

    if (code === '0' && value === 'ENDSEC') {
      if (inEntities) break;
    }

    if (!inEntities) {
      i += 2;
      continue;
    }

    // Parse entities within ENTITIES section
    if (code === '0') {
      const entityType = value;

      if (entityType === 'LINE') {
        const entity = parseLine(lines, i + 2);
        if (entity) {
          entities.push(entity);
          layerSet.add(entity.layer);
        }
        i = entity ? entity._endIdx : i + 2;
        continue;
      } else if (entityType === 'ARC') {
        const entity = parseArc(lines, i + 2);
        if (entity) {
          entities.push(entity);
          layerSet.add(entity.layer);
        }
        i = entity ? entity._endIdx : i + 2;
        continue;
      } else if (entityType === 'CIRCLE') {
        const entity = parseCircle(lines, i + 2);
        if (entity) {
          entities.push(entity);
          layerSet.add(entity.layer);
        }
        i = entity ? entity._endIdx : i + 2;
        continue;
      } else if (entityType === 'LWPOLYLINE' || entityType === 'POLYLINE') {
        // We can convert LWPOLYLINE to individual LINE segments
        const result = parseLwPolyline(lines, i + 2);
        if (result) {
          for (const seg of result.segments) {
            entities.push(seg);
            layerSet.add(seg.layer);
          }
          i = result._endIdx;
        } else {
          skipped++;
          i += 2;
        }
        continue;
      } else if (entityType !== 'ENDSEC' && entityType !== 'EOF') {
        skipped++;
      }
    }

    i += 2;
  }

  if (skipped > 0) {
    warnings.push(`Skipped ${skipped} unsupported entity type(s) (only LINE, ARC, CIRCLE, LWPOLYLINE are supported)`);
  }

  return {
    entities,
    layers: [...layerSet],
    warnings,
    skipped,
  };
}

// --- Individual Entity Parsers ---

function parseLine(lines: string[], startIdx: number): (DxfParsedLine & { _endIdx: number }) | null {
  let layer = '0';
  let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
  let i = startIdx;

  while (i < lines.length) {
    const code = parseInt(lines[i]?.trim() || '', 10);
    const value = lines[i + 1]?.trim() || '';

    if (code === 0) break; // next entity
    if (code === 8) layer = value;
    if (code === 10) x1 = parseFloat(value);
    if (code === 20) y1 = parseFloat(value);
    if (code === 11) x2 = parseFloat(value);
    if (code === 21) y2 = parseFloat(value);

    i += 2;
  }

  return { type: 'LINE', layer, x1, y1, x2, y2, _endIdx: i };
}

function parseArc(lines: string[], startIdx: number): (DxfParsedArc & { _endIdx: number }) | null {
  let layer = '0';
  let cx = 0, cy = 0, radius = 0, startAngle = 0, endAngle = 360;
  let i = startIdx;

  while (i < lines.length) {
    const code = parseInt(lines[i]?.trim() || '', 10);
    const value = lines[i + 1]?.trim() || '';

    if (code === 0) break;
    if (code === 8) layer = value;
    if (code === 10) cx = parseFloat(value);
    if (code === 20) cy = parseFloat(value);
    if (code === 40) radius = parseFloat(value);
    if (code === 50) startAngle = parseFloat(value);
    if (code === 51) endAngle = parseFloat(value);

    i += 2;
  }

  return { type: 'ARC', layer, cx, cy, radius, startAngle, endAngle, _endIdx: i };
}

function parseCircle(lines: string[], startIdx: number): (DxfParsedCircle & { _endIdx: number }) | null {
  let layer = '0';
  let cx = 0, cy = 0, radius = 0;
  let i = startIdx;

  while (i < lines.length) {
    const code = parseInt(lines[i]?.trim() || '', 10);
    const value = lines[i + 1]?.trim() || '';

    if (code === 0) break;
    if (code === 8) layer = value;
    if (code === 10) cx = parseFloat(value);
    if (code === 20) cy = parseFloat(value);
    if (code === 40) radius = parseFloat(value);

    i += 2;
  }

  return { type: 'CIRCLE', layer, cx, cy, radius, _endIdx: i };
}

function parseLwPolyline(lines: string[], startIdx: number): { segments: DxfParsedLine[]; _endIdx: number } | null {
  let layer = '0';
  let closed = false;
  const vertices: { x: number; y: number }[] = [];
  let i = startIdx;
  let currentX = 0, currentY = 0;
  let hasX = false;

  while (i < lines.length) {
    const code = parseInt(lines[i]?.trim() || '', 10);
    const value = lines[i + 1]?.trim() || '';

    if (code === 0) break; // next entity
    if (code === 8) layer = value;
    if (code === 70) closed = (parseInt(value) & 1) === 1;
    if (code === 10) {
      if (hasX) {
        // Push previous vertex before starting new one
        vertices.push({ x: currentX, y: currentY });
      }
      currentX = parseFloat(value);
      hasX = true;
    }
    if (code === 20) {
      currentY = parseFloat(value);
    }

    i += 2;
  }

  // Push last vertex
  if (hasX) {
    vertices.push({ x: currentX, y: currentY });
  }

  if (vertices.length < 2) return null;

  const segments: DxfParsedLine[] = [];
  const count = closed ? vertices.length : vertices.length - 1;
  for (let j = 0; j < count; j++) {
    const next = (j + 1) % vertices.length;
    segments.push({
      type: 'LINE',
      layer,
      x1: vertices[j].x,
      y1: vertices[j].y,
      x2: vertices[next].x,
      y2: vertices[next].y,
    });
  }

  return { segments, _endIdx: i };
}

// --- Convert parsed entities to OC shapes ---

/**
 * Convert parsed DXF entities into OpenCascade shapes.
 * Returns a compound of all edges/faces, grouped by layer.
 */
export function dxfToShapes(
  oc: OpenCascadeInstance,
  parsed: DxfImportResult,
  layerFilter?: string
): { shape: any; entityCount: number } {
  const compound = new oc.TopoDS_Compound();
  const builder = new oc.BRep_Builder();
  builder.MakeCompound(compound);

  let count = 0;

  for (const entity of parsed.entities) {
    if (layerFilter && entity.layer !== layerFilter) continue;

    try {
      let edge: any;

      switch (entity.type) {
        case 'LINE': {
          const p1 = new oc.gp_Pnt_3(entity.x1, entity.y1, 0);
          const p2 = new oc.gp_Pnt_3(entity.x2, entity.y2, 0);
          const edgeMaker = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
          edge = edgeMaker.Edge();
          edgeMaker.delete();
          p1.delete();
          p2.delete();
          break;
        }
        case 'CIRCLE': {
          const center = new oc.gp_Pnt_3(entity.cx, entity.cy, 0);
          const dir = new oc.gp_Dir_4(0, 0, 1);
          const ax2 = new oc.gp_Ax2_3(center, dir);
          const circ = new oc.gp_Circ_2(ax2, entity.radius);
          const edgeMaker = new oc.BRepBuilderAPI_MakeEdge_8(circ);
          edge = edgeMaker.Edge();
          edgeMaker.delete();
          circ.delete();
          ax2.delete();
          dir.delete();
          center.delete();
          break;
        }
        case 'ARC': {
          const center = new oc.gp_Pnt_3(entity.cx, entity.cy, 0);
          const dir = new oc.gp_Dir_4(0, 0, 1);
          const ax2 = new oc.gp_Ax2_3(center, dir);
          const circ = new oc.gp_Circ_2(ax2, entity.radius);
          const startRad = (entity.startAngle * Math.PI) / 180;
          const endRad = (entity.endAngle * Math.PI) / 180;
          const edgeMaker = new oc.BRepBuilderAPI_MakeEdge_9(circ, startRad, endRad);
          edge = edgeMaker.Edge();
          edgeMaker.delete();
          circ.delete();
          ax2.delete();
          dir.delete();
          center.delete();
          break;
        }
      }

      if (edge) {
        builder.Add(compound, edge);
        count++;
      }
    } catch {
      // Skip individual entity on error
    }
  }

  return { shape: compound, entityCount: count };
}

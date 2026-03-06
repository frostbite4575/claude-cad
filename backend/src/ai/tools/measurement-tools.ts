import type { Tool } from '@anthropic-ai/sdk/resources/messages.js';
import type { DocumentState } from '../../state/document-state.js';
import { getOC } from '../../geometry/oc-init.js';
import { countEdges } from '../../geometry/fillets.js';
import { fail, ok } from './validate.js';

export const measurementToolDefs: Tool[] = [
  {
    name: 'measure_distance',
    description: 'Measure the distance between two 3D points. Returns the straight-line distance.',
    input_schema: {
      type: 'object' as const,
      properties: {
        x1: { type: 'number', description: 'First point X' },
        y1: { type: 'number', description: 'First point Y' },
        z1: { type: 'number', description: 'First point Z (default 0)', default: 0 },
        x2: { type: 'number', description: 'Second point X' },
        y2: { type: 'number', description: 'Second point Y' },
        z2: { type: 'number', description: 'Second point Z (default 0)', default: 0 },
      },
      required: ['x1', 'y1', 'x2', 'y2'],
    },
  },
  {
    name: 'measure_entity',
    description: 'Measure properties of an entity: bounding box dimensions, surface area, volume, and total edge length.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to measure' },
      },
      required: ['entity_id'],
    },
  },
  {
    name: 'get_edge_count',
    description: 'Get the number of edges on a shape. Useful for determining edge indices for selective fillet/chamfer.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to count edges on' },
      },
      required: ['entity_id'],
    },
  },
];

export function executeMeasurementTools(
  toolName: string,
  input: Record<string, any>,
  state: DocumentState
): string | null {
  const oc = getOC();

  switch (toolName) {
    case 'measure_distance': {
      const x1 = input.x1 ?? 0, y1 = input.y1 ?? 0, z1 = input.z1 ?? 0;
      const x2 = input.x2 ?? 0, y2 = input.y2 ?? 0, z2 = input.z2 ?? 0;
      const dx = (x2 as number) - (x1 as number);
      const dy = (y2 as number) - (y1 as number);
      const dz = (z2 as number) - (z1 as number);
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const rounded = Math.round(dist * 10000) / 10000;
      return ok({
        distance: rounded,
        dx: Math.round(Math.abs(dx) * 10000) / 10000,
        dy: Math.round(Math.abs(dy) * 10000) / 10000,
        dz: Math.round(Math.abs(dz) * 10000) / 10000,
        description: `Distance from (${x1}, ${y1}, ${z1}) to (${x2}, ${y2}, ${z2}) = ${rounded}" (ΔX=${Math.abs(dx as number).toFixed(4)}", ΔY=${Math.abs(dy as number).toFixed(4)}", ΔZ=${Math.abs(dz as number).toFixed(4)}")`,
      });
    }

    case 'measure_entity': {
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);

      const measurements: Record<string, any> = { entity_id: input.entity_id, name: e.name };

      try {
        const bbox = new oc.Bnd_Box_1();
        oc.BRepBndLib.Add(e.shape, bbox, false);
        const bMin = bbox.CornerMin();
        const bMax = bbox.CornerMax();
        measurements.width = Math.round((bMax.X() - bMin.X()) * 10000) / 10000;
        measurements.height = Math.round((bMax.Y() - bMin.Y()) * 10000) / 10000;
        measurements.depth = Math.round((bMax.Z() - bMin.Z()) * 10000) / 10000;
        bMin.delete(); bMax.delete(); bbox.delete();
      } catch { /* skip */ }

      try {
        const surfProps = new oc.GProp_GProps_1();
        oc.BRepGProp.SurfaceProperties_1(e.shape, surfProps, false);
        measurements.surfaceArea = Math.round(surfProps.Mass() * 10000) / 10000;
        surfProps.delete();
      } catch { /* skip */ }

      try {
        const volProps = new oc.GProp_GProps_1();
        oc.BRepGProp.VolumeProperties_1(e.shape, volProps, false);
        measurements.volume = Math.round(volProps.Mass() * 10000) / 10000;
        volProps.delete();
      } catch { /* skip */ }

      try {
        const linProps = new oc.GProp_GProps_1();
        oc.BRepGProp.LinearProperties(e.shape, linProps, false);
        measurements.edgeLength = Math.round(linProps.Mass() * 10000) / 10000;
        linProps.delete();
      } catch { /* skip */ }

      try {
        measurements.edgeCount = countEdges(oc, e.shape);
      } catch { /* skip */ }

      const parts: string[] = [];
      if (measurements.width !== undefined) parts.push(`${measurements.width}" × ${measurements.height}" × ${measurements.depth}" (W×H×D)`);
      if (measurements.surfaceArea !== undefined) parts.push(`surface area = ${measurements.surfaceArea} sq in`);
      if (measurements.volume !== undefined) parts.push(`volume = ${measurements.volume} cu in`);
      if (measurements.edgeLength !== undefined) parts.push(`cut length = ${measurements.edgeLength}"`);
      if (measurements.edgeCount !== undefined) parts.push(`${measurements.edgeCount} edges`);

      return ok({
        ...measurements,
        description: `${e.name} (${input.entity_id}): ${parts.join(', ')}`,
      });
    }

    case 'get_edge_count': {
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);
      const count = countEdges(oc, e.shape);
      return ok({
        entity_id: input.entity_id,
        edge_count: count,
        description: `${e.name} (${input.entity_id}) has ${count} edges.`,
      });
    }

    default:
      return null;
  }
}

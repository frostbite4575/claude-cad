import type { Tool } from '@anthropic-ai/sdk/resources/messages.js';
import type { DocumentState } from '../../state/document-state.js';
import { getOC } from '../../geometry/oc-init.js';
import { createSketchLine, createSketchRectangle, createSketchCircle, createSketchArc, createFlatProfile, transformToPlane } from '../../geometry/sketches.js';
import type { SketchPlane } from '../../geometry/sketches.js';
import { validatePositive, validateNumeric, validateEnum, fail, ok } from './validate.js';

const VALID_PLANES = ['XY', 'XZ', 'YZ'];

export const sketchToolDefs: Tool[] = [
  {
    name: 'sketch_line',
    description: 'Draw a 2D line segment. Open geometry — cannot be extruded. Coordinates in the sketch plane\'s 2D coordinate system.',
    input_schema: {
      type: 'object' as const,
      properties: {
        x1: { type: 'number', description: 'Start X' },
        y1: { type: 'number', description: 'Start Y' },
        x2: { type: 'number', description: 'End X' },
        y2: { type: 'number', description: 'End Y' },
        z: { type: 'number', description: 'Z offset (default 0)' },
        plane: { type: 'string', enum: ['XY', 'XZ', 'YZ'], description: 'Sketch plane (default XY)' },
      },
      required: ['x1', 'y1', 'x2', 'y2'],
    },
  },
  {
    name: 'sketch_rectangle',
    description: 'Draw a 2D rectangle. Creates a closed face that can be extruded into a solid. (x, y) is the bottom-left corner.',
    input_schema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number', description: 'Corner X' },
        y: { type: 'number', description: 'Corner Y' },
        width: { type: 'number', description: 'Width (along X)' },
        height: { type: 'number', description: 'Height (along Y)' },
        z: { type: 'number', description: 'Z offset (default 0)' },
        plane: { type: 'string', enum: ['XY', 'XZ', 'YZ'], description: 'Sketch plane (default XY)' },
      },
      required: ['x', 'y', 'width', 'height'],
    },
  },
  {
    name: 'sketch_circle',
    description: 'Draw a 2D circle. Creates a closed face that can be extruded into a solid.',
    input_schema: {
      type: 'object' as const,
      properties: {
        center_x: { type: 'number', description: 'Center X' },
        center_y: { type: 'number', description: 'Center Y' },
        radius: { type: 'number', description: 'Radius' },
        z: { type: 'number', description: 'Z offset (default 0)' },
        plane: { type: 'string', enum: ['XY', 'XZ', 'YZ'], description: 'Sketch plane (default XY)' },
      },
      required: ['center_x', 'center_y', 'radius'],
    },
  },
  {
    name: 'sketch_arc',
    description: 'Draw a 2D arc. Open geometry — cannot be extruded. Angles in degrees, measured counter-clockwise from the +X axis.',
    input_schema: {
      type: 'object' as const,
      properties: {
        center_x: { type: 'number', description: 'Center X' },
        center_y: { type: 'number', description: 'Center Y' },
        radius: { type: 'number', description: 'Radius' },
        start_angle: { type: 'number', description: 'Start angle in degrees' },
        end_angle: { type: 'number', description: 'End angle in degrees' },
        z: { type: 'number', description: 'Z offset (default 0)' },
        plane: { type: 'string', enum: ['XY', 'XZ', 'YZ'], description: 'Sketch plane (default XY)' },
      },
      required: ['center_x', 'center_y', 'radius', 'start_angle', 'end_angle'],
    },
  },
  {
    name: 'sketch_line_relative',
    description: 'Draw a line from a start point using relative offsets (dx, dy). Useful for chain drawing. Open geometry.',
    input_schema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number', description: 'Start X' },
        y: { type: 'number', description: 'Start Y' },
        dx: { type: 'number', description: 'Relative X offset' },
        dy: { type: 'number', description: 'Relative Y offset' },
        z: { type: 'number', description: 'Z plane (default 0)' },
      },
      required: ['x', 'y', 'dx', 'dy'],
    },
  },
  {
    name: 'sketch_polyline',
    description: 'Draw a connected chain of line segments from an array of points. If "closed" is true, last point connects back to first and creates a face (extrudable). Great for complex profiles.',
    input_schema: {
      type: 'object' as const,
      properties: {
        points: {
          type: 'array',
          items: {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' } },
            required: ['x', 'y'],
          },
          description: 'Array of {x, y} points. Minimum 2 for open, 3 for closed.',
        },
        closed: { type: 'boolean', description: 'If true, close the loop and create a face (default false)' },
        z: { type: 'number', description: 'Z plane (default 0)' },
      },
      required: ['points'],
    },
  },
  {
    name: 'create_flat_profile',
    description: 'Create a closed 2D flat profile from an array of {x, y} points. The profile is a face on the XY plane that can be extruded or exported directly to DXF. Minimum 3 points.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Name for the profile (e.g. "bracket", "gusset")' },
        points: {
          type: 'array',
          items: {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' } },
            required: ['x', 'y'],
          },
          description: 'Array of {x, y} points defining the profile outline. Minimum 3 points.',
        },
        z: { type: 'number', description: 'Z plane (default 0)' },
      },
      required: ['points'],
    },
  },
];

export function executeSketchTools(
  toolName: string,
  input: Record<string, any>,
  state: DocumentState
): string | null {
  const oc = getOC();

  switch (toolName) {
    case 'sketch_line': {
      const numErr = validateNumeric(input, 'x1', 'y1', 'x2', 'y2');
      if (numErr) return fail(numErr);
      if (input.x1 === input.x2 && input.y1 === input.y2) return fail('Line start and end points are identical.');
      const plane = (input.plane as SketchPlane) || 'XY';
      if (input.plane) { const pe = validateEnum(input.plane, VALID_PLANES, 'plane'); if (pe) return fail(pe); }
      let shape = createSketchLine(oc, input.x1, input.y1, input.x2, input.y2, input.z ?? 0);
      shape = transformToPlane(oc, shape, plane);
      const entity = state.addEntity(
        `Line (${input.x1},${input.y1})→(${input.x2},${input.y2})`,
        'sketch_line',
        shape,
        { entityKind: 'sketch', plane }
      );
      return ok({
        entity_id: entity.id,
        description: `Created line from (${input.x1}, ${input.y1}) to (${input.x2}, ${input.y2}) on ${plane} plane as ${entity.id}. Open geometry — cannot be extruded.`,
      });
    }

    case 'sketch_rectangle': {
      const numErr = validateNumeric(input, 'x', 'y');
      if (numErr) return fail(numErr);
      const err = validatePositive(input, 'width', 'height');
      if (err) return fail(err);
      const plane = (input.plane as SketchPlane) || 'XY';
      if (input.plane) { const pe = validateEnum(input.plane, VALID_PLANES, 'plane'); if (pe) return fail(pe); }
      let shape = createSketchRectangle(oc, input.x, input.y, input.width, input.height, input.z ?? 0);
      shape = transformToPlane(oc, shape, plane);
      const entity = state.addEntity(
        `Rectangle ${input.width}×${input.height} at (${input.x},${input.y})`,
        'sketch_rectangle',
        shape,
        { entityKind: 'sketch', plane }
      );
      return ok({
        entity_id: entity.id,
        description: `Created ${input.width}" × ${input.height}" rectangle at (${input.x}, ${input.y}) on ${plane} plane as ${entity.id}. Closed face — can be extruded.`,
      });
    }

    case 'sketch_circle': {
      const numErr = validateNumeric(input, 'center_x', 'center_y');
      if (numErr) return fail(numErr);
      const err = validatePositive(input, 'radius');
      if (err) return fail(err);
      const plane = (input.plane as SketchPlane) || 'XY';
      if (input.plane) { const pe = validateEnum(input.plane, VALID_PLANES, 'plane'); if (pe) return fail(pe); }
      let shape = createSketchCircle(oc, input.center_x, input.center_y, input.radius, input.z ?? 0);
      shape = transformToPlane(oc, shape, plane);
      const entity = state.addEntity(
        `Circle r=${input.radius} at (${input.center_x},${input.center_y})`,
        'sketch_circle',
        shape,
        { entityKind: 'sketch', plane }
      );
      return ok({
        entity_id: entity.id,
        description: `Created circle radius ${input.radius}" at (${input.center_x}, ${input.center_y}) on ${plane} plane as ${entity.id}. Closed face — can be extruded.`,
      });
    }

    case 'sketch_arc': {
      const numErr = validateNumeric(input, 'center_x', 'center_y', 'start_angle', 'end_angle');
      if (numErr) return fail(numErr);
      const posErr = validatePositive(input, 'radius');
      if (posErr) return fail(posErr);
      if (input.start_angle === input.end_angle) return fail('Arc start and end angles must be different.');
      const plane = (input.plane as SketchPlane) || 'XY';
      if (input.plane) { const pe = validateEnum(input.plane, VALID_PLANES, 'plane'); if (pe) return fail(pe); }
      let shape = createSketchArc(oc, input.center_x, input.center_y, input.radius, input.start_angle, input.end_angle, input.z ?? 0);
      shape = transformToPlane(oc, shape, plane);
      const entity = state.addEntity(
        `Arc r=${input.radius} ${input.start_angle}°–${input.end_angle}°`,
        'sketch_arc',
        shape,
        { entityKind: 'sketch', plane }
      );
      return ok({
        entity_id: entity.id,
        description: `Created arc radius ${input.radius}" from ${input.start_angle}° to ${input.end_angle}° at (${input.center_x}, ${input.center_y}) on ${plane} plane as ${entity.id}. Open geometry — cannot be extruded.`,
      });
    }

    case 'sketch_line_relative': {
      const numErr = validateNumeric(input, 'x', 'y', 'dx', 'dy');
      if (numErr) return fail(numErr);
      if (input.dx === 0 && input.dy === 0) return fail('Line offset (dx, dy) cannot both be zero.');
      const x = input.x as number;
      const y = input.y as number;
      const dx = input.dx as number;
      const dy = input.dy as number;
      const z = (input.z ?? 0) as number;
      const shape = createSketchLine(oc, x, y, x + dx, y + dy, z);
      const entity = state.addEntity(
        `Line (${x},${y})→(${x + dx},${y + dy})`,
        'sketch_line',
        shape,
        { entityKind: 'sketch' }
      );
      return ok({
        entity_id: entity.id,
        end_point: { x: x + dx, y: y + dy },
        description: `Created line from (${x}, ${y}) to (${x + dx}, ${y + dy}) [dx=${dx}, dy=${dy}] as ${entity.id}. End point: (${x + dx}, ${y + dy}).`,
      });
    }

    case 'sketch_polyline': {
      const pts = input.points as { x: number; y: number }[];
      const closed = input.closed as boolean ?? false;
      const z = (input.z ?? 0) as number;

      if (!pts || pts.length < 2) return fail('Polyline requires at least 2 points');
      if (closed && pts.length < 3) return fail('Closed polyline requires at least 3 points');

      if (closed) {
        const shape = createFlatProfile(oc, pts, z);
        const entity = state.addEntity(
          `Profile (${pts.length} pts)`,
          'flat_profile',
          shape,
          { entityKind: 'sketch' }
        );
        return ok({
          entity_id: entity.id,
          point_count: pts.length,
          description: `Created closed ${pts.length}-point profile as ${entity.id}. Closed face — can be extruded or exported to DXF.`,
        });
      } else {
        const compound = new oc.TopoDS_Compound();
        const builder = new oc.BRep_Builder();
        builder.MakeCompound(compound);

        for (let i = 0; i < pts.length - 1; i++) {
          const edge = createSketchLine(oc, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, z);
          builder.Add(compound, edge);
        }

        const entity = state.addEntity(
          `Polyline (${pts.length} pts)`,
          'sketch_polyline',
          compound,
          { entityKind: 'sketch' }
        );
        return ok({
          entity_id: entity.id,
          point_count: pts.length,
          segment_count: pts.length - 1,
          description: `Created open polyline with ${pts.length} points (${pts.length - 1} segments) as ${entity.id}. Open geometry — cannot be extruded.`,
        });
      }
    }

    case 'create_flat_profile': {
      const pts = input.points as { x: number; y: number }[];
      const z = (input.z ?? 0) as number;
      const profileName = (input.name as string) || 'flat profile';

      if (!pts || pts.length < 3) return fail('Flat profile requires at least 3 points');

      const shape = createFlatProfile(oc, pts, z);
      const entity = state.addEntity(
        profileName,
        'flat_profile',
        shape,
        { entityKind: 'sketch' }
      );
      return ok({
        entity_id: entity.id,
        point_count: pts.length,
        description: `Created "${profileName}" flat profile with ${pts.length} points as ${entity.id}. Closed face — can be extruded into 3D or exported directly to DXF.`,
      });
    }

    default:
      return null;
  }
}

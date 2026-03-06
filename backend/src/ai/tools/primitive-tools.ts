import type { Tool } from '@anthropic-ai/sdk/resources/messages.js';
import type { DocumentState } from '../../state/document-state.js';
import { getOC } from '../../geometry/oc-init.js';
import { createBox, createCylinder, createSphere, createPolygonExtrusion } from '../../geometry/primitives.js';
import { validatePositive, fail, ok } from './validate.js';

export const primitiveToolDefs: Tool[] = [
  {
    name: 'create_box',
    description: 'Create a rectangular box. All dimensions in document units. Returns the new entity ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        width: { type: 'number', description: 'Width (X)' },
        height: { type: 'number', description: 'Height (Y)' },
        depth: { type: 'number', description: 'Depth (Z)' },
      },
      required: ['width', 'height', 'depth'],
    },
  },
  {
    name: 'create_cylinder',
    description: 'Create a cylinder. All dimensions in document units. Returns the new entity ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        radius: { type: 'number', description: 'Radius' },
        height: { type: 'number', description: 'Height' },
      },
      required: ['radius', 'height'],
    },
  },
  {
    name: 'create_sphere',
    description: 'Create a sphere. Dimension in document units. Returns the new entity ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        radius: { type: 'number', description: 'Radius' },
      },
      required: ['radius'],
    },
  },
  {
    name: 'create_polygon',
    description: 'Create an extruded solid from a 2D polygon. Provide a list of [x, y] vertex coordinates defining the polygon outline on the XY plane, and a height to extrude along Z. Use this for triangles, pentagons, L-shapes, or any custom 2D profile.',
    input_schema: {
      type: 'object' as const,
      properties: {
        points: {
          type: 'array',
          items: {
            type: 'array',
            items: { type: 'number' },
            minItems: 2,
            maxItems: 2,
          },
          description: 'Array of [x, y] vertex coordinates, in order. The polygon is automatically closed.',
          minItems: 3,
        },
        height: { type: 'number', description: 'Extrusion height along Z' },
      },
      required: ['points', 'height'],
    },
  },
];

export function executePrimitiveTools(
  toolName: string,
  input: Record<string, any>,
  state: DocumentState
): string | null {
  const oc = getOC();

  switch (toolName) {
    case 'create_box': {
      const err = validatePositive(input, 'width', 'height', 'depth');
      if (err) return fail(err);
      const shape = createBox(oc, input.width, input.height, input.depth);
      const entity = state.addEntity(
        `Box ${input.width}x${input.height}x${input.depth}`,
        'box',
        shape
      );
      return ok({
        entity_id: entity.id,
        description: `Created box ${input.width}" × ${input.height}" × ${input.depth}" as ${entity.id}`,
      });
    }

    case 'create_cylinder': {
      const err = validatePositive(input, 'radius', 'height');
      if (err) return fail(err);
      const shape = createCylinder(oc, input.radius, input.height);
      const entity = state.addEntity(
        `Cylinder r=${input.radius} h=${input.height}`,
        'cylinder',
        shape
      );
      return ok({
        entity_id: entity.id,
        description: `Created cylinder radius ${input.radius}", height ${input.height}" as ${entity.id}`,
      });
    }

    case 'create_sphere': {
      const err = validatePositive(input, 'radius');
      if (err) return fail(err);
      const shape = createSphere(oc, input.radius);
      const entity = state.addEntity(
        `Sphere r=${input.radius}`,
        'sphere',
        shape
      );
      return ok({
        entity_id: entity.id,
        description: `Created sphere radius ${input.radius}" as ${entity.id}`,
      });
    }

    case 'create_polygon': {
      const points = input.points as [number, number][];
      if (!points || points.length < 3) return fail('Polygon requires at least 3 points');
      const err = validatePositive(input, 'height');
      if (err) return fail(err);
      const shape = createPolygonExtrusion(oc, points, input.height);
      const pointsDesc = points.map(([x, y]) => `(${x},${y})`).join(' → ');
      const entity = state.addEntity(
        `Polygon ${points.length}-sided h=${input.height}`,
        'polygon',
        shape
      );
      return ok({
        entity_id: entity.id,
        description: `Created ${points.length}-sided polygon extruded ${input.height}" as ${entity.id}. Vertices: ${pointsDesc}`,
      });
    }

    default:
      return null;
  }
}

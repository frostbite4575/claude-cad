import type { Tool } from '@anthropic-ai/sdk/resources/messages.js';
import type { DocumentState } from '../state/document-state.js';
import { getOC } from '../geometry/oc-init.js';
import { createBox, createCylinder, createSphere, createPolygonExtrusion } from '../geometry/primitives.js';
import { booleanUnion, booleanSubtract, booleanIntersect } from '../geometry/booleans.js';
import { translateShape, rotateShape } from '../geometry/transforms.js';
import { exportDxf } from '../geometry/dxf-export.js';
import { exportStep } from '../geometry/step-export.js';
import { filletAllEdges, chamferAllEdges } from '../geometry/fillets.js';
import type { UndoRedoManager } from '../state/undo-redo.js';

export const cadTools: Tool[] = [
  {
    name: 'create_box',
    description: 'Create a rectangular box. All dimensions in inches. Returns the new entity ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        width: { type: 'number', description: 'Width (X) in inches' },
        height: { type: 'number', description: 'Height (Y) in inches' },
        depth: { type: 'number', description: 'Depth (Z) in inches' },
      },
      required: ['width', 'height', 'depth'],
    },
  },
  {
    name: 'create_cylinder',
    description: 'Create a cylinder. All dimensions in inches. Returns the new entity ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        radius: { type: 'number', description: 'Radius in inches' },
        height: { type: 'number', description: 'Height in inches' },
      },
      required: ['radius', 'height'],
    },
  },
  {
    name: 'create_sphere',
    description: 'Create a sphere. Dimension in inches. Returns the new entity ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        radius: { type: 'number', description: 'Radius in inches' },
      },
      required: ['radius'],
    },
  },
  {
    name: 'create_polygon',
    description: 'Create an extruded solid from a 2D polygon. Provide a list of [x, y] vertex coordinates (in inches) defining the polygon outline on the XY plane, and a height to extrude along Z. Use this for triangles, pentagons, L-shapes, or any custom 2D profile.',
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
          description: 'Array of [x, y] vertex coordinates in inches, in order. The polygon is automatically closed.',
          minItems: 3,
        },
        height: { type: 'number', description: 'Extrusion height along Z in inches' },
      },
      required: ['points', 'height'],
    },
  },
  {
    name: 'boolean_union',
    description: 'Fuse two shapes together into one. Removes the originals and creates a new entity.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id_1: { type: 'string', description: 'First entity ID' },
        entity_id_2: { type: 'string', description: 'Second entity ID' },
      },
      required: ['entity_id_1', 'entity_id_2'],
    },
  },
  {
    name: 'boolean_subtract',
    description: 'Cut entity_id_2 from entity_id_1. Removes the originals and creates a new entity.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id_1: { type: 'string', description: 'Entity to cut from (base)' },
        entity_id_2: { type: 'string', description: 'Entity to cut away (tool)' },
      },
      required: ['entity_id_1', 'entity_id_2'],
    },
  },
  {
    name: 'boolean_intersect',
    description: 'Keep only the intersection of two shapes. Removes the originals and creates a new entity.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id_1: { type: 'string', description: 'First entity ID' },
        entity_id_2: { type: 'string', description: 'Second entity ID' },
      },
      required: ['entity_id_1', 'entity_id_2'],
    },
  },
  {
    name: 'translate',
    description: 'Move an entity to a new position. Coordinates in inches.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to move' },
        x: { type: 'number', description: 'X translation in inches' },
        y: { type: 'number', description: 'Y translation in inches' },
        z: { type: 'number', description: 'Z translation in inches' },
      },
      required: ['entity_id', 'x', 'y', 'z'],
    },
  },
  {
    name: 'rotate',
    description: 'Rotate an entity around an axis through the origin.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to rotate' },
        axis_x: { type: 'number', description: 'Rotation axis X component' },
        axis_y: { type: 'number', description: 'Rotation axis Y component' },
        axis_z: { type: 'number', description: 'Rotation axis Z component' },
        angle_deg: { type: 'number', description: 'Rotation angle in degrees' },
      },
      required: ['entity_id', 'axis_x', 'axis_y', 'axis_z', 'angle_deg'],
    },
  },
  {
    name: 'get_scene_info',
    description: 'List all entities currently in the scene with their IDs, names, types, and bounding boxes.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'delete_entity',
    description: 'Remove an entity from the scene.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to delete' },
      },
      required: ['entity_id'],
    },
  },
  {
    name: 'fillet',
    description: 'Round (fillet) all edges of a shape with a constant radius. Useful for removing sharp corners. Radius must be small enough to fit the geometry.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to fillet' },
        radius: { type: 'number', description: 'Fillet radius in inches' },
      },
      required: ['entity_id', 'radius'],
    },
  },
  {
    name: 'chamfer',
    description: 'Bevel (chamfer) all edges of a shape with a constant distance. Creates flat angled cuts at edges instead of rounds.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to chamfer' },
        distance: { type: 'number', description: 'Chamfer distance in inches' },
      },
      required: ['entity_id', 'distance'],
    },
  },
  {
    name: 'export_dxf',
    description: 'Export the scene (or a single entity) as a DXF file for plasma cutting. Returns a download URL. DXF output contains only lines, arcs, and circles (no splines) projected onto the XY plane, in inches.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Optional entity ID to export. If omitted, exports all entities.' },
      },
      required: [],
    },
  },
  {
    name: 'export_step',
    description: 'Export the scene (or a single entity) as a STEP file for interchange with other CAD software (SolidWorks, Fusion 360, FreeCAD, etc.). Returns a download URL. STEP preserves full 3D geometry including curves and surfaces.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Optional entity ID to export. If omitted, exports all entities.' },
      },
      required: [],
    },
  },
  {
    name: 'undo',
    description: 'Undo the last state-changing operation. Use when you made a mistake or the user asks to undo.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'redo',
    description: 'Redo the last undone operation. Use when the user asks to redo.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

export function executeTool(
  state: DocumentState,
  toolName: string,
  input: Record<string, any>,
  undoManager?: UndoRedoManager
): string {
  const oc = getOC();

  try {
    switch (toolName) {
      case 'create_box': {
        const shape = createBox(oc, input.width, input.height, input.depth);
        const entity = state.addEntity(
          `Box ${input.width}x${input.height}x${input.depth}`,
          'box',
          shape
        );
        return JSON.stringify({
          success: true,
          entity_id: entity.id,
          description: `Created box ${input.width}" × ${input.height}" × ${input.depth}" as ${entity.id}`,
        });
      }

      case 'create_cylinder': {
        const shape = createCylinder(oc, input.radius, input.height);
        const entity = state.addEntity(
          `Cylinder r=${input.radius} h=${input.height}`,
          'cylinder',
          shape
        );
        return JSON.stringify({
          success: true,
          entity_id: entity.id,
          description: `Created cylinder radius ${input.radius}", height ${input.height}" as ${entity.id}`,
        });
      }

      case 'create_sphere': {
        const shape = createSphere(oc, input.radius);
        const entity = state.addEntity(
          `Sphere r=${input.radius}`,
          'sphere',
          shape
        );
        return JSON.stringify({
          success: true,
          entity_id: entity.id,
          description: `Created sphere radius ${input.radius}" as ${entity.id}`,
        });
      }

      case 'create_polygon': {
        const points = input.points as [number, number][];
        const shape = createPolygonExtrusion(oc, points, input.height);
        const pointsDesc = points.map(([x, y]) => `(${x},${y})`).join(' → ');
        const entity = state.addEntity(
          `Polygon ${points.length}-sided h=${input.height}`,
          'polygon',
          shape
        );
        return JSON.stringify({
          success: true,
          entity_id: entity.id,
          description: `Created ${points.length}-sided polygon extruded ${input.height}" as ${entity.id}. Vertices: ${pointsDesc}`,
        });
      }

      case 'boolean_union': {
        const e1 = state.getEntity(input.entity_id_1);
        const e2 = state.getEntity(input.entity_id_2);
        if (!e1 || !e2) {
          return JSON.stringify({ success: false, error: 'One or both entity IDs not found' });
        }
        const result = booleanUnion(oc, e1.shape, e2.shape);
        state.removeEntity(input.entity_id_1);
        state.removeEntity(input.entity_id_2);
        const entity = state.addEntity(`Union of ${input.entity_id_1} + ${input.entity_id_2}`, 'union', result);
        return JSON.stringify({
          success: true,
          entity_id: entity.id,
          description: `Fused ${input.entity_id_1} and ${input.entity_id_2} into ${entity.id}`,
        });
      }

      case 'boolean_subtract': {
        const e1 = state.getEntity(input.entity_id_1);
        const e2 = state.getEntity(input.entity_id_2);
        if (!e1 || !e2) {
          return JSON.stringify({ success: false, error: 'One or both entity IDs not found' });
        }
        const result = booleanSubtract(oc, e1.shape, e2.shape);
        state.removeEntity(input.entity_id_1);
        state.removeEntity(input.entity_id_2);
        const entity = state.addEntity(`${input.entity_id_1} − ${input.entity_id_2}`, 'cut', result);
        return JSON.stringify({
          success: true,
          entity_id: entity.id,
          description: `Subtracted ${input.entity_id_2} from ${input.entity_id_1}, result is ${entity.id}`,
        });
      }

      case 'boolean_intersect': {
        const e1 = state.getEntity(input.entity_id_1);
        const e2 = state.getEntity(input.entity_id_2);
        if (!e1 || !e2) {
          return JSON.stringify({ success: false, error: 'One or both entity IDs not found' });
        }
        const result = booleanIntersect(oc, e1.shape, e2.shape);
        state.removeEntity(input.entity_id_1);
        state.removeEntity(input.entity_id_2);
        const entity = state.addEntity(`Intersection of ${input.entity_id_1} ∩ ${input.entity_id_2}`, 'intersection', result);
        return JSON.stringify({
          success: true,
          entity_id: entity.id,
          description: `Intersection of ${input.entity_id_1} and ${input.entity_id_2} is ${entity.id}`,
        });
      }

      case 'translate': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }
        const newShape = translateShape(oc, e.shape, input.x, input.y, input.z);
        state.replaceShape(input.entity_id, newShape);
        return JSON.stringify({
          success: true,
          entity_id: input.entity_id,
          description: `Translated ${input.entity_id} by (${input.x}, ${input.y}, ${input.z})`,
        });
      }

      case 'rotate': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }
        const newShape = rotateShape(oc, e.shape, input.axis_x, input.axis_y, input.axis_z, input.angle_deg);
        state.replaceShape(input.entity_id, newShape);
        return JSON.stringify({
          success: true,
          entity_id: input.entity_id,
          description: `Rotated ${input.entity_id} by ${input.angle_deg}° around (${input.axis_x}, ${input.axis_y}, ${input.axis_z})`,
        });
      }

      case 'get_scene_info': {
        const info = state.getSceneInfo();
        return JSON.stringify({
          success: true,
          entities: info,
          description: info.length === 0
            ? 'Scene is empty'
            : `Scene contains ${info.length} entity(ies): ${info.map((e) => `${e.id} (${e.name})`).join(', ')}`,
        });
      }

      case 'delete_entity': {
        const removed = state.removeEntity(input.entity_id);
        if (!removed) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }
        return JSON.stringify({
          success: true,
          description: `Deleted ${input.entity_id}`,
        });
      }

      case 'fillet': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }
        const filletedShape = filletAllEdges(oc, e.shape, input.radius);
        state.replaceShape(input.entity_id, filletedShape);
        return JSON.stringify({
          success: true,
          entity_id: input.entity_id,
          description: `Filleted all edges of ${input.entity_id} with radius ${input.radius}"`,
        });
      }

      case 'chamfer': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }
        const chamferedShape = chamferAllEdges(oc, e.shape, input.distance);
        state.replaceShape(input.entity_id, chamferedShape);
        return JSON.stringify({
          success: true,
          entity_id: input.entity_id,
          description: `Chamfered all edges of ${input.entity_id} with distance ${input.distance}"`,
        });
      }

      case 'export_dxf': {
        const entityId = input.entity_id as string | undefined;
        let shapes: any[];
        let label: string;

        if (entityId) {
          const entity = state.getEntity(entityId);
          if (!entity) {
            return JSON.stringify({ success: false, error: `Entity ${entityId} not found` });
          }
          shapes = [entity.shape];
          label = entityId;
        } else {
          const allEntities = state.getAllEntities();
          if (allEntities.length === 0) {
            return JSON.stringify({ success: false, error: 'Scene is empty — nothing to export' });
          }
          shapes = allEntities.map((e) => e.shape);
          label = `${allEntities.length} entity(ies)`;
        }

        const result = exportDxf(oc, shapes);
        const downloadUrl = entityId
          ? `/api/export/dxf?entity_id=${encodeURIComponent(entityId)}`
          : '/api/export/dxf';

        return JSON.stringify({
          success: true,
          download_url: downloadUrl,
          entity_count: result.entityCount,
          warnings: result.warnings,
          description: `Exported ${label} to DXF (${result.entityCount} entities: lines, arcs, circles). Download: ${downloadUrl}${result.warnings.length > 0 ? '. Warnings: ' + result.warnings.join('; ') : ''}`,
        });
      }

      case 'export_step': {
        const entityId = input.entity_id as string | undefined;
        let shapes: any[];
        let label: string;

        if (entityId) {
          const entity = state.getEntity(entityId);
          if (!entity) {
            return JSON.stringify({ success: false, error: `Entity ${entityId} not found` });
          }
          shapes = [entity.shape];
          label = entityId;
        } else {
          const allEntities = state.getAllEntities();
          if (allEntities.length === 0) {
            return JSON.stringify({ success: false, error: 'Scene is empty — nothing to export' });
          }
          shapes = allEntities.map((e) => e.shape);
          label = `${allEntities.length} entity(ies)`;
        }

        const result = exportStep(oc, shapes);
        const downloadUrl = entityId
          ? `/api/export/step?entity_id=${encodeURIComponent(entityId)}`
          : '/api/export/step';

        return JSON.stringify({
          success: true,
          download_url: downloadUrl,
          warnings: result.warnings,
          description: `Exported ${label} to STEP. Download: ${downloadUrl}${result.warnings.length > 0 ? '. Warnings: ' + result.warnings.join('; ') : ''}`,
        });
      }

      case 'undo': {
        if (!undoManager) {
          return JSON.stringify({ success: false, error: 'Undo not available' });
        }
        const result = undoManager.undo(state);
        return JSON.stringify({
          success: result.success,
          description: result.description,
        });
      }

      case 'redo': {
        if (!undoManager) {
          return JSON.stringify({ success: false, error: 'Redo not available' });
        }
        const result = undoManager.redo(state);
        return JSON.stringify({
          success: result.success,
          description: result.description,
        });
      }

      default:
        return JSON.stringify({ success: false, error: `Unknown tool: ${toolName}` });
    }
  } catch (err: any) {
    return JSON.stringify({ success: false, error: err.message || String(err) });
  }
}

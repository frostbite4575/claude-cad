import type { Tool } from '@anthropic-ai/sdk/resources/messages.js';
import type { DocumentState } from '../state/document-state.js';
import { getOC } from '../geometry/oc-init.js';
import { createBox, createCylinder, createSphere, createPolygonExtrusion } from '../geometry/primitives.js';
import { createSketchLine, createSketchRectangle, createSketchCircle, createSketchArc, extrudeShape } from '../geometry/sketches.js';
import { booleanUnion, booleanSubtract, booleanIntersect } from '../geometry/booleans.js';
import { translateShape, rotateShape, mirrorShape, linearPatternCopies, circularPatternCopies } from '../geometry/transforms.js';
import { exportDxf, buildBendLineDxfEntities } from '../geometry/dxf-export.js';
import { exportStep } from '../geometry/step-export.js';
import { filletAllEdges, chamferAllEdges } from '../geometry/fillets.js';
import { MATERIALS_DB, findMaterial, calculateBend } from '../materials/materials.js';
import type { BendLine } from '../materials/materials.js';
import { createFlatPlate, buildFoldedShape } from '../geometry/sheet-metal.js';
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
    name: 'sketch_line',
    description: 'Draw a 2D line segment on the XY plane. Open geometry — cannot be extruded. Coordinates in inches.',
    input_schema: {
      type: 'object' as const,
      properties: {
        x1: { type: 'number', description: 'Start X in inches' },
        y1: { type: 'number', description: 'Start Y in inches' },
        x2: { type: 'number', description: 'End X in inches' },
        y2: { type: 'number', description: 'End Y in inches' },
        z: { type: 'number', description: 'Z plane (default 0)' },
      },
      required: ['x1', 'y1', 'x2', 'y2'],
    },
  },
  {
    name: 'sketch_rectangle',
    description: 'Draw a 2D rectangle on the XY plane. Creates a closed face that can be extruded into a solid. (x, y) is the bottom-left corner. Dimensions in inches.',
    input_schema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number', description: 'Corner X in inches' },
        y: { type: 'number', description: 'Corner Y in inches' },
        width: { type: 'number', description: 'Width (along X) in inches' },
        height: { type: 'number', description: 'Height (along Y) in inches' },
        z: { type: 'number', description: 'Z plane (default 0)' },
      },
      required: ['x', 'y', 'width', 'height'],
    },
  },
  {
    name: 'sketch_circle',
    description: 'Draw a 2D circle on the XY plane. Creates a closed face that can be extruded into a solid. Dimensions in inches.',
    input_schema: {
      type: 'object' as const,
      properties: {
        center_x: { type: 'number', description: 'Center X in inches' },
        center_y: { type: 'number', description: 'Center Y in inches' },
        radius: { type: 'number', description: 'Radius in inches' },
        z: { type: 'number', description: 'Z plane (default 0)' },
      },
      required: ['center_x', 'center_y', 'radius'],
    },
  },
  {
    name: 'sketch_arc',
    description: 'Draw a 2D arc on the XY plane. Open geometry — cannot be extruded. Angles in degrees, measured counter-clockwise from the +X axis.',
    input_schema: {
      type: 'object' as const,
      properties: {
        center_x: { type: 'number', description: 'Center X in inches' },
        center_y: { type: 'number', description: 'Center Y in inches' },
        radius: { type: 'number', description: 'Radius in inches' },
        start_angle: { type: 'number', description: 'Start angle in degrees' },
        end_angle: { type: 'number', description: 'End angle in degrees' },
        z: { type: 'number', description: 'Z plane (default 0)' },
      },
      required: ['center_x', 'center_y', 'radius', 'start_angle', 'end_angle'],
    },
  },
  {
    name: 'extrude',
    description: 'Extrude a 2D sketch face (rectangle or circle) into a 3D solid. Only works on closed sketch entities (not lines or arcs). The sketch is replaced by the resulting solid.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID of the sketch face to extrude' },
        height: { type: 'number', description: 'Extrusion height in inches' },
        direction_x: { type: 'number', description: 'X component of extrusion direction (default 0)' },
        direction_y: { type: 'number', description: 'Y component of extrusion direction (default 0)' },
        direction_z: { type: 'number', description: 'Z component of extrusion direction (default 1)' },
      },
      required: ['entity_id', 'height'],
    },
  },
  {
    name: 'mirror',
    description: 'Mirror an entity across a plane, creating a new mirrored copy (original is kept). Works on both sketches and solids.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to mirror' },
        plane: { type: 'string', enum: ['XY', 'XZ', 'YZ'], description: 'Mirror plane' },
        plane_offset: { type: 'number', description: 'Offset of the mirror plane from origin in inches (default 0). E.g. plane=YZ, offset=3 mirrors across X=3.' },
      },
      required: ['entity_id', 'plane'],
    },
  },
  {
    name: 'linear_pattern',
    description: 'Create N copies of an entity spaced along a direction. Original is kept. Works on both sketches and solids.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to pattern' },
        count: { type: 'number', description: 'Number of copies to create' },
        spacing_x: { type: 'number', description: 'Spacing in X per copy in inches' },
        spacing_y: { type: 'number', description: 'Spacing in Y per copy in inches' },
        spacing_z: { type: 'number', description: 'Spacing in Z per copy in inches (default 0)' },
      },
      required: ['entity_id', 'count', 'spacing_x', 'spacing_y'],
    },
  },
  {
    name: 'circular_pattern',
    description: 'Create N copies of an entity arranged around an axis. Original is kept. Use for bolt hole circles, radial patterns. Works on both sketches and solids.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to pattern' },
        count: { type: 'number', description: 'Number of copies to create' },
        center_x: { type: 'number', description: 'Rotation center X (default 0)' },
        center_y: { type: 'number', description: 'Rotation center Y (default 0)' },
        center_z: { type: 'number', description: 'Rotation center Z (default 0)' },
        axis_x: { type: 'number', description: 'Rotation axis X component (default 0)' },
        axis_y: { type: 'number', description: 'Rotation axis Y component (default 0)' },
        axis_z: { type: 'number', description: 'Rotation axis Z component (default 1)' },
        full_angle: { type: 'number', description: 'Total angle in degrees to spread copies over (default 360)' },
      },
      required: ['entity_id', 'count'],
    },
  },
  {
    name: 'create_sheet_metal_plate',
    description: 'Create a flat sheet metal plate with a specific material. The plate lies on the XY plane with thickness in Z. Use list_materials to see available materials. All dimensions in inches.',
    input_schema: {
      type: 'object' as const,
      properties: {
        width: { type: 'number', description: 'Plate width (X) in inches' },
        length: { type: 'number', description: 'Plate length (Y) in inches' },
        material: { type: 'string', description: 'Material name, e.g. "1/4 mild steel". Use list_materials to see options.' },
        thickness_override: { type: 'number', description: 'Optional custom thickness in inches. Overrides the material default.' },
      },
      required: ['width', 'length', 'material'],
    },
  },
  {
    name: 'add_bend_line',
    description: 'Add a bend line to a sheet metal plate. Position is the distance from the left edge (for Y-axis bends) or bottom edge (for X-axis bends). Axis is the direction the bend line runs (X or Y). Angle is the bend angle in degrees.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID of the sheet metal plate' },
        position: { type: 'number', description: 'Distance from edge in inches' },
        axis: { type: 'string', enum: ['X', 'Y'], description: 'Axis the bend line runs along. X = horizontal bend (position measured from bottom), Y = vertical bend (position measured from left).' },
        angle_deg: { type: 'number', description: 'Bend angle in degrees (e.g. 90)' },
        direction: { type: 'string', enum: ['up', 'down'], description: 'Fold direction: up = toward +Z, down = toward -Z' },
      },
      required: ['entity_id', 'position', 'axis', 'angle_deg', 'direction'],
    },
  },
  {
    name: 'fold_sheet_metal',
    description: 'Create a 3D folded preview of a sheet metal plate with bend lines. The original flat plate is preserved. Creates a new entity showing the folded shape.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID of the sheet metal plate to fold' },
      },
      required: ['entity_id'],
    },
  },
  {
    name: 'get_flat_pattern',
    description: 'Get flat pattern information for a sheet metal plate: dimensions, material, bend lines, and bend calculations (allowance, deduction, setback).',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID of the sheet metal plate' },
      },
      required: ['entity_id'],
    },
  },
  {
    name: 'list_materials',
    description: 'List all available sheet metal materials with their thickness, bend radius, and K-factor.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'cut_hole',
    description: 'Cut a circular hole in a solid entity. Specify center position and radius. Depth auto-detects from entity geometry (cuts all the way through). Works on any solid including sheet metal plates.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID of the solid to cut' },
        center_x: { type: 'number', description: 'Hole center X position in inches' },
        center_y: { type: 'number', description: 'Hole center Y position in inches' },
        radius: { type: 'number', description: 'Hole radius in inches' },
        depth: { type: 'number', description: 'Optional cut depth in inches. Defaults to entity thickness (cuts through).' },
      },
      required: ['entity_id', 'center_x', 'center_y', 'radius'],
    },
  },
  {
    name: 'cut_slot',
    description: 'Cut a rectangular or obround slot in a solid entity. Specify center, width, height, and optional corner_radius for rounded ends (common for mounting slots). Depth auto-detects.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID of the solid to cut' },
        center_x: { type: 'number', description: 'Slot center X position in inches' },
        center_y: { type: 'number', description: 'Slot center Y position in inches' },
        width: { type: 'number', description: 'Slot width (X) in inches' },
        height: { type: 'number', description: 'Slot height (Y) in inches' },
        corner_radius: { type: 'number', description: 'Optional corner radius for obround/stadium shape. Max = min(width,height)/2.' },
        depth: { type: 'number', description: 'Optional cut depth in inches. Defaults to entity thickness (cuts through).' },
      },
      required: ['entity_id', 'center_x', 'center_y', 'width', 'height'],
    },
  },
  {
    name: 'cut_pattern_linear',
    description: 'Cut a grid of circular holes in a solid entity. Specify starting position, counts, and spacing in X and Y. Single undo step for the entire pattern.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID of the solid to cut' },
        hole_radius: { type: 'number', description: 'Radius of each hole in inches' },
        start_x: { type: 'number', description: 'First hole center X position in inches' },
        start_y: { type: 'number', description: 'First hole center Y position in inches' },
        count_x: { type: 'number', description: 'Number of holes in X direction' },
        count_y: { type: 'number', description: 'Number of holes in Y direction' },
        spacing_x: { type: 'number', description: 'Spacing between holes in X direction in inches' },
        spacing_y: { type: 'number', description: 'Spacing between holes in Y direction in inches' },
        depth: { type: 'number', description: 'Optional cut depth in inches. Defaults to entity thickness (cuts through).' },
      },
      required: ['entity_id', 'hole_radius', 'start_x', 'start_y', 'count_x', 'count_y', 'spacing_x', 'spacing_y'],
    },
  },
  {
    name: 'cut_pattern_circular',
    description: 'Cut circular holes arranged in a bolt hole circle pattern. Holes are evenly spaced around a center point. Single undo step.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID of the solid to cut' },
        hole_radius: { type: 'number', description: 'Radius of each hole in inches' },
        center_x: { type: 'number', description: 'Pattern center X position in inches' },
        center_y: { type: 'number', description: 'Pattern center Y position in inches' },
        pattern_radius: { type: 'number', description: 'Radius of the bolt hole circle in inches' },
        count: { type: 'number', description: 'Number of holes around the circle' },
        start_angle: { type: 'number', description: 'Starting angle in degrees (default 0, measured from +X axis)' },
        depth: { type: 'number', description: 'Optional cut depth in inches. Defaults to entity thickness (cuts through).' },
      },
      required: ['entity_id', 'hole_radius', 'center_x', 'center_y', 'pattern_radius', 'count'],
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
        if (e1.metadata.entityKind === 'sketch' || e2.metadata.entityKind === 'sketch') {
          return JSON.stringify({ success: false, error: 'Boolean operations require 3D solid entities. Extrude sketches first.' });
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
        if (e1.metadata.entityKind === 'sketch' || e2.metadata.entityKind === 'sketch') {
          return JSON.stringify({ success: false, error: 'Boolean operations require 3D solid entities. Extrude sketches first.' });
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
        if (e1.metadata.entityKind === 'sketch' || e2.metadata.entityKind === 'sketch') {
          return JSON.stringify({ success: false, error: 'Boolean operations require 3D solid entities. Extrude sketches first.' });
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
        if (e.metadata.entityKind === 'sketch') {
          return JSON.stringify({ success: false, error: 'Fillet requires a 3D solid entity. Extrude sketches first.' });
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
        if (e.metadata.entityKind === 'sketch') {
          return JSON.stringify({ success: false, error: 'Chamfer requires a 3D solid entity. Extrude sketches first.' });
        }
        const chamferedShape = chamferAllEdges(oc, e.shape, input.distance);
        state.replaceShape(input.entity_id, chamferedShape);
        return JSON.stringify({
          success: true,
          entity_id: input.entity_id,
          description: `Chamfered all edges of ${input.entity_id} with distance ${input.distance}"`,
        });
      }

      case 'sketch_line': {
        const shape = createSketchLine(oc, input.x1, input.y1, input.x2, input.y2, input.z ?? 0);
        const entity = state.addEntity(
          `Line (${input.x1},${input.y1})→(${input.x2},${input.y2})`,
          'sketch_line',
          shape,
          { entityKind: 'sketch' }
        );
        return JSON.stringify({
          success: true,
          entity_id: entity.id,
          description: `Created line from (${input.x1}, ${input.y1}) to (${input.x2}, ${input.y2}) as ${entity.id}. Open geometry — cannot be extruded.`,
        });
      }

      case 'sketch_rectangle': {
        const shape = createSketchRectangle(oc, input.x, input.y, input.width, input.height, input.z ?? 0);
        const entity = state.addEntity(
          `Rectangle ${input.width}×${input.height} at (${input.x},${input.y})`,
          'sketch_rectangle',
          shape,
          { entityKind: 'sketch' }
        );
        return JSON.stringify({
          success: true,
          entity_id: entity.id,
          description: `Created ${input.width}" × ${input.height}" rectangle at (${input.x}, ${input.y}) as ${entity.id}. Closed face — can be extruded.`,
        });
      }

      case 'sketch_circle': {
        const shape = createSketchCircle(oc, input.center_x, input.center_y, input.radius, input.z ?? 0);
        const entity = state.addEntity(
          `Circle r=${input.radius} at (${input.center_x},${input.center_y})`,
          'sketch_circle',
          shape,
          { entityKind: 'sketch' }
        );
        return JSON.stringify({
          success: true,
          entity_id: entity.id,
          description: `Created circle radius ${input.radius}" at (${input.center_x}, ${input.center_y}) as ${entity.id}. Closed face — can be extruded.`,
        });
      }

      case 'sketch_arc': {
        const shape = createSketchArc(oc, input.center_x, input.center_y, input.radius, input.start_angle, input.end_angle, input.z ?? 0);
        const entity = state.addEntity(
          `Arc r=${input.radius} ${input.start_angle}°–${input.end_angle}°`,
          'sketch_arc',
          shape,
          { entityKind: 'sketch' }
        );
        return JSON.stringify({
          success: true,
          entity_id: entity.id,
          description: `Created arc radius ${input.radius}" from ${input.start_angle}° to ${input.end_angle}° at (${input.center_x}, ${input.center_y}) as ${entity.id}. Open geometry — cannot be extruded.`,
        });
      }

      case 'extrude': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }
        if (e.metadata.entityKind !== 'sketch') {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} is already a solid — extrude only works on sketch faces.` });
        }
        if (e.type === 'sketch_line' || e.type === 'sketch_arc') {
          return JSON.stringify({ success: false, error: `Cannot extrude an open ${e.type}. Only closed sketches (rectangles, circles) can be extruded.` });
        }
        const dirX = input.direction_x ?? 0;
        const dirY = input.direction_y ?? 0;
        const dirZ = input.direction_z ?? 1;
        const solid = extrudeShape(oc, e.shape, input.height, dirX, dirY, dirZ);
        state.replaceShape(input.entity_id, solid);
        e.name = `Extruded ${e.name} h=${input.height}`;
        e.type = 'extrusion';
        e.metadata.entityKind = 'solid';
        return JSON.stringify({
          success: true,
          entity_id: input.entity_id,
          description: `Extruded ${input.entity_id} by ${input.height}" → now a 3D solid.`,
        });
      }

      case 'export_dxf': {
        const entityId = input.entity_id as string | undefined;
        let shapes: any[];
        let label: string;
        let extraLayered: any[] | undefined;

        if (entityId) {
          const entity = state.getEntity(entityId);
          if (!entity) {
            return JSON.stringify({ success: false, error: `Entity ${entityId} not found` });
          }
          shapes = [entity.shape];
          label = entityId;

          // If sheet metal plate, add bend lines on BEND layer
          if (entity.metadata.sheetMetal && (entity.metadata.bendLines as BendLine[])?.length > 0) {
            extraLayered = buildBendLineDxfEntities(
              entity.metadata.bendLines as BendLine[],
              entity.metadata.plateWidth as number,
              entity.metadata.plateLength as number
            );
          }
        } else {
          const allEntities = state.getAllEntities();
          if (allEntities.length === 0) {
            return JSON.stringify({ success: false, error: 'Scene is empty — nothing to export' });
          }
          shapes = allEntities.map((e) => e.shape);
          label = `${allEntities.length} entity(ies)`;

          // Collect bend lines from all sheet metal entities
          const bendLayered: any[] = [];
          for (const e of allEntities) {
            if (e.metadata.sheetMetal && (e.metadata.bendLines as BendLine[])?.length > 0) {
              bendLayered.push(...buildBendLineDxfEntities(
                e.metadata.bendLines as BendLine[],
                e.metadata.plateWidth as number,
                e.metadata.plateLength as number
              ));
            }
          }
          if (bendLayered.length > 0) extraLayered = bendLayered;
        }

        const result = exportDxf(oc, shapes, extraLayered);
        const downloadUrl = entityId
          ? `/api/export/dxf?entity_id=${encodeURIComponent(entityId)}`
          : '/api/export/dxf';

        const bendNote = extraLayered?.length ? ` + ${extraLayered.length} bend line(s) on BEND layer` : '';
        return JSON.stringify({
          success: true,
          download_url: downloadUrl,
          entity_count: result.entityCount,
          warnings: result.warnings,
          description: `Exported ${label} to DXF (${result.entityCount} entities: lines, arcs, circles${bendNote}). Download: ${downloadUrl}${result.warnings.length > 0 ? '. Warnings: ' + result.warnings.join('; ') : ''}`,
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

      case 'mirror': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }
        const mirrored = mirrorShape(oc, e.shape, input.plane, input.plane_offset ?? 0);
        const mirEntity = state.addEntity(
          `Mirror of ${e.name} across ${input.plane}`,
          e.type,
          mirrored,
          { entityKind: e.metadata.entityKind }
        );
        return JSON.stringify({
          success: true,
          entity_id: mirEntity.id,
          description: `Mirrored ${input.entity_id} across ${input.plane} plane${input.plane_offset ? ` at offset ${input.plane_offset}"` : ''} → new entity ${mirEntity.id}`,
        });
      }

      case 'linear_pattern': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }
        const sx = input.spacing_x;
        const sy = input.spacing_y;
        const sz = input.spacing_z ?? 0;
        const copies = linearPatternCopies(oc, e.shape, input.count, sx, sy, sz);
        const newIds: string[] = [];
        for (let i = 0; i < copies.length; i++) {
          const copyEntity = state.addEntity(
            `${e.name} pattern copy ${i + 1}`,
            e.type,
            copies[i],
            { entityKind: e.metadata.entityKind }
          );
          newIds.push(copyEntity.id);
        }
        return JSON.stringify({
          success: true,
          entity_ids: newIds,
          description: `Created ${input.count} linear copies of ${input.entity_id} spaced (${sx}, ${sy}, ${sz})": ${newIds.join(', ')}`,
        });
      }

      case 'circular_pattern': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }
        const cx = input.center_x ?? 0;
        const cy = input.center_y ?? 0;
        const cz = input.center_z ?? 0;
        const ax = input.axis_x ?? 0;
        const ay = input.axis_y ?? 0;
        const az = input.axis_z ?? 1;
        const fullAngle = input.full_angle ?? 360;
        const copies = circularPatternCopies(oc, e.shape, input.count, cx, cy, cz, ax, ay, az, fullAngle);
        const newIds: string[] = [];
        for (let i = 0; i < copies.length; i++) {
          const copyEntity = state.addEntity(
            `${e.name} radial copy ${i + 1}`,
            e.type,
            copies[i],
            { entityKind: e.metadata.entityKind }
          );
          newIds.push(copyEntity.id);
        }
        return JSON.stringify({
          success: true,
          entity_ids: newIds,
          description: `Created ${input.count} circular copies of ${input.entity_id} around (${cx},${cy},${cz}) over ${fullAngle}°: ${newIds.join(', ')}`,
        });
      }

      case 'create_sheet_metal_plate': {
        const mat = findMaterial(input.material);
        if (!mat) {
          return JSON.stringify({ success: false, error: `Material "${input.material}" not found. Use list_materials to see available options.` });
        }
        const thickness = input.thickness_override ?? mat.thickness;
        const shape = createFlatPlate(oc, input.width, input.length, thickness);
        const entity = state.addEntity(
          `Sheet metal plate ${input.width}×${input.length} (${mat.name})`,
          'sheet_metal_plate',
          shape,
          {
            entityKind: 'solid',
            sheetMetal: true,
            materialName: mat.name,
            materialType: mat.material_type,
            thickness,
            innerBendRadius: mat.inner_bend_radius,
            kFactor: mat.k_factor,
            plateWidth: input.width,
            plateLength: input.length,
            bendLines: [],
          }
        );
        return JSON.stringify({
          success: true,
          entity_id: entity.id,
          description: `Created ${input.width}" × ${input.length}" sheet metal plate (${mat.name}, ${thickness}" thick) as ${entity.id}`,
        });
      }

      case 'add_bend_line': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }
        if (!e.metadata.sheetMetal) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} is not a sheet metal plate. Use create_sheet_metal_plate first.` });
        }

        // Validate position is within plate bounds
        const maxPos = (input.axis === 'X' ? e.metadata.plateLength : e.metadata.plateWidth) as number;
        if (input.position <= 0 || input.position >= maxPos) {
          return JSON.stringify({ success: false, error: `Bend position ${input.position}" is out of bounds. Must be between 0 and ${maxPos}" for ${input.axis}-axis bends.` });
        }

        const bendId = `bend_${(e.metadata.bendLines as BendLine[]).length + 1}`;
        const newBend: BendLine = {
          id: bendId,
          position: input.position,
          axis: input.axis,
          angle_deg: input.angle_deg,
          direction: input.direction,
        };

        // CRITICAL: create new array for undo compatibility (shallow snapshot)
        const oldBends = e.metadata.bendLines as BendLine[];
        e.metadata.bendLines = [...oldBends, newBend];

        const calc = calculateBend(
          e.metadata.thickness as number,
          e.metadata.innerBendRadius as number,
          e.metadata.kFactor as number,
          input.angle_deg
        );

        return JSON.stringify({
          success: true,
          entity_id: input.entity_id,
          bend_id: bendId,
          bend_calculation: calc,
          description: `Added ${input.angle_deg}° ${input.direction} bend at ${input.position}" along ${input.axis}-axis on ${input.entity_id}. BA=${calc.bend_allowance}", BD=${calc.bend_deduction}"`,
        });
      }

      case 'fold_sheet_metal': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }
        if (!e.metadata.sheetMetal) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} is not a sheet metal plate.` });
        }
        const bends = e.metadata.bendLines as BendLine[];
        if (bends.length === 0) {
          return JSON.stringify({ success: false, error: 'No bend lines defined. Use add_bend_line first.' });
        }

        // V1: single-axis constraint
        const axes = new Set(bends.map(b => b.axis));
        if (axes.size > 1) {
          return JSON.stringify({ success: false, error: 'V1 limitation: all bends must be on the same axis. Mixed X/Y bends are not yet supported.' });
        }

        const foldedShape = buildFoldedShape(
          oc,
          e.metadata.plateWidth as number,
          e.metadata.plateLength as number,
          e.metadata.thickness as number,
          e.metadata.innerBendRadius as number,
          e.metadata.kFactor as number,
          bends
        );

        const foldedEntity = state.addEntity(
          `Folded ${e.name}`,
          'sheet_metal_folded',
          foldedShape,
          { entityKind: 'solid', sourcePlateId: input.entity_id }
        );

        return JSON.stringify({
          success: true,
          entity_id: foldedEntity.id,
          source_plate_id: input.entity_id,
          description: `Created folded 3D preview as ${foldedEntity.id} (${bends.length} bend(s)). Original flat plate ${input.entity_id} is preserved.`,
        });
      }

      case 'get_flat_pattern': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }
        if (!e.metadata.sheetMetal) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} is not a sheet metal plate.` });
        }

        const bends = e.metadata.bendLines as BendLine[];
        const bendDetails = bends.map(b => {
          const calc = calculateBend(
            e.metadata.thickness as number,
            e.metadata.innerBendRadius as number,
            e.metadata.kFactor as number,
            b.angle_deg
          );
          return {
            id: b.id,
            position: b.position,
            axis: b.axis,
            angle_deg: b.angle_deg,
            direction: b.direction,
            ...calc,
          };
        });

        const totalBA = bendDetails.reduce((sum, b) => sum + b.bend_allowance, 0);
        const totalBD = bendDetails.reduce((sum, b) => sum + b.bend_deduction, 0);

        return JSON.stringify({
          success: true,
          entity_id: input.entity_id,
          material: e.metadata.materialName,
          material_type: e.metadata.materialType,
          thickness: e.metadata.thickness,
          plate_width: e.metadata.plateWidth,
          plate_length: e.metadata.plateLength,
          bend_radius: e.metadata.innerBendRadius,
          k_factor: e.metadata.kFactor,
          bends: bendDetails,
          total_bend_allowance: Math.round(totalBA * 10000) / 10000,
          total_bend_deduction: Math.round(totalBD * 10000) / 10000,
          description: `Flat pattern: ${e.metadata.plateWidth}" × ${e.metadata.plateLength}" ${e.metadata.materialName} (${e.metadata.thickness}" thick). ${bends.length} bend(s). Total BA=${totalBA.toFixed(4)}", Total BD=${totalBD.toFixed(4)}"`,
        });
      }

      case 'list_materials': {
        const table = MATERIALS_DB.map(m => ({
          name: m.name,
          type: m.material_type,
          thickness: m.thickness,
          bend_radius: m.inner_bend_radius,
          k_factor: m.k_factor,
        }));
        return JSON.stringify({
          success: true,
          materials: table,
          description: `Available materials: ${table.map(m => `${m.name} (${m.thickness}" thick)`).join(', ')}`,
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

      case 'cut_hole': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }
        if (e.metadata.entityKind === 'sketch') {
          return JSON.stringify({ success: false, error: 'Cutout operations require a 3D solid entity. Extrude sketches first.' });
        }

        // Auto-detect depth from bounding box
        const bbox = new oc.Bnd_Box_1();
        oc.BRepBndLib.Add(e.shape, bbox, false);
        const bMin = bbox.CornerMin();
        const bMax = bbox.CornerMax();
        const zMin = bMin.Z(), zMax = bMax.Z();
        const autoDepth = input.depth ?? (zMax - zMin);
        bMin.delete(); bMax.delete(); bbox.delete();

        // Create cutter cylinder slightly oversized to avoid co-planar faces
        const cutter = createCylinder(oc, input.radius, autoDepth + 0.01);
        const positioned = translateShape(oc, cutter, input.center_x, input.center_y, zMax - autoDepth - 0.005);
        cutter.delete();

        const result = booleanSubtract(oc, e.shape, positioned);
        positioned.delete();
        state.replaceShape(input.entity_id, result);
        return JSON.stringify({
          success: true,
          entity_id: input.entity_id,
          description: `Cut ø${input.radius * 2}" hole at (${input.center_x}, ${input.center_y}) in ${input.entity_id}`,
        });
      }

      case 'cut_slot': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }
        if (e.metadata.entityKind === 'sketch') {
          return JSON.stringify({ success: false, error: 'Cutout operations require a 3D solid entity. Extrude sketches first.' });
        }

        // Auto-detect depth from bounding box
        const bbox2 = new oc.Bnd_Box_1();
        oc.BRepBndLib.Add(e.shape, bbox2, false);
        const bMin2 = bbox2.CornerMin();
        const bMax2 = bbox2.CornerMax();
        const zMin2 = bMin2.Z(), zMax2 = bMax2.Z();
        const autoDepth2 = input.depth ?? (zMax2 - zMin2);
        bMin2.delete(); bMax2.delete(); bbox2.delete();

        const cutDepth = autoDepth2 + 0.01;
        let cutter2: any;

        if (input.corner_radius && input.corner_radius > 0) {
          // Obround: create box then fillet Z-parallel edges
          const cr = Math.min(input.corner_radius, Math.min(input.width, input.height) / 2);
          const rawBox = createBox(oc, input.width, input.height, cutDepth);
          cutter2 = filletAllEdges(oc, rawBox, cr);
          rawBox.delete();
        } else {
          cutter2 = createBox(oc, input.width, input.height, cutDepth);
        }

        // Position: center the slot at (center_x, center_y), top at zMax
        const positioned2 = translateShape(
          oc, cutter2,
          input.center_x - input.width / 2,
          input.center_y - input.height / 2,
          zMax2 - autoDepth2 - 0.005
        );
        cutter2.delete();

        const result2 = booleanSubtract(oc, e.shape, positioned2);
        positioned2.delete();
        state.replaceShape(input.entity_id, result2);

        const shapeDesc = input.corner_radius ? `obround (r=${input.corner_radius}")` : 'rectangular';
        return JSON.stringify({
          success: true,
          entity_id: input.entity_id,
          description: `Cut ${input.width}" × ${input.height}" ${shapeDesc} slot at (${input.center_x}, ${input.center_y}) in ${input.entity_id}`,
        });
      }

      case 'cut_pattern_linear': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }
        if (e.metadata.entityKind === 'sketch') {
          return JSON.stringify({ success: false, error: 'Cutout operations require a 3D solid entity. Extrude sketches first.' });
        }

        // Auto-detect depth
        const bbox3 = new oc.Bnd_Box_1();
        oc.BRepBndLib.Add(e.shape, bbox3, false);
        const bMin3 = bbox3.CornerMin();
        const bMax3 = bbox3.CornerMax();
        const zMin3 = bMin3.Z(), zMax3 = bMax3.Z();
        const autoDepth3 = input.depth ?? (zMax3 - zMin3);
        bMin3.delete(); bMax3.delete(); bbox3.delete();

        const cutDepth3 = autoDepth3 + 0.01;
        const zStart3 = zMax3 - autoDepth3 - 0.005;
        const totalHoles = input.count_x * input.count_y;

        // Create first cutter and fuse all into compound
        let compound: any = null;
        for (let iy = 0; iy < input.count_y; iy++) {
          for (let ix = 0; ix < input.count_x; ix++) {
            const cx = input.start_x + ix * input.spacing_x;
            const cy = input.start_y + iy * input.spacing_y;
            const cyl = createCylinder(oc, input.hole_radius, cutDepth3);
            const pos = translateShape(oc, cyl, cx, cy, zStart3);
            cyl.delete();
            if (compound === null) {
              compound = pos;
            } else {
              const fused = booleanUnion(oc, compound, pos);
              compound.delete();
              pos.delete();
              compound = fused;
            }
          }
        }

        const result3 = booleanSubtract(oc, e.shape, compound);
        compound.delete();
        state.replaceShape(input.entity_id, result3);
        return JSON.stringify({
          success: true,
          entity_id: input.entity_id,
          description: `Cut ${input.count_x}×${input.count_y} grid (${totalHoles} holes, ø${input.hole_radius * 2}") starting at (${input.start_x}, ${input.start_y}) in ${input.entity_id}`,
        });
      }

      case 'cut_pattern_circular': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }
        if (e.metadata.entityKind === 'sketch') {
          return JSON.stringify({ success: false, error: 'Cutout operations require a 3D solid entity. Extrude sketches first.' });
        }

        // Auto-detect depth
        const bbox4 = new oc.Bnd_Box_1();
        oc.BRepBndLib.Add(e.shape, bbox4, false);
        const bMin4 = bbox4.CornerMin();
        const bMax4 = bbox4.CornerMax();
        const zMin4 = bMin4.Z(), zMax4 = bMax4.Z();
        const autoDepth4 = input.depth ?? (zMax4 - zMin4);
        bMin4.delete(); bMax4.delete(); bbox4.delete();

        const cutDepth4 = autoDepth4 + 0.01;
        const zStart4 = zMax4 - autoDepth4 - 0.005;
        const startAngle = (input.start_angle ?? 0) * Math.PI / 180;
        const angleStep = (2 * Math.PI) / input.count;

        let compound4: any = null;
        for (let i = 0; i < input.count; i++) {
          const angle = startAngle + i * angleStep;
          const hx = input.center_x + input.pattern_radius * Math.cos(angle);
          const hy = input.center_y + input.pattern_radius * Math.sin(angle);
          const cyl = createCylinder(oc, input.hole_radius, cutDepth4);
          const pos = translateShape(oc, cyl, hx, hy, zStart4);
          cyl.delete();
          if (compound4 === null) {
            compound4 = pos;
          } else {
            const fused = booleanUnion(oc, compound4, pos);
            compound4.delete();
            pos.delete();
            compound4 = fused;
          }
        }

        const result4 = booleanSubtract(oc, e.shape, compound4);
        compound4.delete();
        state.replaceShape(input.entity_id, result4);
        return JSON.stringify({
          success: true,
          entity_id: input.entity_id,
          description: `Cut ${input.count}-hole bolt circle (ø${input.hole_radius * 2}" holes, ${input.pattern_radius}" radius) at (${input.center_x}, ${input.center_y}) in ${input.entity_id}`,
        });
      }

      default:
        return JSON.stringify({ success: false, error: `Unknown tool: ${toolName}` });
    }
  } catch (err: any) {
    return JSON.stringify({ success: false, error: err.message || String(err) });
  }
}

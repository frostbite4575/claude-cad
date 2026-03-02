import type { Tool } from '@anthropic-ai/sdk/resources/messages.js';
import type { DocumentState } from '../state/document-state.js';
import { getOC } from '../geometry/oc-init.js';
import { createBox, createCylinder, createSphere, createPolygonExtrusion, revolveShape } from '../geometry/primitives.js';
import { createSketchLine, createSketchRectangle, createSketchCircle, createSketchArc, createFlatProfile, extrudeShape, transformToPlane } from '../geometry/sketches.js';
import type { SketchPlane } from '../geometry/sketches.js';
import { booleanUnion, booleanSubtract, booleanIntersect } from '../geometry/booleans.js';
import { translateShape, rotateShape, mirrorShape, scaleShape, linearPatternCopies, circularPatternCopies } from '../geometry/transforms.js';
import { exportDxf, buildBendLineDxfEntities } from '../geometry/dxf-export.js';
import { parseDxf, dxfToShapes } from '../geometry/dxf-import.js';
import { exportStep } from '../geometry/step-export.js';
import { exportStl } from '../geometry/stl-export.js';
import { importStep } from '../geometry/step-import.js';
import { filletAllEdges, filletEdges, chamferEdges, countEdges } from '../geometry/fillets.js';
import type { EdgeFilter } from '../geometry/fillets.js';
import { MATERIALS_DB, findMaterial, calculateBend, getBoltClearance, BOLT_CLEARANCE, setCustomBend, getAllBendOverrides, MATERIAL_DENSITY, MATERIAL_COST_PER_LB, DEFAULT_CUT_COST_PER_INCH } from '../materials/materials.js';
import type { BendLine } from '../materials/materials.js';
import { createFlatPlate, buildFoldedShape } from '../geometry/sheet-metal.js';
import { shellShape, loftShapes, sweepShape } from '../geometry/advanced-ops.js';
import type { UndoRedoManager } from '../state/undo-redo.js';
import { saveTemplate, loadTemplate, listTemplates, deleteTemplate } from '../state/templates.js';
import type { PartTemplate } from '../state/templates.js';

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
    name: 'scale',
    description: 'Scale an entity by a uniform factor. Factor > 1 enlarges, < 1 shrinks. Optionally specify a center point for scaling (default: origin).',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to scale' },
        factor: { type: 'number', description: 'Scale factor (e.g. 0.5 = half size, 2 = double size)' },
        center_x: { type: 'number', description: 'Scale center X (default: 0)' },
        center_y: { type: 'number', description: 'Scale center Y (default: 0)' },
        center_z: { type: 'number', description: 'Scale center Z (default: 0)' },
      },
      required: ['entity_id', 'factor'],
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
    name: 'set_units',
    description: 'Set the document unit system. All dimensions in tool inputs and outputs use these units. Default is inches. Changing units does NOT rescale existing geometry — it only changes how new dimensions are interpreted.',
    input_schema: {
      type: 'object' as const,
      properties: {
        units: { type: 'string', enum: ['inches', 'mm'], description: 'Unit system to use' },
      },
      required: ['units'],
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
    name: 'rename_entity',
    description: 'Rename an entity.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to rename' },
        name: { type: 'string', description: 'New name for the entity' },
      },
      required: ['entity_id', 'name'],
    },
  },
  {
    name: 'duplicate_entity',
    description: 'Duplicate an entity with an optional offset. Returns the new entity ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to duplicate' },
        offset_x: { type: 'number', description: 'X offset for the copy (default 1)' },
        offset_y: { type: 'number', description: 'Y offset for the copy (default 0)' },
        offset_z: { type: 'number', description: 'Z offset for the copy (default 0)' },
      },
      required: ['entity_id'],
    },
  },
  {
    name: 'fillet',
    description: 'Round (fillet) edges of a shape with a constant radius. Supports filtering by edge orientation (all, vertical, horizontal, top, bottom) or specific edge indices. Use get_edge_count to see how many edges a shape has.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to fillet' },
        radius: { type: 'number', description: 'Fillet radius in inches' },
        edge_filter: { type: 'string', enum: ['all', 'vertical', 'horizontal', 'top', 'bottom'], description: 'Which edges to fillet (default: all)' },
        edge_indices: { type: 'array', items: { type: 'number' }, description: 'Specific 0-based edge indices to fillet (overrides edge_filter)' },
      },
      required: ['entity_id', 'radius'],
    },
  },
  {
    name: 'chamfer',
    description: 'Bevel (chamfer) edges of a shape with a constant distance. Supports filtering by edge orientation (all, vertical, horizontal, top, bottom) or specific edge indices.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to chamfer' },
        distance: { type: 'number', description: 'Chamfer distance in inches' },
        edge_filter: { type: 'string', enum: ['all', 'vertical', 'horizontal', 'top', 'bottom'], description: 'Which edges to chamfer (default: all)' },
        edge_indices: { type: 'array', items: { type: 'number' }, description: 'Specific 0-based edge indices to chamfer (overrides edge_filter)' },
      },
      required: ['entity_id', 'distance'],
    },
  },
  {
    name: 'export_dxf',
    description: 'Export the scene (or a single entity) as a DXF file for plasma cutting. Returns a download URL. DXF output contains only lines, arcs, and circles (no splines) projected onto the XY plane, in inches. Use classify_layers=true to auto-assign outside perimeter and inside holes/slots to separate OUTSIDE/INSIDE layers for ProNest.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Optional entity ID to export. If omitted, exports all entities.' },
        classify_layers: { type: 'boolean', description: 'If true, auto-classify contours as OUTSIDE (perimeter) or INSIDE (holes/slots) on separate DXF layers. Useful for ProNest import.' },
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
    name: 'export_stl',
    description: 'Export the scene (or a single entity) as an STL file for 3D printing. Returns a download URL. STL is a triangulated mesh format — no curves or parametric data.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Optional entity ID to export. If omitted, exports all entities.' },
      },
      required: [],
    },
  },
  {
    name: 'import_dxf',
    description: 'Import a DXF file from a URL or file path. Creates sketch entities from the DXF content (LINE, ARC, CIRCLE, LWPOLYLINE). Use this when a user wants to load, view, or modify an existing DXF file. Note: the actual file upload happens via HTTP POST to /api/import/dxf — tell the user to drag and drop or use the upload button in the chat panel.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'DXF file content as a string (if provided directly)' },
      },
      required: [],
    },
  },
  {
    name: 'import_step',
    description: 'Import a STEP file. Creates solid entities from the STEP content. The actual file upload happens via HTTP POST to /api/import/step — tell the user to drag and drop or use the upload button.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'STEP file content as a string (if provided directly)' },
      },
      required: [],
    },
  },
  {
    name: 'sketch_line',
    description: 'Draw a 2D line segment. Open geometry — cannot be extruded. Coordinates in the sketch plane\'s 2D coordinate system.',
    input_schema: {
      type: 'object' as const,
      properties: {
        x1: { type: 'number', description: 'Start X in inches' },
        y1: { type: 'number', description: 'Start Y in inches' },
        x2: { type: 'number', description: 'End X in inches' },
        y2: { type: 'number', description: 'End Y in inches' },
        z: { type: 'number', description: 'Z offset (default 0)' },
        plane: { type: 'string', enum: ['XY', 'XZ', 'YZ'], description: 'Sketch plane (default XY)' },
      },
      required: ['x1', 'y1', 'x2', 'y2'],
    },
  },
  {
    name: 'sketch_rectangle',
    description: 'Draw a 2D rectangle. Creates a closed face that can be extruded into a solid. (x, y) is the bottom-left corner. Dimensions in inches.',
    input_schema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number', description: 'Corner X in inches' },
        y: { type: 'number', description: 'Corner Y in inches' },
        width: { type: 'number', description: 'Width (along X) in inches' },
        height: { type: 'number', description: 'Height (along Y) in inches' },
        z: { type: 'number', description: 'Z offset (default 0)' },
        plane: { type: 'string', enum: ['XY', 'XZ', 'YZ'], description: 'Sketch plane (default XY)' },
      },
      required: ['x', 'y', 'width', 'height'],
    },
  },
  {
    name: 'sketch_circle',
    description: 'Draw a 2D circle. Creates a closed face that can be extruded into a solid. Dimensions in inches.',
    input_schema: {
      type: 'object' as const,
      properties: {
        center_x: { type: 'number', description: 'Center X in inches' },
        center_y: { type: 'number', description: 'Center Y in inches' },
        radius: { type: 'number', description: 'Radius in inches' },
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
        center_x: { type: 'number', description: 'Center X in inches' },
        center_y: { type: 'number', description: 'Center Y in inches' },
        radius: { type: 'number', description: 'Radius in inches' },
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
    description: 'Draw a line from a start point using relative offsets (dx, dy). Useful for chain drawing — "from (x,y), go right 4 and up 2". Open geometry. Coordinates in inches.',
    input_schema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number', description: 'Start X in inches' },
        y: { type: 'number', description: 'Start Y in inches' },
        dx: { type: 'number', description: 'Relative X offset in inches' },
        dy: { type: 'number', description: 'Relative Y offset in inches' },
        z: { type: 'number', description: 'Z plane (default 0)' },
      },
      required: ['x', 'y', 'dx', 'dy'],
    },
  },
  {
    name: 'sketch_polyline',
    description: 'Draw a connected chain of line segments from an array of points. Each point connects to the next. If "closed" is true, last point connects back to first and creates a face (extrudable). Great for complex profiles like brackets, gussets, tabs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        points: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
            },
            required: ['x', 'y'],
          },
          description: 'Array of {x, y} points in inches. Minimum 2 for open, 3 for closed.',
        },
        closed: { type: 'boolean', description: 'If true, close the loop and create a face (default false)' },
        z: { type: 'number', description: 'Z plane (default 0)' },
      },
      required: ['points'],
    },
  },
  {
    name: 'create_flat_profile',
    description: 'Create a closed 2D flat profile from an array of {x, y} points. The profile is a face on the XY plane that can be extruded or exported directly to DXF for plasma cutting. Minimum 3 points. Points are connected in order and the loop is closed automatically.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Name for the profile (e.g. "bracket", "gusset")' },
        points: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
            },
            required: ['x', 'y'],
          },
          description: 'Array of {x, y} points in inches defining the profile outline. Minimum 3 points.',
        },
        z: { type: 'number', description: 'Z plane (default 0)' },
      },
      required: ['points'],
    },
  },
  {
    name: 'extrude',
    description: 'Extrude a 2D sketch face (rectangle, circle, or flat profile) into a 3D solid. Only works on closed sketch entities (not lines or arcs). The sketch is replaced by the resulting solid.',
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
    name: 'revolve',
    description: 'Revolve a 2D sketch face around an axis to create a solid of revolution. Great for vases, turned parts, bushings, rings, pulleys, etc. Only works on closed sketch entities. The sketch is replaced by the resulting solid.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID of the sketch face to revolve' },
        angle_deg: { type: 'number', description: 'Revolution angle in degrees (default: 360 for full revolution)' },
        axis_point_x: { type: 'number', description: 'X coordinate of a point on the revolution axis (default: 0)' },
        axis_point_y: { type: 'number', description: 'Y coordinate of a point on the revolution axis (default: 0)' },
        axis_point_z: { type: 'number', description: 'Z coordinate of a point on the revolution axis (default: 0)' },
        axis_dir_x: { type: 'number', description: 'X component of axis direction (default: 0)' },
        axis_dir_y: { type: 'number', description: 'Y component of axis direction (default: 1, i.e. Y axis)' },
        axis_dir_z: { type: 'number', description: 'Z component of axis direction (default: 0)' },
      },
      required: ['entity_id'],
    },
  },
  {
    name: 'shell',
    description: 'Hollow out a solid, turning it into a thin-walled shell. Removes the top face by default. Wall thickness in inches. Use for enclosures, boxes, containers, etc. Only works on 3D solids.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID of the solid to shell' },
        wall_thickness: { type: 'number', description: 'Wall thickness in inches (positive = outward offset, negative = inward offset)' },
        remove_face: { type: 'string', enum: ['top', 'bottom'], description: 'Which face to remove/open (default: top)' },
      },
      required: ['entity_id', 'wall_thickness'],
    },
  },
  {
    name: 'loft',
    description: 'Create a solid by lofting (blending) between two or more sketch profiles. The profiles must be closed sketches. They are connected in the order given to form a smooth transitional shape. Great for organic shapes, transitions, funnels, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of entity IDs of sketch profiles to loft between (minimum 2). Order matters — profiles are connected in sequence.',
          minItems: 2,
        },
        solid: { type: 'boolean', description: 'True to create a solid (default), false for a shell surface' },
      },
      required: ['entity_ids'],
    },
  },
  {
    name: 'sweep',
    description: 'Sweep a closed sketch profile along a path (spine) to create a solid. The profile is the cross-section shape, and the spine defines the path it follows. Great for pipes, channels, rails, custom extrusions along curves.',
    input_schema: {
      type: 'object' as const,
      properties: {
        profile_id: { type: 'string', description: 'Entity ID of the sketch profile (cross-section) to sweep' },
        spine_id: { type: 'string', description: 'Entity ID of the sketch path (spine) to sweep along — can be a line or arc' },
      },
      required: ['profile_id', 'spine_id'],
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
    description: 'Fold a sheet metal plate along its bend lines into a 3D shape. Replaces the flat plate with the folded version. Use undo to get back to the flat plate. Supports bends on both X and Y axes.',
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
    name: 'cut_bolt_hole',
    description: 'Cut a clearance hole for a standard bolt size (e.g. "3/8", "1/4", "#10"). Uses ASME B18.2.8 standard clearance diameters so bolts fit properly. Preferred over cut_hole when the user specifies a bolt size.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID of the solid to cut' },
        center_x: { type: 'number', description: 'Hole center X position in inches' },
        center_y: { type: 'number', description: 'Hole center Y position in inches' },
        bolt_size: { type: 'string', description: 'Bolt nominal size, e.g. "3/8", "1/4", "#10", "1/2"' },
        fit: { type: 'string', enum: ['close', 'standard', 'loose'], description: 'Clearance fit type. Default: standard' },
      },
      required: ['entity_id', 'center_x', 'center_y', 'bolt_size'],
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
  {
    name: 'measure_distance',
    description: 'Measure the distance between two 3D points. All coordinates in inches. Returns the straight-line distance.',
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
    description: 'Measure properties of an entity: bounding box dimensions, surface area, volume, and total edge length (cut length). Returns all available measurements.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to measure' },
      },
      required: ['entity_id'],
    },
  },
  {
    name: 'save_template',
    description: 'Save the current entity as a reusable part template. Templates are stored on disk and persist across sessions. Use for brackets, gussets, plates, or any commonly repeated part.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to save as template' },
        name: { type: 'string', description: 'Template name (e.g. "4x6 gusset", "mounting bracket")' },
        description: { type: 'string', description: 'Optional description of the part' },
      },
      required: ['entity_id', 'name'],
    },
  },
  {
    name: 'load_template',
    description: 'Load a saved part template and create it in the scene. Returns the new entity ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Template name to load' },
        offset_x: { type: 'number', description: 'X offset for placement (default 0)' },
        offset_y: { type: 'number', description: 'Y offset for placement (default 0)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_templates',
    description: 'List all saved part templates.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'delete_template',
    description: 'Delete a saved part template.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Template name to delete' },
      },
      required: ['name'],
    },
  },
  {
    name: 'nest_preview',
    description: 'Calculate how many copies of a part fit on a standard sheet. Returns count, layout, and material utilization percentage. Axis-aligned placement (no rotation). Useful for quoting jobs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to nest' },
        sheet_width: { type: 'number', description: 'Sheet width in inches (default 48)' },
        sheet_length: { type: 'number', description: 'Sheet length in inches (default 96)' },
        spacing: { type: 'number', description: 'Gap between parts in inches (default 0.25)' },
      },
      required: ['entity_id'],
    },
  },
  {
    name: 'estimate_weight',
    description: 'Estimate the weight of an entity based on its volume and material density. Returns weight in pounds. If the entity has sheet metal material info, uses that. Otherwise, specify a material_type.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to weigh' },
        material_type: { type: 'string', enum: ['mild steel', 'stainless', 'aluminum'], description: 'Material type (auto-detected for sheet metal entities)' },
      },
      required: ['entity_id'],
    },
  },
  {
    name: 'estimate_cost',
    description: 'Estimate material cost and cut cost for a part. Uses volume for material cost ($/lb × weight) and edge length for cut cost ($/inch). Returns itemized breakdown. For sheet metal entities, material is auto-detected.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to price' },
        material_type: { type: 'string', enum: ['mild steel', 'stainless', 'aluminum'], description: 'Material type (auto-detected for sheet metal)' },
        material_cost_per_lb: { type: 'number', description: 'Override material cost per pound (default: mild steel $0.50, stainless $2.00, aluminum $1.50)' },
        cut_cost_per_inch: { type: 'number', description: 'Override cut cost per inch of cut (default: $0.02)' },
        quantity: { type: 'number', description: 'Number of parts (default: 1)' },
      },
      required: ['entity_id'],
    },
  },
  {
    name: 'set_kerf',
    description: 'Set kerf compensation for an entity. Annotates the entity with kerf width and cut side (inside/outside/centerline). DXF export will use layer naming to indicate cut side. Typical plasma kerf: 0.06" for thin, 0.08" for thick.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to annotate' },
        kerf_width: { type: 'number', description: 'Kerf width in inches' },
        cut_side: { type: 'string', enum: ['inside', 'outside', 'centerline'], description: 'Which side of the line the torch follows (default: centerline)' },
      },
      required: ['entity_id', 'kerf_width'],
    },
  },
  {
    name: 'set_custom_bend_table',
    description: 'Set a custom K-factor for a specific material and thickness combination. Overrides the default from the materials database. Use when a shop has calibrated their press brake differently.',
    input_schema: {
      type: 'object' as const,
      properties: {
        material_name: { type: 'string', description: 'Material name (e.g. "16ga mild steel")' },
        k_factor: { type: 'number', description: 'Custom K-factor (typically 0.3-0.5)' },
        inner_bend_radius: { type: 'number', description: 'Optional custom inner bend radius in inches' },
      },
      required: ['material_name', 'k_factor'],
    },
  },
  {
    name: 'get_bend_table',
    description: 'Get the current bend table showing K-factors and bend radii for all materials, including any custom overrides.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

/**
 * Validate that numeric inputs are finite positive numbers where required.
 * Returns an error string if validation fails, or null if OK.
 */
function validatePositive(input: Record<string, any>, ...fields: string[]): string | null {
  for (const f of fields) {
    const val = input[f];
    if (val === undefined || val === null) return `Missing required field: ${f}`;
    if (typeof val !== 'number' || !isFinite(val)) return `${f} must be a finite number, got: ${val}`;
    if (val <= 0) return `${f} must be positive, got: ${val}`;
  }
  return null;
}

function validateNumeric(input: Record<string, any>, ...fields: string[]): string | null {
  for (const f of fields) {
    const val = input[f];
    if (val === undefined || val === null) return `Missing required field: ${f}`;
    if (typeof val !== 'number' || !isFinite(val)) return `${f} must be a finite number, got: ${val}`;
  }
  return null;
}

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
        const boxErr = validatePositive(input, 'width', 'height', 'depth');
        if (boxErr) return JSON.stringify({ success: false, error: boxErr });
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
        const cylErr = validatePositive(input, 'radius', 'height');
        if (cylErr) return JSON.stringify({ success: false, error: cylErr });
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
        const sphErr = validatePositive(input, 'radius');
        if (sphErr) return JSON.stringify({ success: false, error: sphErr });
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

      case 'scale': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }
        if (!input.factor || input.factor <= 0) {
          return JSON.stringify({ success: false, error: 'Scale factor must be a positive number' });
        }
        const newShape = scaleShape(oc, e.shape, input.factor, input.center_x ?? 0, input.center_y ?? 0, input.center_z ?? 0);
        state.replaceShape(input.entity_id, newShape);
        return JSON.stringify({
          success: true,
          entity_id: input.entity_id,
          description: `Scaled ${input.entity_id} by factor ${input.factor}`,
        });
      }

      case 'set_units': {
        const newUnits = input.units as 'inches' | 'mm';
        const oldUnits = state.getUnits();
        state.setUnits(newUnits);
        return JSON.stringify({
          success: true,
          previous_units: oldUnits,
          current_units: newUnits,
          description: `Units changed from ${oldUnits} to ${newUnits}. All new dimensions will be interpreted in ${newUnits}. Existing geometry was NOT rescaled.`,
        });
      }

      case 'get_scene_info': {
        const info = state.getSceneInfo();
        const u = state.getUnits();
        const uLabel = u === 'mm' ? 'mm' : 'in';
        const uSqLabel = u === 'mm' ? 'sq mm' : 'sq in';
        const uCuLabel = u === 'mm' ? 'cu mm' : 'cu in';
        return JSON.stringify({
          success: true,
          units: u,
          entities: info.map(e => ({
            ...e,
            surfaceArea: e.surfaceArea ? `${e.surfaceArea} ${uSqLabel}` : undefined,
            volume: e.volume ? `${e.volume} ${uCuLabel}` : undefined,
            edgeLength: e.edgeLength ? `${e.edgeLength} ${uLabel} (cut length)` : undefined,
          })),
          description: info.length === 0
            ? `Scene is empty (units: ${u})`
            : `Scene (units: ${u}) contains ${info.length} entity(ies): ${info.map((e) => {
                let desc = `${e.id} (${e.name})`;
                const details: string[] = [];
                if (e.surfaceArea) details.push(`area=${e.surfaceArea} ${uSqLabel}`);
                if (e.volume) details.push(`vol=${e.volume} ${uCuLabel}`);
                if (e.edgeLength) details.push(`cut=${e.edgeLength} ${uLabel}`);
                if (details.length) desc += ` [${details.join(', ')}]`;
                return desc;
              }).join(', ')}`,
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

      case 'rename_entity': {
        const renamed = state.renameEntity(input.entity_id, input.name);
        if (!renamed) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }
        return JSON.stringify({ success: true, description: `Renamed ${input.entity_id} to "${input.name}"` });
      }

      case 'duplicate_entity': {
        const srcEntity = state.getEntity(input.entity_id);
        if (!srcEntity) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }
        const offsetX = input.offset_x ?? 1;
        const offsetY = input.offset_y ?? 0;
        const offsetZ = input.offset_z ?? 0;
        // Clone shape via translate
        const copiedShape = translateShape(oc, srcEntity.shape, offsetX, offsetY, offsetZ);
        const copyMeta = { ...srcEntity.metadata };
        const dupEntity = state.addEntity(`${srcEntity.name} (copy)`, srcEntity.type, copiedShape, copyMeta);
        return JSON.stringify({
          success: true,
          entity_id: dupEntity.id,
          description: `Duplicated ${input.entity_id} → ${dupEntity.id} at offset (${offsetX}, ${offsetY}, ${offsetZ})`,
        });
      }

      case 'fillet': {
        const filErr = validatePositive(input, 'radius');
        if (filErr) return JSON.stringify({ success: false, error: filErr });
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }
        if (e.metadata.entityKind === 'sketch') {
          return JSON.stringify({ success: false, error: 'Fillet requires a 3D solid entity. Extrude sketches first.' });
        }
        const filFilter = (input.edge_filter as EdgeFilter) || 'all';
        const filIndices = input.edge_indices as number[] | undefined;
        const filletedShape = filletEdges(oc, e.shape, input.radius, filFilter, filIndices);
        state.replaceShape(input.entity_id, filletedShape);
        const filterDesc = filIndices ? `edges [${filIndices.join(',')}]` : `${filFilter} edges`;
        return JSON.stringify({
          success: true,
          entity_id: input.entity_id,
          description: `Filleted ${filterDesc} of ${input.entity_id} with radius ${input.radius}"`,
        });
      }

      case 'chamfer': {
        const chamErr = validatePositive(input, 'distance');
        if (chamErr) return JSON.stringify({ success: false, error: chamErr });
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }
        if (e.metadata.entityKind === 'sketch') {
          return JSON.stringify({ success: false, error: 'Chamfer requires a 3D solid entity. Extrude sketches first.' });
        }
        const chamFilter = (input.edge_filter as EdgeFilter) || 'all';
        const chamIndices = input.edge_indices as number[] | undefined;
        const chamferedShape = chamferEdges(oc, e.shape, input.distance, chamFilter, chamIndices);
        state.replaceShape(input.entity_id, chamferedShape);
        const chamFilterDesc = chamIndices ? `edges [${chamIndices.join(',')}]` : `${chamFilter} edges`;
        return JSON.stringify({
          success: true,
          entity_id: input.entity_id,
          description: `Chamfered ${chamFilterDesc} of ${input.entity_id} with distance ${input.distance}"`,
        });
      }

      case 'sketch_line': {
        const plane = (input.plane as SketchPlane) || 'XY';
        let shape = createSketchLine(oc, input.x1, input.y1, input.x2, input.y2, input.z ?? 0);
        shape = transformToPlane(oc, shape, plane);
        const entity = state.addEntity(
          `Line (${input.x1},${input.y1})→(${input.x2},${input.y2})`,
          'sketch_line',
          shape,
          { entityKind: 'sketch', plane }
        );
        return JSON.stringify({
          success: true,
          entity_id: entity.id,
          description: `Created line from (${input.x1}, ${input.y1}) to (${input.x2}, ${input.y2}) on ${plane} plane as ${entity.id}. Open geometry — cannot be extruded.`,
        });
      }

      case 'sketch_rectangle': {
        const srErr = validatePositive(input, 'width', 'height');
        if (srErr) return JSON.stringify({ success: false, error: srErr });
        const plane = (input.plane as SketchPlane) || 'XY';
        let shape = createSketchRectangle(oc, input.x, input.y, input.width, input.height, input.z ?? 0);
        shape = transformToPlane(oc, shape, plane);
        const entity = state.addEntity(
          `Rectangle ${input.width}×${input.height} at (${input.x},${input.y})`,
          'sketch_rectangle',
          shape,
          { entityKind: 'sketch', plane }
        );
        return JSON.stringify({
          success: true,
          entity_id: entity.id,
          description: `Created ${input.width}" × ${input.height}" rectangle at (${input.x}, ${input.y}) on ${plane} plane as ${entity.id}. Closed face — can be extruded.`,
        });
      }

      case 'sketch_circle': {
        const scErr = validatePositive(input, 'radius');
        if (scErr) return JSON.stringify({ success: false, error: scErr });
        const plane = (input.plane as SketchPlane) || 'XY';
        let shape = createSketchCircle(oc, input.center_x, input.center_y, input.radius, input.z ?? 0);
        shape = transformToPlane(oc, shape, plane);
        const entity = state.addEntity(
          `Circle r=${input.radius} at (${input.center_x},${input.center_y})`,
          'sketch_circle',
          shape,
          { entityKind: 'sketch', plane }
        );
        return JSON.stringify({
          success: true,
          entity_id: entity.id,
          description: `Created circle radius ${input.radius}" at (${input.center_x}, ${input.center_y}) on ${plane} plane as ${entity.id}. Closed face — can be extruded.`,
        });
      }

      case 'sketch_arc': {
        const plane = (input.plane as SketchPlane) || 'XY';
        let shape = createSketchArc(oc, input.center_x, input.center_y, input.radius, input.start_angle, input.end_angle, input.z ?? 0);
        shape = transformToPlane(oc, shape, plane);
        const entity = state.addEntity(
          `Arc r=${input.radius} ${input.start_angle}°–${input.end_angle}°`,
          'sketch_arc',
          shape,
          { entityKind: 'sketch', plane }
        );
        return JSON.stringify({
          success: true,
          entity_id: entity.id,
          description: `Created arc radius ${input.radius}" from ${input.start_angle}° to ${input.end_angle}° at (${input.center_x}, ${input.center_y}) on ${plane} plane as ${entity.id}. Open geometry — cannot be extruded.`,
        });
      }

      case 'sketch_line_relative': {
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
        return JSON.stringify({
          success: true,
          entity_id: entity.id,
          end_point: { x: x + dx, y: y + dy },
          description: `Created line from (${x}, ${y}) to (${x + dx}, ${y + dy}) [dx=${dx}, dy=${dy}] as ${entity.id}. End point: (${x + dx}, ${y + dy}).`,
        });
      }

      case 'sketch_polyline': {
        const pts = input.points as { x: number; y: number }[];
        const closed = input.closed as boolean ?? false;
        const z = (input.z ?? 0) as number;

        if (pts.length < 2) {
          return JSON.stringify({ success: false, error: 'Polyline requires at least 2 points' });
        }
        if (closed && pts.length < 3) {
          return JSON.stringify({ success: false, error: 'Closed polyline requires at least 3 points' });
        }

        if (closed) {
          // Create a closed face using createFlatProfile
          const shape = createFlatProfile(oc, pts, z);
          const entity = state.addEntity(
            `Profile (${pts.length} pts)`,
            'flat_profile',
            shape,
            { entityKind: 'sketch' }
          );
          return JSON.stringify({
            success: true,
            entity_id: entity.id,
            point_count: pts.length,
            description: `Created closed ${pts.length}-point profile as ${entity.id}. Closed face — can be extruded or exported to DXF.`,
          });
        } else {
          // Create open polyline as individual connected edges in a compound
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
          return JSON.stringify({
            success: true,
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

        if (pts.length < 3) {
          return JSON.stringify({ success: false, error: 'Flat profile requires at least 3 points' });
        }

        const shape = createFlatProfile(oc, pts, z);
        const entity = state.addEntity(
          profileName,
          'flat_profile',
          shape,
          { entityKind: 'sketch' }
        );
        return JSON.stringify({
          success: true,
          entity_id: entity.id,
          point_count: pts.length,
          description: `Created "${profileName}" flat profile with ${pts.length} points as ${entity.id}. Closed face — can be extruded into 3D or exported directly to DXF for plasma cutting.`,
        });
      }

      case 'extrude': {
        const extErr = validatePositive(input, 'height');
        if (extErr) return JSON.stringify({ success: false, error: extErr });
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

      case 'revolve': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }
        if (e.metadata.entityKind !== 'sketch') {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} is already a solid — revolve only works on sketch faces.` });
        }
        if (e.type === 'sketch_line' || e.type === 'sketch_arc') {
          return JSON.stringify({ success: false, error: `Cannot revolve an open ${e.type}. Only closed sketches (rectangles, circles) can be revolved.` });
        }
        const angleDeg = (input.angle_deg as number) ?? 360;
        const apx = (input.axis_point_x as number) ?? 0;
        const apy = (input.axis_point_y as number) ?? 0;
        const apz = (input.axis_point_z as number) ?? 0;
        const adx = (input.axis_dir_x as number) ?? 0;
        const ady = (input.axis_dir_y as number) ?? 1;
        const adz = (input.axis_dir_z as number) ?? 0;
        if (adx === 0 && ady === 0 && adz === 0) {
          return JSON.stringify({ success: false, error: 'Axis direction cannot be zero vector.' });
        }
        const revolved = revolveShape(oc, e.shape, apx, apy, apz, adx, ady, adz, angleDeg);
        state.replaceShape(input.entity_id, revolved);
        e.name = `Revolved ${e.name} ${angleDeg}°`;
        e.type = 'revolution';
        e.metadata.entityKind = 'solid';
        return JSON.stringify({
          success: true,
          entity_id: input.entity_id,
          angle_deg: angleDeg,
          description: `Revolved ${input.entity_id} by ${angleDeg}° around axis → now a 3D solid.`,
        });
      }

      case 'shell': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }
        if (e.metadata.entityKind === 'sketch') {
          return JSON.stringify({ success: false, error: `Cannot shell a sketch. Shell only works on 3D solids.` });
        }
        const wallThickness = input.wall_thickness as number;
        if (wallThickness === 0) {
          return JSON.stringify({ success: false, error: 'Wall thickness cannot be zero.' });
        }
        // Find the face to remove
        const removeFace = (input.remove_face as string) || 'top';
        let targetFace: any = null;
        const faceExplorer = new oc.TopExp_Explorer_2(e.shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
        let bestZ = removeFace === 'top' ? -Infinity : Infinity;
        while (faceExplorer.More()) {
          const face = oc.TopoDS.Face_1(faceExplorer.Current());
          const props = new oc.GProp_GProps_1();
          oc.BRepGProp.SurfaceProperties(face, props, false);
          const centroid = props.CentreOfMass();
          const z = centroid.Z();
          centroid.delete();
          props.delete();
          if ((removeFace === 'top' && z > bestZ) || (removeFace === 'bottom' && z < bestZ)) {
            bestZ = z;
            if (targetFace) targetFace.delete();
            targetFace = face;
          } else {
            face.delete();
          }
          faceExplorer.Next();
        }
        faceExplorer.delete();
        if (!targetFace) {
          return JSON.stringify({ success: false, error: 'Could not find a face to remove.' });
        }
        const shelled = shellShape(oc, e.shape, wallThickness, [targetFace]);
        targetFace.delete();
        state.replaceShape(input.entity_id, shelled);
        e.name = `Shelled ${e.name}`;
        e.type = 'shell';
        return JSON.stringify({
          success: true,
          entity_id: input.entity_id,
          wall_thickness: wallThickness,
          description: `Shelled ${input.entity_id} with ${wallThickness}" wall thickness (${removeFace} face removed).`,
        });
      }

      case 'loft': {
        const entityIds = input.entity_ids as string[];
        if (!entityIds || entityIds.length < 2) {
          return JSON.stringify({ success: false, error: 'Loft requires at least 2 profile entity IDs.' });
        }
        const profiles: any[] = [];
        for (const id of entityIds) {
          const e = state.getEntity(id);
          if (!e) {
            return JSON.stringify({ success: false, error: `Entity ${id} not found` });
          }
          if (e.metadata.entityKind !== 'sketch') {
            return JSON.stringify({ success: false, error: `Entity ${id} is not a sketch. Loft requires sketch profiles.` });
          }
          if (e.type === 'sketch_line' || e.type === 'sketch_arc') {
            return JSON.stringify({ success: false, error: `Cannot loft an open ${e.type}. Only closed sketches can be used as loft profiles.` });
          }
          profiles.push(e.shape);
        }
        const isSolid = input.solid !== false;
        const lofted = loftShapes(oc, profiles, isSolid);
        // Remove source profiles and add the lofted result
        for (const id of entityIds) {
          state.removeEntity(id);
        }
        const loftId = state.addEntity(lofted, 'loft', `Loft (${entityIds.length} profiles)`, { entityKind: 'solid' });
        return JSON.stringify({
          success: true,
          entity_id: loftId,
          profiles: entityIds.length,
          description: `Lofted ${entityIds.length} profiles into a ${isSolid ? 'solid' : 'shell'} → ${loftId}.`,
        });
      }

      case 'sweep': {
        const profileEntity = state.getEntity(input.profile_id);
        if (!profileEntity) {
          return JSON.stringify({ success: false, error: `Profile entity ${input.profile_id} not found` });
        }
        const spineEntity = state.getEntity(input.spine_id);
        if (!spineEntity) {
          return JSON.stringify({ success: false, error: `Spine entity ${input.spine_id} not found` });
        }
        if (profileEntity.metadata.entityKind !== 'sketch') {
          return JSON.stringify({ success: false, error: `Profile ${input.profile_id} is not a sketch.` });
        }
        if (profileEntity.type === 'sketch_line' || profileEntity.type === 'sketch_arc') {
          // Lines/arcs can be spines but not profiles... unless it's the spine
        }
        if (spineEntity.metadata.entityKind !== 'sketch') {
          return JSON.stringify({ success: false, error: `Spine ${input.spine_id} is not a sketch path.` });
        }
        const swept = sweepShape(oc, profileEntity.shape, spineEntity.shape);
        // Remove source entities
        state.removeEntity(input.profile_id as string);
        state.removeEntity(input.spine_id as string);
        const sweepId = state.addEntity(swept, 'sweep', `Sweep`, { entityKind: 'solid' });
        return JSON.stringify({
          success: true,
          entity_id: sweepId,
          description: `Swept profile ${input.profile_id} along spine ${input.spine_id} → ${sweepId}.`,
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

        const classify = input.classify_layers === true;
        const result = exportDxf(oc, shapes, extraLayered, classify);
        const downloadUrl = entityId
          ? `/api/export/dxf?entity_id=${encodeURIComponent(entityId)}`
          : '/api/export/dxf';

        const bendNote = extraLayered?.length ? ` + ${extraLayered.length} bend line(s) on BEND layer` : '';
        const layerNote = classify ? ' Layers: OUTSIDE (perimeter), INSIDE (holes).' : '';
        return JSON.stringify({
          success: true,
          download_url: downloadUrl,
          entity_count: result.entityCount,
          warnings: result.warnings,
          description: `Exported ${label} to DXF (${result.entityCount} entities: lines, arcs, circles${bendNote}).${layerNote} Download: ${downloadUrl}${result.warnings.length > 0 ? '. Warnings: ' + result.warnings.join('; ') : ''}`,
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

      case 'export_stl': {
        const stlEntityId = input.entity_id as string | undefined;
        let stlShapes: any[];
        let stlLabel: string;

        if (stlEntityId) {
          const entity = state.getEntity(stlEntityId);
          if (!entity) {
            return JSON.stringify({ success: false, error: `Entity ${stlEntityId} not found` });
          }
          stlShapes = [entity.shape];
          stlLabel = stlEntityId;
        } else {
          const allEntities = state.getAllEntities();
          if (allEntities.length === 0) {
            return JSON.stringify({ success: false, error: 'Scene is empty — nothing to export' });
          }
          stlShapes = allEntities.map((e) => e.shape);
          stlLabel = `${allEntities.length} entity(ies)`;
        }

        const stlResult = exportStl(oc, stlShapes);
        const stlDownloadUrl = stlEntityId
          ? `/api/export/stl?entity_id=${encodeURIComponent(stlEntityId)}`
          : '/api/export/stl';

        return JSON.stringify({
          success: true,
          download_url: stlDownloadUrl,
          warnings: stlResult.warnings,
          description: `Exported ${stlLabel} to STL for 3D printing. Download: ${stlDownloadUrl}${stlResult.warnings.length > 0 ? '. Warnings: ' + stlResult.warnings.join('; ') : ''}`,
        });
      }

      case 'import_dxf': {
        const dxfContent = input.content as string | undefined;
        if (!dxfContent) {
          return JSON.stringify({
            success: false,
            error: 'No DXF content provided. Ask the user to upload a DXF file using the upload button, or paste the DXF content directly.',
          });
        }

        const parsed = parseDxf(dxfContent);
        if (parsed.entities.length === 0) {
          return JSON.stringify({
            success: false,
            error: 'No supported entities found in DXF file. Only LINE, ARC, CIRCLE, and LWPOLYLINE are supported.',
            warnings: parsed.warnings,
          });
        }

        const { shape, entityCount } = dxfToShapes(oc, parsed);
        const entity = state.addEntity(
          `DXF Import (${entityCount} entities)`,
          'dxf_import',
          shape,
          { entityKind: 'sketch' as const, layers: parsed.layers }
        );

        return JSON.stringify({
          success: true,
          entity_id: entity.id,
          entity_count: entityCount,
          layers: parsed.layers,
          warnings: parsed.warnings,
          skipped: parsed.skipped,
          description: `Imported DXF with ${entityCount} entities (${parsed.layers.join(', ')} layers) as ${entity.id}. ${parsed.skipped > 0 ? `Skipped ${parsed.skipped} unsupported entity types.` : ''} ${parsed.warnings.join('; ')}`.trim(),
        });
      }

      case 'import_step': {
        const stepContent = input.content as string | undefined;
        if (!stepContent) {
          return JSON.stringify({
            success: false,
            error: 'No STEP content provided. Ask the user to upload a STEP file using the upload button.',
          });
        }

        const stepResult = importStep(oc, stepContent);
        if (stepResult.shapes.length === 0) {
          return JSON.stringify({
            success: false,
            error: 'STEP file was read but produced no shapes.',
            warnings: stepResult.warnings,
          });
        }

        const importedIds: string[] = [];
        for (let i = 0; i < stepResult.shapes.length; i++) {
          const entity = state.addEntity(
            `STEP Import ${i + 1}`,
            'step_import',
            stepResult.shapes[i],
            { entityKind: 'solid' as const }
          );
          importedIds.push(entity.id);
        }

        return JSON.stringify({
          success: true,
          entity_ids: importedIds,
          shape_count: stepResult.shapes.length,
          warnings: stepResult.warnings,
          description: `Imported STEP file: ${stepResult.shapes.length} shape(s) → ${importedIds.join(', ')}. ${stepResult.warnings.join('; ')}`.trim(),
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

        const foldedShape = buildFoldedShape(
          oc,
          e.metadata.plateWidth as number,
          e.metadata.plateLength as number,
          e.metadata.thickness as number,
          e.metadata.innerBendRadius as number,
          e.metadata.kFactor as number,
          bends,
          e.shape // pass source shape to propagate holes/cutouts
        );

        // Store flat shape in metadata so we can unfold later, then replace
        e.metadata.flatShape = e.shape;
        e.metadata.folded = true;
        e.metadata.entityKind = 'solid';
        e.name = `Folded ${e.name.replace(/^Folded /, '')}`;
        e.type = 'sheet_metal_folded';
        state.replaceShape(input.entity_id, foldedShape);

        return JSON.stringify({
          success: true,
          entity_id: input.entity_id,
          description: `Folded ${input.entity_id} with ${bends.length} bend(s). Use undo to get back to flat plate.`,
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
        const chErr = validatePositive(input, 'radius');
        if (chErr) return JSON.stringify({ success: false, error: chErr });
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

      case 'cut_bolt_hole': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }
        if (e.metadata.entityKind === 'sketch') {
          return JSON.stringify({ success: false, error: 'Cutout operations require a 3D solid entity. Extrude sketches first.' });
        }

        const fit = input.fit || 'standard';
        const clearance = getBoltClearance(input.bolt_size, fit);
        if (!clearance) {
          const available = Object.keys(BOLT_CLEARANCE).join(', ');
          return JSON.stringify({ success: false, error: `Unknown bolt size "${input.bolt_size}". Available sizes: ${available}` });
        }

        // Auto-detect depth from bounding box
        const bboxBolt = new oc.Bnd_Box_1();
        oc.BRepBndLib.Add(e.shape, bboxBolt, false);
        const bMinBolt = bboxBolt.CornerMin();
        const bMaxBolt = bboxBolt.CornerMax();
        const zMinBolt = bMinBolt.Z(), zMaxBolt = bMaxBolt.Z();
        const autoDepthBolt = input.depth ?? (zMaxBolt - zMinBolt);
        bMinBolt.delete(); bMaxBolt.delete(); bboxBolt.delete();

        const cutterBolt = createCylinder(oc, clearance.radius, autoDepthBolt + 0.01);
        const positionedBolt = translateShape(oc, cutterBolt, input.center_x, input.center_y, zMaxBolt - autoDepthBolt - 0.005);
        cutterBolt.delete();

        const resultBolt = booleanSubtract(oc, e.shape, positionedBolt);
        positionedBolt.delete();
        state.replaceShape(input.entity_id, resultBolt);
        return JSON.stringify({
          success: true,
          entity_id: input.entity_id,
          description: `Cut ${input.bolt_size}" bolt clearance hole (${fit} fit, ø${clearance.diameter}") at (${input.center_x}, ${input.center_y}) in ${input.entity_id}`,
        });
      }

      case 'measure_distance': {
        const x1 = input.x1 ?? 0, y1 = input.y1 ?? 0, z1 = input.z1 ?? 0;
        const x2 = input.x2 ?? 0, y2 = input.y2 ?? 0, z2 = input.z2 ?? 0;
        const dx = (x2 as number) - (x1 as number);
        const dy = (y2 as number) - (y1 as number);
        const dz = (z2 as number) - (z1 as number);
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const rounded = Math.round(dist * 10000) / 10000;
        return JSON.stringify({
          success: true,
          distance: rounded,
          dx: Math.round(Math.abs(dx) * 10000) / 10000,
          dy: Math.round(Math.abs(dy) * 10000) / 10000,
          dz: Math.round(Math.abs(dz) * 10000) / 10000,
          description: `Distance from (${x1}, ${y1}, ${z1}) to (${x2}, ${y2}, ${z2}) = ${rounded}" (ΔX=${Math.abs(dx as number).toFixed(4)}", ΔY=${Math.abs(dy as number).toFixed(4)}", ΔZ=${Math.abs(dz as number).toFixed(4)}")`,
        });
      }

      case 'measure_entity': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }

        const measurements: Record<string, any> = { entity_id: input.entity_id, name: e.name };

        // Bounding box dimensions
        try {
          const bbox = new oc.Bnd_Box_1();
          oc.BRepBndLib.Add(e.shape, bbox, false);
          const bMin = bbox.CornerMin();
          const bMax = bbox.CornerMax();
          const w = Math.round((bMax.X() - bMin.X()) * 10000) / 10000;
          const h = Math.round((bMax.Y() - bMin.Y()) * 10000) / 10000;
          const d = Math.round((bMax.Z() - bMin.Z()) * 10000) / 10000;
          measurements.width = w;
          measurements.height = h;
          measurements.depth = d;
          bMin.delete(); bMax.delete(); bbox.delete();
        } catch { /* skip */ }

        // Surface area
        try {
          const surfProps = new oc.GProp_GProps_1();
          oc.BRepGProp.SurfaceProperties_1(e.shape, surfProps, false);
          measurements.surfaceArea = Math.round(surfProps.Mass() * 10000) / 10000;
          surfProps.delete();
        } catch { /* skip */ }

        // Volume
        try {
          const volProps = new oc.GProp_GProps_1();
          oc.BRepGProp.VolumeProperties_1(e.shape, volProps, false);
          measurements.volume = Math.round(volProps.Mass() * 10000) / 10000;
          volProps.delete();
        } catch { /* skip */ }

        // Total edge length (cut length)
        try {
          const linProps = new oc.GProp_GProps_1();
          oc.BRepGProp.LinearProperties(e.shape, linProps, false);
          measurements.edgeLength = Math.round(linProps.Mass() * 10000) / 10000;
          linProps.delete();
        } catch { /* skip */ }

        // Edge count (useful for selective fillet/chamfer)
        try {
          measurements.edgeCount = countEdges(oc, e.shape);
        } catch { /* skip */ }

        const parts: string[] = [];
        if (measurements.width !== undefined) parts.push(`${measurements.width}" × ${measurements.height}" × ${measurements.depth}" (W×H×D)`);
        if (measurements.surfaceArea !== undefined) parts.push(`surface area = ${measurements.surfaceArea} sq in`);
        if (measurements.volume !== undefined) parts.push(`volume = ${measurements.volume} cu in`);
        if (measurements.edgeLength !== undefined) parts.push(`cut length = ${measurements.edgeLength}"`);
        if (measurements.edgeCount !== undefined) parts.push(`${measurements.edgeCount} edges`);

        return JSON.stringify({
          success: true,
          ...measurements,
          description: `${e.name} (${input.entity_id}): ${parts.join(', ')}`,
        });
      }

      case 'save_template': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }

        // Capture entity info for template
        const templateData: PartTemplate = {
          name: input.name as string,
          description: (input.description as string) || '',
          type: (e.type === 'flat_profile' ? 'flat_profile' : e.type.includes('sheet_metal') ? 'sheet_metal' : 'custom') as any,
          parameters: {
            entityType: e.type,
            entityName: e.name,
            metadata: JSON.parse(JSON.stringify(e.metadata)),
          },
          createdAt: '',
          updatedAt: '',
        };

        // For flat profiles, store the points if available
        // For boxes/cylinders, store dimensions from bounding box
        try {
          const bbox = new oc.Bnd_Box_1();
          oc.BRepBndLib.Add(e.shape, bbox, false);
          const bMin = bbox.CornerMin();
          const bMax = bbox.CornerMax();
          templateData.parameters.dimensions = {
            width: Math.round((bMax.X() - bMin.X()) * 10000) / 10000,
            height: Math.round((bMax.Y() - bMin.Y()) * 10000) / 10000,
            depth: Math.round((bMax.Z() - bMin.Z()) * 10000) / 10000,
          };
          bMin.delete(); bMax.delete(); bbox.delete();
        } catch { /* skip */ }

        // Export DXF content as the portable representation
        try {
          const dxfResult = exportDxf(oc, [e.shape]);
          templateData.parameters.dxfContent = dxfResult.dxfContent;
        } catch { /* skip */ }

        saveTemplate(templateData);
        return JSON.stringify({
          success: true,
          template_name: input.name,
          description: `Saved "${input.name}" as a reusable template. Use load_template to recreate it.`,
        });
      }

      case 'load_template': {
        const template = loadTemplate(input.name as string);
        if (!template) {
          const all = listTemplates();
          const names = all.map(t => t.name).join(', ');
          return JSON.stringify({
            success: false,
            error: `Template "${input.name}" not found. Available: ${names || 'none'}`,
          });
        }

        // Recreate from DXF content if available
        if (template.parameters.dxfContent) {
          const parsed = parseDxf(template.parameters.dxfContent);
          if (parsed.entities.length > 0) {
            const { shape, entityCount } = dxfToShapes(oc, parsed);

            // Apply offset if specified
            let finalShape = shape;
            const offX = (input.offset_x as number) || 0;
            const offY = (input.offset_y as number) || 0;
            if (offX !== 0 || offY !== 0) {
              finalShape = translateShape(oc, shape, offX, offY, 0);
              shape.delete();
            }

            const entity = state.addEntity(
              template.name,
              template.parameters.entityType || 'template',
              finalShape,
              { entityKind: 'sketch' as const, fromTemplate: template.name }
            );

            return JSON.stringify({
              success: true,
              entity_id: entity.id,
              template_name: template.name,
              entity_count: entityCount,
              description: `Loaded template "${template.name}" as ${entity.id} (${entityCount} entities).`,
            });
          }
        }

        return JSON.stringify({
          success: false,
          error: `Template "${input.name}" has no geometry data. It may need to be re-saved.`,
        });
      }

      case 'list_templates': {
        const templates = listTemplates();
        if (templates.length === 0) {
          return JSON.stringify({
            success: true,
            templates: [],
            description: 'No templates saved yet. Use save_template to save a part.',
          });
        }
        const list = templates.map(t => ({
          name: t.name,
          description: t.description,
          type: t.type,
          dimensions: t.parameters.dimensions,
          updatedAt: t.updatedAt,
        }));
        return JSON.stringify({
          success: true,
          templates: list,
          description: `${templates.length} template(s): ${templates.map(t => `"${t.name}" (${t.type})`).join(', ')}`,
        });
      }

      case 'delete_template': {
        const deleted = deleteTemplate(input.name as string);
        return JSON.stringify({
          success: deleted,
          description: deleted ? `Deleted template "${input.name}".` : `Template "${input.name}" not found.`,
        });
      }

      case 'estimate_weight': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }

        // Determine material type
        const matType = (input.material_type || e.metadata.materialType || 'mild steel') as string;
        const density = MATERIAL_DENSITY[matType];
        if (!density) {
          return JSON.stringify({ success: false, error: `Unknown material type: ${matType}. Use 'mild steel', 'stainless', or 'aluminum'.` });
        }

        // Get volume via GProp
        try {
          const volProps = new oc.GProp_GProps_1();
          oc.BRepGProp.VolumeProperties_1(e.shape, volProps, false);
          const volumeCuIn = volProps.Mass();
          volProps.delete();

          const weightLbs = Math.round(volumeCuIn * density * 1000) / 1000;
          const weightOz = Math.round(weightLbs * 16 * 10) / 10;

          return JSON.stringify({
            success: true,
            entity_id: input.entity_id,
            material_type: matType,
            density_lb_per_cu_in: density,
            volume_cu_in: Math.round(volumeCuIn * 10000) / 10000,
            weight_lbs: weightLbs,
            weight_oz: weightOz,
            description: `${e.name}: ${weightLbs} lbs (${weightOz} oz) — ${matType}, ${Math.round(volumeCuIn * 10000) / 10000} cu in`,
          });
        } catch (err: any) {
          return JSON.stringify({ success: false, error: `Volume calculation failed: ${err.message || String(err)}` });
        }
      }

      case 'estimate_cost': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }

        const matType = (input.material_type || e.metadata.materialType || 'mild steel') as string;
        const density = MATERIAL_DENSITY[matType];
        if (!density) {
          return JSON.stringify({ success: false, error: `Unknown material type: ${matType}` });
        }

        const matCostPerLb = input.material_cost_per_lb ?? MATERIAL_COST_PER_LB[matType] ?? 0.50;
        const cutCostPerIn = input.cut_cost_per_inch ?? DEFAULT_CUT_COST_PER_INCH;
        const qty = input.quantity ?? 1;

        try {
          // Volume for material cost
          const volProps = new oc.GProp_GProps_1();
          oc.BRepGProp.VolumeProperties_1(e.shape, volProps, false);
          const volumeCuIn = volProps.Mass();
          volProps.delete();
          const weightLbs = volumeCuIn * density;
          const materialCost = weightLbs * matCostPerLb;

          // Edge length for cut cost
          const linProps = new oc.GProp_GProps_1();
          oc.BRepGProp.LinearProperties(e.shape, linProps, false);
          const cutLengthIn = linProps.Mass();
          linProps.delete();
          const cutCost = cutLengthIn * cutCostPerIn;

          const unitCost = materialCost + cutCost;
          const totalCost = unitCost * qty;

          return JSON.stringify({
            success: true,
            entity_id: input.entity_id,
            material_type: matType,
            weight_lbs: Math.round(weightLbs * 1000) / 1000,
            cut_length_in: Math.round(cutLengthIn * 100) / 100,
            material_cost: Math.round(materialCost * 100) / 100,
            cut_cost: Math.round(cutCost * 100) / 100,
            unit_cost: Math.round(unitCost * 100) / 100,
            quantity: qty,
            total_cost: Math.round(totalCost * 100) / 100,
            rates: { material_per_lb: matCostPerLb, cut_per_inch: cutCostPerIn },
            description: `${e.name}: $${(Math.round(unitCost * 100) / 100).toFixed(2)}/ea (material $${(Math.round(materialCost * 100) / 100).toFixed(2)} + cut $${(Math.round(cutCost * 100) / 100).toFixed(2)})${qty > 1 ? ` × ${qty} = $${(Math.round(totalCost * 100) / 100).toFixed(2)} total` : ''}`,
          });
        } catch (err: any) {
          return JSON.stringify({ success: false, error: `Cost calculation failed: ${err.message || String(err)}` });
        }
      }

      case 'nest_preview': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }

        const sheetW = (input.sheet_width as number) || 48;
        const sheetL = (input.sheet_length as number) || 96;
        const spacing = (input.spacing as number) || 0.25;

        // Get bounding box of the part
        const bbox = new oc.Bnd_Box_1();
        oc.BRepBndLib.Add(e.shape, bbox, false);
        const bMin = bbox.CornerMin();
        const bMax = bbox.CornerMax();
        const partW = bMax.X() - bMin.X();
        const partH = bMax.Y() - bMin.Y();
        bMin.delete(); bMax.delete(); bbox.delete();

        if (partW <= 0 || partH <= 0) {
          return JSON.stringify({ success: false, error: 'Entity has zero-size bounding box' });
        }

        // Calculate axis-aligned nesting (no rotation)
        const cellW = partW + spacing;
        const cellH = partH + spacing;
        const countX_noRot = Math.floor((sheetW + spacing) / cellW);
        const countY_noRot = Math.floor((sheetL + spacing) / cellH);
        const total_noRot = countX_noRot * countY_noRot;

        // Also try 90° rotation
        const cellWr = partH + spacing;
        const cellHr = partW + spacing;
        const countX_rot = Math.floor((sheetW + spacing) / cellWr);
        const countY_rot = Math.floor((sheetL + spacing) / cellHr);
        const total_rot = countX_rot * countY_rot;

        const rotated = total_rot > total_noRot;
        const bestTotal = Math.max(total_noRot, total_rot);
        const bestCountX = rotated ? countX_rot : countX_noRot;
        const bestCountY = rotated ? countY_rot : countY_noRot;
        const usedW = rotated ? partH : partW;
        const usedH = rotated ? partW : partH;

        const partArea = partW * partH; // bounding box area (conservative)
        const sheetArea = sheetW * sheetL;
        const utilization = Math.round((bestTotal * partArea / sheetArea) * 1000) / 10;

        return JSON.stringify({
          success: true,
          entity_id: input.entity_id,
          sheet_size: `${sheetW}" × ${sheetL}"`,
          part_size: `${Math.round(partW * 1000) / 1000}" × ${Math.round(partH * 1000) / 1000}"`,
          rotated,
          grid: `${bestCountX} × ${bestCountY}`,
          total_parts: bestTotal,
          spacing: spacing,
          utilization_percent: utilization,
          description: `${bestTotal} parts fit on ${sheetW}" × ${sheetL}" sheet (${bestCountX}×${bestCountY} grid${rotated ? ', rotated 90°' : ''}, ${spacing}" spacing). Part: ${Math.round(usedW * 1000) / 1000}" × ${Math.round(usedH * 1000) / 1000}". Material utilization: ${utilization}%.`,
        });
      }

      case 'set_kerf': {
        const e = state.getEntity(input.entity_id);
        if (!e) {
          return JSON.stringify({ success: false, error: `Entity ${input.entity_id} not found` });
        }

        const kerfWidth = input.kerf_width as number;
        const cutSide = (input.cut_side as string) || 'centerline';

        if (kerfWidth <= 0 || kerfWidth > 0.5) {
          return JSON.stringify({ success: false, error: `Kerf width ${kerfWidth}" seems wrong. Typical plasma kerf is 0.04"–0.12".` });
        }

        e.metadata.kerfWidth = kerfWidth;
        e.metadata.cutSide = cutSide;

        return JSON.stringify({
          success: true,
          entity_id: input.entity_id,
          kerf_width: kerfWidth,
          cut_side: cutSide,
          description: `Set kerf compensation on ${input.entity_id}: ${kerfWidth}" kerf, ${cutSide} cut. DXF export will use layer "${cutSide.toUpperCase()}_CUT" for this entity.`,
        });
      }

      case 'set_custom_bend_table': {
        const materialName = input.material_name as string;
        const kFactor = input.k_factor as number;
        const bendRadius = input.inner_bend_radius as number | undefined;

        if (kFactor < 0.1 || kFactor > 0.9) {
          return JSON.stringify({ success: false, error: `K-factor ${kFactor} is outside typical range (0.1–0.9). Are you sure?` });
        }

        // Verify material exists in DB
        const mat = findMaterial(materialName);
        if (!mat) {
          return JSON.stringify({ success: false, error: `Material "${materialName}" not found in database.` });
        }

        setCustomBend(materialName, kFactor, bendRadius);

        return JSON.stringify({
          success: true,
          material: materialName,
          k_factor: kFactor,
          inner_bend_radius: bendRadius ?? mat.inner_bend_radius,
          description: `Set custom K-factor ${kFactor} for "${materialName}"${bendRadius ? ` with bend radius ${bendRadius}"` : ''}. This overrides the default (${mat.k_factor}).`,
        });
      }

      case 'get_bend_table': {
        const overrides = getAllBendOverrides();
        const table = MATERIALS_DB.map(m => {
          const override = overrides[m.name.toLowerCase().trim()];
          return {
            name: m.name,
            material_type: m.material_type,
            thickness: m.thickness,
            k_factor: override?.k_factor ?? m.k_factor,
            inner_bend_radius: override?.inner_bend_radius ?? m.inner_bend_radius,
            custom: !!override,
          };
        });
        const customCount = table.filter(t => t.custom).length;
        return JSON.stringify({
          success: true,
          materials: table,
          description: `Bend table: ${table.length} materials${customCount > 0 ? ` (${customCount} with custom overrides)` : ''}`,
        });
      }

      default:
        return JSON.stringify({ success: false, error: `Unknown tool: ${toolName}` });
    }
  } catch (err: any) {
    return JSON.stringify({ success: false, error: err.message || String(err) });
  }
}

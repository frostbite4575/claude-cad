import type { Tool } from '@anthropic-ai/sdk/resources/messages.js';
import type { DocumentState } from '../../state/document-state.js';
import { getOC } from '../../geometry/oc-init.js';
import { revolveShape } from '../../geometry/primitives.js';
import { extrudeShape } from '../../geometry/sketches.js';
import { filletEdges, chamferEdges, countEdges } from '../../geometry/fillets.js';
import type { EdgeFilter } from '../../geometry/fillets.js';
import { shellShape, loftShapes, sweepShape } from '../../geometry/advanced-ops.js';
import { validatePositive, fail, ok } from './validate.js';

export const modelingToolDefs: Tool[] = [
  {
    name: 'extrude',
    description: 'Extrude a 2D sketch face (rectangle, circle, or flat profile) into a 3D solid. Only works on closed sketch entities (not lines or arcs). The sketch is replaced by the resulting solid.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID of the sketch face to extrude' },
        height: { type: 'number', description: 'Extrusion height' },
        direction_x: { type: 'number', description: 'X component of extrusion direction (default 0)' },
        direction_y: { type: 'number', description: 'Y component of extrusion direction (default 0)' },
        direction_z: { type: 'number', description: 'Z component of extrusion direction (default 1)' },
      },
      required: ['entity_id', 'height'],
    },
  },
  {
    name: 'revolve',
    description: 'Revolve a 2D sketch face around an axis to create a solid of revolution. Great for vases, turned parts, bushings, rings, pulleys, etc. Only works on closed sketch entities.',
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
    description: 'Hollow out a solid, turning it into a thin-walled shell. Removes the top face by default. Use for enclosures, boxes, containers, etc. Only works on 3D solids.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID of the solid to shell' },
        wall_thickness: { type: 'number', description: 'Wall thickness (positive = outward offset, negative = inward offset)' },
        remove_face: { type: 'string', enum: ['top', 'bottom'], description: 'Which face to remove/open (default: top)' },
      },
      required: ['entity_id', 'wall_thickness'],
    },
  },
  {
    name: 'loft',
    description: 'Create a solid by lofting (blending) between two or more sketch profiles. Great for organic shapes, transitions, funnels, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of entity IDs of sketch profiles to loft between (minimum 2).',
          minItems: 2,
        },
        solid: { type: 'boolean', description: 'True to create a solid (default), false for a shell surface' },
      },
      required: ['entity_ids'],
    },
  },
  {
    name: 'sweep',
    description: 'Sweep a closed sketch profile along a path (spine) to create a solid. Great for pipes, channels, rails, custom extrusions along curves.',
    input_schema: {
      type: 'object' as const,
      properties: {
        profile_id: { type: 'string', description: 'Entity ID of the sketch profile (cross-section) to sweep' },
        spine_id: { type: 'string', description: 'Entity ID of the sketch path (spine) to sweep along' },
      },
      required: ['profile_id', 'spine_id'],
    },
  },
  {
    name: 'fillet',
    description: 'Round (fillet) edges of a shape with a constant radius. Supports filtering by edge orientation (all, vertical, horizontal, top, bottom) or specific edge indices.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to fillet' },
        radius: { type: 'number', description: 'Fillet radius' },
        edge_filter: { type: 'string', enum: ['all', 'vertical', 'horizontal', 'top', 'bottom'], description: 'Which edges to fillet (default: all)' },
        edge_indices: { type: 'array', items: { type: 'number' }, description: 'Specific 0-based edge indices to fillet (overrides edge_filter)' },
      },
      required: ['entity_id', 'radius'],
    },
  },
  {
    name: 'chamfer',
    description: 'Bevel (chamfer) edges of a shape with a constant distance. Supports filtering by edge orientation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to chamfer' },
        distance: { type: 'number', description: 'Chamfer distance' },
        edge_filter: { type: 'string', enum: ['all', 'vertical', 'horizontal', 'top', 'bottom'], description: 'Which edges to chamfer (default: all)' },
        edge_indices: { type: 'array', items: { type: 'number' }, description: 'Specific 0-based edge indices to chamfer (overrides edge_filter)' },
      },
      required: ['entity_id', 'distance'],
    },
  },
];

export function executeModelingTools(
  toolName: string,
  input: Record<string, any>,
  state: DocumentState
): string | null {
  const oc = getOC();

  switch (toolName) {
    case 'extrude': {
      const err = validatePositive(input, 'height');
      if (err) return fail(err);
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);
      if (e.metadata.entityKind !== 'sketch') {
        return fail(`Entity ${input.entity_id} is already a solid — extrude only works on sketch faces.`);
      }
      if (e.type === 'sketch_line' || e.type === 'sketch_arc') {
        return fail(`Cannot extrude an open ${e.type}. Only closed sketches (rectangles, circles) can be extruded.`);
      }
      const dirX = input.direction_x ?? 0;
      const dirY = input.direction_y ?? 0;
      const dirZ = input.direction_z ?? 1;
      if (dirX === 0 && dirY === 0 && dirZ === 0) {
        return fail('Extrusion direction cannot be zero vector.');
      }
      const solid = extrudeShape(oc, e.shape, input.height, dirX, dirY, dirZ);
      state.replaceShape(input.entity_id, solid);
      e.name = `Extruded ${e.name} h=${input.height}`;
      e.type = 'extrusion';
      e.metadata.entityKind = 'solid';
      return ok({
        entity_id: input.entity_id,
        description: `Extruded ${input.entity_id} by ${input.height}" → now a 3D solid.`,
      });
    }

    case 'revolve': {
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);
      if (e.metadata.entityKind !== 'sketch') {
        return fail(`Entity ${input.entity_id} is already a solid — revolve only works on sketch faces.`);
      }
      if (e.type === 'sketch_line' || e.type === 'sketch_arc') {
        return fail(`Cannot revolve an open ${e.type}. Only closed sketches can be revolved.`);
      }
      const angleDeg = (input.angle_deg as number) ?? 360;
      const apx = (input.axis_point_x as number) ?? 0;
      const apy = (input.axis_point_y as number) ?? 0;
      const apz = (input.axis_point_z as number) ?? 0;
      const adx = (input.axis_dir_x as number) ?? 0;
      const ady = (input.axis_dir_y as number) ?? 1;
      const adz = (input.axis_dir_z as number) ?? 0;
      if (adx === 0 && ady === 0 && adz === 0) {
        return fail('Axis direction cannot be zero vector.');
      }
      const revolved = revolveShape(oc, e.shape, apx, apy, apz, adx, ady, adz, angleDeg);
      state.replaceShape(input.entity_id, revolved);
      e.name = `Revolved ${e.name} ${angleDeg}°`;
      e.type = 'revolution';
      e.metadata.entityKind = 'solid';
      return ok({
        entity_id: input.entity_id,
        angle_deg: angleDeg,
        description: `Revolved ${input.entity_id} by ${angleDeg}° around axis → now a 3D solid.`,
      });
    }

    case 'shell': {
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);
      if (e.metadata.entityKind === 'sketch') {
        return fail('Cannot shell a sketch. Shell only works on 3D solids.');
      }
      const wallThickness = input.wall_thickness as number;
      if (wallThickness === 0) return fail('Wall thickness cannot be zero.');

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
      if (!targetFace) return fail('Could not find a face to remove.');

      const shelled = shellShape(oc, e.shape, wallThickness, [targetFace]);
      targetFace.delete();
      state.replaceShape(input.entity_id, shelled);
      e.name = `Shelled ${e.name}`;
      e.type = 'shell';
      return ok({
        entity_id: input.entity_id,
        wall_thickness: wallThickness,
        description: `Shelled ${input.entity_id} with ${wallThickness}" wall thickness (${removeFace} face removed).`,
      });
    }

    case 'loft': {
      const entityIds = input.entity_ids as string[];
      if (!entityIds || entityIds.length < 2) {
        return fail('Loft requires at least 2 profile entity IDs.');
      }
      const profiles: any[] = [];
      for (const id of entityIds) {
        const e = state.getEntity(id);
        if (!e) return fail(`Entity ${id} not found`);
        if (e.metadata.entityKind !== 'sketch') {
          return fail(`Entity ${id} is not a sketch. Loft requires sketch profiles.`);
        }
        if (e.type === 'sketch_line' || e.type === 'sketch_arc') {
          return fail(`Cannot loft an open ${e.type}. Only closed sketches can be used as loft profiles.`);
        }
        profiles.push(e.shape);
      }
      const isSolid = input.solid !== false;
      const lofted = loftShapes(oc, profiles, isSolid);
      for (const id of entityIds) {
        state.removeEntity(id);
      }
      const entity = state.addEntity(
        `Loft (${entityIds.length} profiles)`,
        'loft',
        lofted,
        { entityKind: 'solid' }
      );
      return ok({
        entity_id: entity.id,
        profiles: entityIds.length,
        description: `Lofted ${entityIds.length} profiles into a ${isSolid ? 'solid' : 'shell'} → ${entity.id}.`,
      });
    }

    case 'sweep': {
      const profileEntity = state.getEntity(input.profile_id);
      if (!profileEntity) return fail(`Profile entity ${input.profile_id} not found`);
      const spineEntity = state.getEntity(input.spine_id);
      if (!spineEntity) return fail(`Spine entity ${input.spine_id} not found`);
      if (profileEntity.metadata.entityKind !== 'sketch') {
        return fail(`Profile ${input.profile_id} is not a sketch.`);
      }
      if (spineEntity.metadata.entityKind !== 'sketch') {
        return fail(`Spine ${input.spine_id} is not a sketch path.`);
      }
      const swept = sweepShape(oc, profileEntity.shape, spineEntity.shape);
      state.removeEntity(input.profile_id as string);
      state.removeEntity(input.spine_id as string);
      const entity = state.addEntity(
        'Sweep',
        'sweep',
        swept,
        { entityKind: 'solid' }
      );
      return ok({
        entity_id: entity.id,
        description: `Swept profile ${input.profile_id} along spine ${input.spine_id} → ${entity.id}.`,
      });
    }

    case 'fillet': {
      const err = validatePositive(input, 'radius');
      if (err) return fail(err);
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);
      if (e.metadata.entityKind === 'sketch') {
        return fail('Fillet requires a 3D solid entity. Extrude sketches first.');
      }
      const filFilter = (input.edge_filter as EdgeFilter) || 'all';
      const filIndices = input.edge_indices as number[] | undefined;
      const filletedShape = filletEdges(oc, e.shape, input.radius, filFilter, filIndices);
      state.replaceShape(input.entity_id, filletedShape);
      const filterDesc = filIndices ? `edges [${filIndices.join(',')}]` : `${filFilter} edges`;
      return ok({
        entity_id: input.entity_id,
        description: `Filleted ${filterDesc} of ${input.entity_id} with radius ${input.radius}"`,
      });
    }

    case 'chamfer': {
      const err = validatePositive(input, 'distance');
      if (err) return fail(err);
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);
      if (e.metadata.entityKind === 'sketch') {
        return fail('Chamfer requires a 3D solid entity. Extrude sketches first.');
      }
      const chamFilter = (input.edge_filter as EdgeFilter) || 'all';
      const chamIndices = input.edge_indices as number[] | undefined;
      const chamferedShape = chamferEdges(oc, e.shape, input.distance, chamFilter, chamIndices);
      state.replaceShape(input.entity_id, chamferedShape);
      const filterDesc = chamIndices ? `edges [${chamIndices.join(',')}]` : `${chamFilter} edges`;
      return ok({
        entity_id: input.entity_id,
        description: `Chamfered ${filterDesc} of ${input.entity_id} with distance ${input.distance}"`,
      });
    }

    default:
      return null;
  }
}

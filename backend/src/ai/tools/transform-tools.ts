import type { Tool } from '@anthropic-ai/sdk/resources/messages.js';
import type { DocumentState } from '../../state/document-state.js';
import { getOC } from '../../geometry/oc-init.js';
import { translateShape, rotateShape, mirrorShape, scaleShape, linearPatternCopies, circularPatternCopies } from '../../geometry/transforms.js';
import { validateNumeric, validateEnum, fail, ok } from './validate.js';

export const transformToolDefs: Tool[] = [
  {
    name: 'translate',
    description: 'Move an entity by an offset.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to move' },
        x: { type: 'number', description: 'X translation' },
        y: { type: 'number', description: 'Y translation' },
        z: { type: 'number', description: 'Z translation' },
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
    name: 'mirror',
    description: 'Mirror an entity across a plane, creating a new mirrored copy (original is kept). Works on both sketches and solids.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to mirror' },
        plane: { type: 'string', enum: ['XY', 'XZ', 'YZ'], description: 'Mirror plane' },
        plane_offset: { type: 'number', description: 'Offset of the mirror plane from origin (default 0). E.g. plane=YZ, offset=3 mirrors across X=3.' },
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
        spacing_x: { type: 'number', description: 'Spacing in X per copy' },
        spacing_y: { type: 'number', description: 'Spacing in Y per copy' },
        spacing_z: { type: 'number', description: 'Spacing in Z per copy (default 0)' },
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
];

export function executeTransformTools(
  toolName: string,
  input: Record<string, any>,
  state: DocumentState
): string | null {
  const oc = getOC();

  switch (toolName) {
    case 'translate': {
      const numErr = validateNumeric(input, 'x', 'y', 'z');
      if (numErr) return fail(numErr);
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);
      const newShape = translateShape(oc, e.shape, input.x, input.y, input.z);
      state.replaceShape(input.entity_id, newShape);
      return ok({
        entity_id: input.entity_id,
        description: `Translated ${input.entity_id} by (${input.x}, ${input.y}, ${input.z})`,
      });
    }

    case 'rotate': {
      const numErr = validateNumeric(input, 'axis_x', 'axis_y', 'axis_z', 'angle_deg');
      if (numErr) return fail(numErr);
      if (input.axis_x === 0 && input.axis_y === 0 && input.axis_z === 0) {
        return fail('Rotation axis cannot be a zero vector.');
      }
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);
      const newShape = rotateShape(oc, e.shape, input.axis_x, input.axis_y, input.axis_z, input.angle_deg);
      state.replaceShape(input.entity_id, newShape);
      return ok({
        entity_id: input.entity_id,
        description: `Rotated ${input.entity_id} by ${input.angle_deg}° around (${input.axis_x}, ${input.axis_y}, ${input.axis_z})`,
      });
    }

    case 'scale': {
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);
      if (!input.factor || input.factor <= 0) return fail('Scale factor must be a positive number');
      const newShape = scaleShape(oc, e.shape, input.factor, input.center_x ?? 0, input.center_y ?? 0, input.center_z ?? 0);
      state.replaceShape(input.entity_id, newShape);
      return ok({
        entity_id: input.entity_id,
        description: `Scaled ${input.entity_id} by factor ${input.factor}`,
      });
    }

    case 'mirror': {
      const planeErr = validateEnum(input.plane, ['XY', 'XZ', 'YZ'], 'plane');
      if (planeErr) return fail(planeErr);
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);
      const mirrored = mirrorShape(oc, e.shape, input.plane, input.plane_offset ?? 0);
      const mirEntity = state.addEntity(
        `Mirror of ${e.name} across ${input.plane}`,
        e.type,
        mirrored,
        { entityKind: e.metadata.entityKind }
      );
      return ok({
        entity_id: mirEntity.id,
        description: `Mirrored ${input.entity_id} across ${input.plane} plane${input.plane_offset ? ` at offset ${input.plane_offset}"` : ''} → new entity ${mirEntity.id}`,
      });
    }

    case 'linear_pattern': {
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);
      if (!input.count || input.count < 1) return fail('Pattern count must be at least 1');
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
      return ok({
        entity_ids: newIds,
        description: `Created ${input.count} linear copies of ${input.entity_id} spaced (${sx}, ${sy}, ${sz})": ${newIds.join(', ')}`,
      });
    }

    case 'circular_pattern': {
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);
      if (!input.count || input.count < 1) return fail('Pattern count must be at least 1');
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
      return ok({
        entity_ids: newIds,
        description: `Created ${input.count} circular copies of ${input.entity_id} around (${cx},${cy},${cz}) over ${fullAngle}°: ${newIds.join(', ')}`,
      });
    }

    case 'duplicate_entity': {
      const srcEntity = state.getEntity(input.entity_id);
      if (!srcEntity) return fail(`Entity ${input.entity_id} not found`);
      const offsetX = input.offset_x ?? 1;
      const offsetY = input.offset_y ?? 0;
      const offsetZ = input.offset_z ?? 0;
      const copiedShape = translateShape(oc, srcEntity.shape, offsetX, offsetY, offsetZ);
      const copyMeta = { ...srcEntity.metadata };
      const dupEntity = state.addEntity(`${srcEntity.name} (copy)`, srcEntity.type, copiedShape, copyMeta);
      return ok({
        entity_id: dupEntity.id,
        description: `Duplicated ${input.entity_id} → ${dupEntity.id} at offset (${offsetX}, ${offsetY}, ${offsetZ})`,
      });
    }

    default:
      return null;
  }
}

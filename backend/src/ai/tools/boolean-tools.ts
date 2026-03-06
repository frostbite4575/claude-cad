import type { Tool } from '@anthropic-ai/sdk/resources/messages.js';
import type { DocumentState } from '../../state/document-state.js';
import { getOC } from '../../geometry/oc-init.js';
import { booleanUnion, booleanSubtract, booleanIntersect } from '../../geometry/booleans.js';
import { fail, ok } from './validate.js';

export const booleanToolDefs: Tool[] = [
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
];

export function executeBooleanTools(
  toolName: string,
  input: Record<string, any>,
  state: DocumentState
): string | null {
  const oc = getOC();

  switch (toolName) {
    case 'boolean_union': {
      const e1 = state.getEntity(input.entity_id_1);
      const e2 = state.getEntity(input.entity_id_2);
      if (!e1 || !e2) return fail('One or both entity IDs not found');
      if (e1.metadata.entityKind === 'sketch' || e2.metadata.entityKind === 'sketch') {
        return fail('Boolean operations require 3D solid entities. Extrude sketches first.');
      }
      const result = booleanUnion(oc, e1.shape, e2.shape);
      state.removeEntity(input.entity_id_1);
      state.removeEntity(input.entity_id_2);
      const entity = state.addEntity(`Union of ${input.entity_id_1} + ${input.entity_id_2}`, 'union', result);
      return ok({
        entity_id: entity.id,
        description: `Fused ${input.entity_id_1} and ${input.entity_id_2} into ${entity.id}`,
      });
    }

    case 'boolean_subtract': {
      const e1 = state.getEntity(input.entity_id_1);
      const e2 = state.getEntity(input.entity_id_2);
      if (!e1 || !e2) return fail('One or both entity IDs not found');
      if (e1.metadata.entityKind === 'sketch' || e2.metadata.entityKind === 'sketch') {
        return fail('Boolean operations require 3D solid entities. Extrude sketches first.');
      }
      const result = booleanSubtract(oc, e1.shape, e2.shape);
      state.removeEntity(input.entity_id_1);
      state.removeEntity(input.entity_id_2);
      const entity = state.addEntity(`${input.entity_id_1} − ${input.entity_id_2}`, 'cut', result);
      return ok({
        entity_id: entity.id,
        description: `Subtracted ${input.entity_id_2} from ${input.entity_id_1}, result is ${entity.id}`,
      });
    }

    case 'boolean_intersect': {
      const e1 = state.getEntity(input.entity_id_1);
      const e2 = state.getEntity(input.entity_id_2);
      if (!e1 || !e2) return fail('One or both entity IDs not found');
      if (e1.metadata.entityKind === 'sketch' || e2.metadata.entityKind === 'sketch') {
        return fail('Boolean operations require 3D solid entities. Extrude sketches first.');
      }
      const result = booleanIntersect(oc, e1.shape, e2.shape);
      state.removeEntity(input.entity_id_1);
      state.removeEntity(input.entity_id_2);
      const entity = state.addEntity(`Intersection of ${input.entity_id_1} ∩ ${input.entity_id_2}`, 'intersection', result);
      return ok({
        entity_id: entity.id,
        description: `Intersection of ${input.entity_id_1} and ${input.entity_id_2} is ${entity.id}`,
      });
    }

    default:
      return null;
  }
}

import type { Tool } from '@anthropic-ai/sdk/resources/messages.js';
import type { DocumentState } from '../../state/document-state.js';
import type { UndoRedoManager } from '../../state/undo-redo.js';
import { fail, ok } from './validate.js';

export const sceneToolDefs: Tool[] = [
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
    description: 'Set the document unit system. Default is inches. Changing units does NOT rescale existing geometry.',
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
    name: 'undo',
    description: 'Undo the last state-changing operation.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'redo',
    description: 'Redo the last undone operation.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

export function executeSceneTools(
  toolName: string,
  input: Record<string, any>,
  state: DocumentState,
  undoManager?: UndoRedoManager
): string | null {
  switch (toolName) {
    case 'get_scene_info': {
      const info = state.getSceneInfo();
      const u = state.getUnits();
      const uLabel = u === 'mm' ? 'mm' : 'in';
      const uSqLabel = u === 'mm' ? 'sq mm' : 'sq in';
      const uCuLabel = u === 'mm' ? 'cu mm' : 'cu in';
      return ok({
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

    case 'set_units': {
      const newUnits = input.units as 'inches' | 'mm';
      const oldUnits = state.getUnits();
      state.setUnits(newUnits);
      return ok({
        previous_units: oldUnits,
        current_units: newUnits,
        description: `Units changed from ${oldUnits} to ${newUnits}. All new dimensions will be interpreted in ${newUnits}. Existing geometry was NOT rescaled.`,
      });
    }

    case 'delete_entity': {
      const removed = state.removeEntity(input.entity_id);
      if (!removed) return fail(`Entity ${input.entity_id} not found`);
      return ok({ description: `Deleted ${input.entity_id}` });
    }

    case 'rename_entity': {
      const renamed = state.renameEntity(input.entity_id, input.name);
      if (!renamed) return fail(`Entity ${input.entity_id} not found`);
      return ok({ description: `Renamed ${input.entity_id} to "${input.name}"` });
    }

    case 'undo': {
      if (!undoManager) return fail('Undo not available');
      const result = undoManager.undo(state);
      return ok({ description: result.description });
    }

    case 'redo': {
      if (!undoManager) return fail('Redo not available');
      const result = undoManager.redo(state);
      return ok({ description: result.description });
    }

    default:
      return null;
  }
}

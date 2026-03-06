import type { Tool } from '@anthropic-ai/sdk/resources/messages.js';
import type { DocumentState } from '../../state/document-state.js';
import { getOC } from '../../geometry/oc-init.js';
import { translateShape } from '../../geometry/transforms.js';
import { exportDxf } from '../../geometry/dxf-export.js';
import { parseDxf, dxfToShapes } from '../../geometry/dxf-import.js';
import { saveTemplate, loadTemplate, listTemplates, deleteTemplate } from '../../state/templates.js';
import type { PartTemplate } from '../../state/templates.js';
import { fail, ok } from './validate.js';

export const templateToolDefs: Tool[] = [
  {
    name: 'save_template',
    description: 'Save the current entity as a reusable part template. Templates persist across sessions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to save as template' },
        name: { type: 'string', description: 'Template name' },
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
];

export function executeTemplateTools(
  toolName: string,
  input: Record<string, any>,
  state: DocumentState
): string | null {
  const oc = getOC();

  switch (toolName) {
    case 'save_template': {
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);

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

      try {
        const dxfResult = exportDxf(oc, [e.shape]);
        templateData.parameters.dxfContent = dxfResult.dxfContent;
      } catch { /* skip */ }

      saveTemplate(templateData);
      return ok({
        template_name: input.name,
        description: `Saved "${input.name}" as a reusable template. Use load_template to recreate it.`,
      });
    }

    case 'load_template': {
      const template = loadTemplate(input.name as string);
      if (!template) {
        const all = listTemplates();
        const names = all.map(t => t.name).join(', ');
        return fail(`Template "${input.name}" not found. Available: ${names || 'none'}`);
      }

      if (template.parameters.dxfContent) {
        const parsed = parseDxf(template.parameters.dxfContent);
        if (parsed.entities.length > 0) {
          const { shape, entityCount } = dxfToShapes(oc, parsed);

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

          return ok({
            entity_id: entity.id,
            template_name: template.name,
            entity_count: entityCount,
            description: `Loaded template "${template.name}" as ${entity.id} (${entityCount} entities).`,
          });
        }
      }

      return fail(`Template "${input.name}" has no geometry data. It may need to be re-saved.`);
    }

    case 'list_templates': {
      const templates = listTemplates();
      if (templates.length === 0) {
        return ok({
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
      return ok({
        templates: list,
        description: `${templates.length} template(s): ${templates.map(t => `"${t.name}" (${t.type})`).join(', ')}`,
      });
    }

    case 'delete_template': {
      const deleted = deleteTemplate(input.name as string);
      if (!deleted) return fail(`Template "${input.name}" not found.`);
      return ok({ description: `Deleted template "${input.name}".` });
    }

    default:
      return null;
  }
}

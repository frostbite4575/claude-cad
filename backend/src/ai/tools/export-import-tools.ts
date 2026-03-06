import type { Tool } from '@anthropic-ai/sdk/resources/messages.js';
import type { DocumentState } from '../../state/document-state.js';
import { getOC } from '../../geometry/oc-init.js';
import { exportDxf, buildBendLineDxfEntities } from '../../geometry/dxf-export.js';
import { parseDxf, dxfToShapes } from '../../geometry/dxf-import.js';
import { exportStep } from '../../geometry/step-export.js';
import { exportStl } from '../../geometry/stl-export.js';
import { importStep } from '../../geometry/step-import.js';
import type { BendLine } from '../../materials/materials.js';
import { fail, ok } from './validate.js';

export const exportImportToolDefs: Tool[] = [
  {
    name: 'export_dxf',
    description: 'Export the scene (or a single entity) as a DXF file. Returns a download URL. DXF output contains only lines, arcs, and circles (no splines) projected onto the XY plane. Use classify_layers=true to auto-assign OUTSIDE/INSIDE layers.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Optional entity ID to export. If omitted, exports all entities.' },
        classify_layers: { type: 'boolean', description: 'If true, auto-classify contours as OUTSIDE (perimeter) or INSIDE (holes/slots) on separate DXF layers.' },
      },
      required: [],
    },
  },
  {
    name: 'export_step',
    description: 'Export the scene (or a single entity) as a STEP file for interchange with other CAD software. Returns a download URL.',
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
    description: 'Export the scene (or a single entity) as an STL file for 3D printing. Returns a download URL.',
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
    description: 'Import a DXF file. Creates sketch entities from the DXF content (LINE, ARC, CIRCLE, LWPOLYLINE). Note: file upload happens via HTTP POST to /api/import/dxf.',
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
    description: 'Import a STEP file. Creates solid entities from the STEP content. File upload happens via HTTP POST to /api/import/step.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'STEP file content as a string (if provided directly)' },
      },
      required: [],
    },
  },
];

export function executeExportImportTools(
  toolName: string,
  input: Record<string, any>,
  state: DocumentState
): string | null {
  const oc = getOC();

  switch (toolName) {
    case 'export_dxf': {
      const entityId = input.entity_id as string | undefined;
      let shapes: any[];
      let label: string;
      let extraLayered: any[] | undefined;

      if (entityId) {
        const entity = state.getEntity(entityId);
        if (!entity) return fail(`Entity ${entityId} not found`);
        shapes = [entity.shape];
        label = entityId;
        if (entity.metadata.sheetMetal && (entity.metadata.bendLines as BendLine[])?.length > 0) {
          extraLayered = buildBendLineDxfEntities(
            entity.metadata.bendLines as BendLine[],
            entity.metadata.plateWidth as number,
            entity.metadata.plateLength as number
          );
        }
      } else {
        const allEntities = state.getAllEntities();
        if (allEntities.length === 0) return fail('Scene is empty — nothing to export');
        shapes = allEntities.map((e) => e.shape);
        label = `${allEntities.length} entity(ies)`;
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
      return ok({
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
        if (!entity) return fail(`Entity ${entityId} not found`);
        shapes = [entity.shape];
        label = entityId;
      } else {
        const allEntities = state.getAllEntities();
        if (allEntities.length === 0) return fail('Scene is empty — nothing to export');
        shapes = allEntities.map((e) => e.shape);
        label = `${allEntities.length} entity(ies)`;
      }

      const result = exportStep(oc, shapes);
      const downloadUrl = entityId
        ? `/api/export/step?entity_id=${encodeURIComponent(entityId)}`
        : '/api/export/step';

      return ok({
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
        if (!entity) return fail(`Entity ${stlEntityId} not found`);
        stlShapes = [entity.shape];
        stlLabel = stlEntityId;
      } else {
        const allEntities = state.getAllEntities();
        if (allEntities.length === 0) return fail('Scene is empty — nothing to export');
        stlShapes = allEntities.map((e) => e.shape);
        stlLabel = `${allEntities.length} entity(ies)`;
      }

      const stlResult = exportStl(oc, stlShapes);
      const stlDownloadUrl = stlEntityId
        ? `/api/export/stl?entity_id=${encodeURIComponent(stlEntityId)}`
        : '/api/export/stl';

      return ok({
        download_url: stlDownloadUrl,
        warnings: stlResult.warnings,
        description: `Exported ${stlLabel} to STL for 3D printing. Download: ${stlDownloadUrl}${stlResult.warnings.length > 0 ? '. Warnings: ' + stlResult.warnings.join('; ') : ''}`,
      });
    }

    case 'import_dxf': {
      const dxfContent = input.content as string | undefined;
      if (!dxfContent) {
        return fail('No DXF content provided. Ask the user to upload a DXF file using the upload button, or paste the DXF content directly.');
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

      return ok({
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
        return fail('No STEP content provided. Ask the user to upload a STEP file using the upload button.');
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

      return ok({
        entity_ids: importedIds,
        shape_count: stepResult.shapes.length,
        warnings: stepResult.warnings,
        description: `Imported STEP file: ${stepResult.shapes.length} shape(s) → ${importedIds.join(', ')}. ${stepResult.warnings.join('; ')}`.trim(),
      });
    }

    default:
      return null;
  }
}

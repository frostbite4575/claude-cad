import type { Tool } from '@anthropic-ai/sdk/resources/messages.js';
import type { DocumentState } from '../../state/document-state.js';
import { getOC } from '../../geometry/oc-init.js';
import { createFlatPlate, buildFoldedShape } from '../../geometry/sheet-metal.js';
import { findMaterial, calculateBend } from '../../materials/materials.js';
import type { BendLine } from '../../materials/materials.js';
import { validatePositive, validateEnum, fail, ok } from './validate.js';

export const sheetMetalToolDefs: Tool[] = [
  {
    name: 'create_sheet_metal_plate',
    description: 'Create a flat sheet metal plate with a specific material. The plate lies on the XY plane with thickness in Z. Use list_materials to see available materials.',
    input_schema: {
      type: 'object' as const,
      properties: {
        width: { type: 'number', description: 'Plate width (X)' },
        length: { type: 'number', description: 'Plate length (Y)' },
        material: { type: 'string', description: 'Material name, e.g. "1/4 mild steel". Use list_materials to see options.' },
        thickness_override: { type: 'number', description: 'Optional custom thickness. Overrides the material default.' },
      },
      required: ['width', 'length', 'material'],
    },
  },
  {
    name: 'add_bend_line',
    description: 'Add a bend line to a sheet metal plate. Position is the distance from the left edge (for Y-axis bends) or bottom edge (for X-axis bends).',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID of the sheet metal plate' },
        position: { type: 'number', description: 'Distance from edge' },
        axis: { type: 'string', enum: ['X', 'Y'], description: 'Axis the bend line runs along.' },
        angle_deg: { type: 'number', description: 'Bend angle in degrees (e.g. 90)' },
        direction: { type: 'string', enum: ['up', 'down'], description: 'Fold direction: up = toward +Z, down = toward -Z' },
      },
      required: ['entity_id', 'position', 'axis', 'angle_deg', 'direction'],
    },
  },
  {
    name: 'fold_sheet_metal',
    description: 'Fold a sheet metal plate along its bend lines into a 3D shape. Replaces the flat plate with the folded version. Use undo to get back to the flat plate.',
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
    description: 'Get flat pattern information for a sheet metal plate: dimensions, material, bend lines, and bend calculations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID of the sheet metal plate' },
      },
      required: ['entity_id'],
    },
  },
];

export function executeSheetMetalTools(
  toolName: string,
  input: Record<string, any>,
  state: DocumentState
): string | null {
  const oc = getOC();

  switch (toolName) {
    case 'create_sheet_metal_plate': {
      const dimErr = validatePositive(input, 'width', 'length');
      if (dimErr) return fail(dimErr);
      const mat = findMaterial(input.material);
      if (!mat) return fail(`Material "${input.material}" not found. Use list_materials to see available options.`);
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
      return ok({
        entity_id: entity.id,
        description: `Created ${input.width}" × ${input.length}" sheet metal plate (${mat.name}, ${thickness}" thick) as ${entity.id}`,
      });
    }

    case 'add_bend_line': {
      const posErr = validatePositive(input, 'position', 'angle_deg');
      if (posErr) return fail(posErr);
      const axErr = validateEnum(input.axis, ['X', 'Y'], 'axis');
      if (axErr) return fail(axErr);
      const dirErr = validateEnum(input.direction, ['up', 'down'], 'direction');
      if (dirErr) return fail(dirErr);
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);
      if (!e.metadata.sheetMetal) {
        return fail(`Entity ${input.entity_id} is not a sheet metal plate. Use create_sheet_metal_plate first.`);
      }

      const maxPos = (input.axis === 'X' ? e.metadata.plateLength : e.metadata.plateWidth) as number;
      if (input.position <= 0 || input.position >= maxPos) {
        return fail(`Bend position ${input.position}" is out of bounds. Must be between 0 and ${maxPos}" for ${input.axis}-axis bends.`);
      }

      const bendId = `bend_${(e.metadata.bendLines as BendLine[]).length + 1}`;
      const newBend: BendLine = {
        id: bendId,
        position: input.position,
        axis: input.axis,
        angle_deg: input.angle_deg,
        direction: input.direction,
      };

      const oldBends = e.metadata.bendLines as BendLine[];
      e.metadata.bendLines = [...oldBends, newBend];

      const calc = calculateBend(
        e.metadata.thickness as number,
        e.metadata.innerBendRadius as number,
        e.metadata.kFactor as number,
        input.angle_deg
      );

      return ok({
        entity_id: input.entity_id,
        bend_id: bendId,
        bend_calculation: calc,
        description: `Added ${input.angle_deg}° ${input.direction} bend at ${input.position}" along ${input.axis}-axis on ${input.entity_id}. BA=${calc.bend_allowance}", BD=${calc.bend_deduction}"`,
      });
    }

    case 'fold_sheet_metal': {
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);
      if (!e.metadata.sheetMetal) return fail(`Entity ${input.entity_id} is not a sheet metal plate.`);
      const bends = e.metadata.bendLines as BendLine[];
      if (bends.length === 0) return fail('No bend lines defined. Use add_bend_line first.');

      const foldedShape = buildFoldedShape(
        oc,
        e.metadata.plateWidth as number,
        e.metadata.plateLength as number,
        e.metadata.thickness as number,
        e.metadata.innerBendRadius as number,
        e.metadata.kFactor as number,
        bends,
        e.shape
      );

      e.metadata.flatShape = e.shape;
      e.metadata.folded = true;
      e.metadata.entityKind = 'solid';
      e.name = `Folded ${e.name.replace(/^Folded /, '')}`;
      e.type = 'sheet_metal_folded';
      state.replaceShape(input.entity_id, foldedShape);

      return ok({
        entity_id: input.entity_id,
        description: `Folded ${input.entity_id} with ${bends.length} bend(s). Use undo to get back to flat plate.`,
      });
    }

    case 'get_flat_pattern': {
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);
      if (!e.metadata.sheetMetal) return fail(`Entity ${input.entity_id} is not a sheet metal plate.`);

      const bends = e.metadata.bendLines as BendLine[];
      const bendDetails = bends.map(b => {
        const calc = calculateBend(
          e.metadata.thickness as number,
          e.metadata.innerBendRadius as number,
          e.metadata.kFactor as number,
          b.angle_deg
        );
        return { id: b.id, position: b.position, axis: b.axis, angle_deg: b.angle_deg, direction: b.direction, ...calc };
      });

      const totalBA = bendDetails.reduce((sum, b) => sum + b.bend_allowance, 0);
      const totalBD = bendDetails.reduce((sum, b) => sum + b.bend_deduction, 0);

      return ok({
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

    default:
      return null;
  }
}

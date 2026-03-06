import type { Tool } from '@anthropic-ai/sdk/resources/messages.js';
import type { DocumentState } from '../../state/document-state.js';
import { getOC } from '../../geometry/oc-init.js';
import { MATERIALS_DB, findMaterial, MATERIAL_DENSITY, MATERIAL_COST_PER_LB, DEFAULT_CUT_COST_PER_INCH, setCustomBend, getAllBendOverrides } from '../../materials/materials.js';
import { fail, ok } from './validate.js';

export const materialToolDefs: Tool[] = [
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
    name: 'estimate_weight',
    description: 'Estimate the weight of an entity based on its volume and material density. Returns weight in pounds.',
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
    description: 'Estimate material cost and cut cost for a part. Returns itemized breakdown.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to price' },
        material_type: { type: 'string', enum: ['mild steel', 'stainless', 'aluminum'], description: 'Material type (auto-detected for sheet metal)' },
        material_cost_per_lb: { type: 'number', description: 'Override material cost per pound' },
        cut_cost_per_inch: { type: 'number', description: 'Override cut cost per inch of cut' },
        quantity: { type: 'number', description: 'Number of parts (default: 1)' },
      },
      required: ['entity_id'],
    },
  },
  {
    name: 'nest_preview',
    description: 'Calculate how many copies of a part fit on a standard sheet. Returns count, layout, and material utilization percentage.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to nest' },
        sheet_width: { type: 'number', description: 'Sheet width (default 48)' },
        sheet_length: { type: 'number', description: 'Sheet length (default 96)' },
        spacing: { type: 'number', description: 'Gap between parts (default 0.25)' },
      },
      required: ['entity_id'],
    },
  },
  {
    name: 'set_kerf',
    description: 'Set kerf compensation for an entity. DXF export will use layer naming to indicate cut side.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID to annotate' },
        kerf_width: { type: 'number', description: 'Kerf width' },
        cut_side: { type: 'string', enum: ['inside', 'outside', 'centerline'], description: 'Which side of the line the tool follows (default: centerline)' },
      },
      required: ['entity_id', 'kerf_width'],
    },
  },
  {
    name: 'set_custom_bend_table',
    description: 'Set a custom K-factor for a specific material and thickness combination. Overrides the default from the materials database.',
    input_schema: {
      type: 'object' as const,
      properties: {
        material_name: { type: 'string', description: 'Material name (e.g. "16ga mild steel")' },
        k_factor: { type: 'number', description: 'Custom K-factor (typically 0.3-0.5)' },
        inner_bend_radius: { type: 'number', description: 'Optional custom inner bend radius' },
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

export function executeMaterialTools(
  toolName: string,
  input: Record<string, any>,
  state: DocumentState
): string | null {
  const oc = getOC();

  switch (toolName) {
    case 'list_materials': {
      const table = MATERIALS_DB.map(m => ({
        name: m.name,
        type: m.material_type,
        thickness: m.thickness,
        bend_radius: m.inner_bend_radius,
        k_factor: m.k_factor,
      }));
      return ok({
        materials: table,
        description: `Available materials: ${table.map(m => `${m.name} (${m.thickness}" thick)`).join(', ')}`,
      });
    }

    case 'estimate_weight': {
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);
      const matType = (input.material_type || e.metadata.materialType || 'mild steel') as string;
      const density = MATERIAL_DENSITY[matType];
      if (!density) return fail(`Unknown material type: ${matType}. Use 'mild steel', 'stainless', or 'aluminum'.`);

      try {
        const volProps = new oc.GProp_GProps_1();
        oc.BRepGProp.VolumeProperties_1(e.shape, volProps, false);
        const volumeCuIn = volProps.Mass();
        volProps.delete();
        const weightLbs = Math.round(volumeCuIn * density * 1000) / 1000;
        const weightOz = Math.round(weightLbs * 16 * 10) / 10;
        return ok({
          entity_id: input.entity_id,
          material_type: matType,
          density_lb_per_cu_in: density,
          volume_cu_in: Math.round(volumeCuIn * 10000) / 10000,
          weight_lbs: weightLbs,
          weight_oz: weightOz,
          description: `${e.name}: ${weightLbs} lbs (${weightOz} oz) — ${matType}, ${Math.round(volumeCuIn * 10000) / 10000} cu in`,
        });
      } catch (err: any) {
        return fail(`Volume calculation failed: ${err.message || String(err)}`);
      }
    }

    case 'estimate_cost': {
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);
      const matType = (input.material_type || e.metadata.materialType || 'mild steel') as string;
      const density = MATERIAL_DENSITY[matType];
      if (!density) return fail(`Unknown material type: ${matType}`);

      const matCostPerLb = input.material_cost_per_lb ?? MATERIAL_COST_PER_LB[matType] ?? 0.50;
      const cutCostPerIn = input.cut_cost_per_inch ?? DEFAULT_CUT_COST_PER_INCH;
      const qty = input.quantity ?? 1;

      try {
        const volProps = new oc.GProp_GProps_1();
        oc.BRepGProp.VolumeProperties_1(e.shape, volProps, false);
        const volumeCuIn = volProps.Mass();
        volProps.delete();
        const weightLbs = volumeCuIn * density;
        const materialCost = weightLbs * matCostPerLb;

        const linProps = new oc.GProp_GProps_1();
        oc.BRepGProp.LinearProperties(e.shape, linProps, false);
        const cutLengthIn = linProps.Mass();
        linProps.delete();
        const cutCost = cutLengthIn * cutCostPerIn;

        const unitCost = materialCost + cutCost;
        const totalCost = unitCost * qty;

        return ok({
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
        return fail(`Cost calculation failed: ${err.message || String(err)}`);
      }
    }

    case 'nest_preview': {
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);

      const sheetW = (input.sheet_width as number) || 48;
      const sheetL = (input.sheet_length as number) || 96;
      const spacing = (input.spacing as number) || 0.25;

      const bbox = new oc.Bnd_Box_1();
      oc.BRepBndLib.Add(e.shape, bbox, false);
      const bMin = bbox.CornerMin();
      const bMax = bbox.CornerMax();
      const partW = bMax.X() - bMin.X();
      const partH = bMax.Y() - bMin.Y();
      bMin.delete(); bMax.delete(); bbox.delete();

      if (partW <= 0 || partH <= 0) return fail('Entity has zero-size bounding box');

      const cellW = partW + spacing;
      const cellH = partH + spacing;
      const countX_noRot = Math.floor((sheetW + spacing) / cellW);
      const countY_noRot = Math.floor((sheetL + spacing) / cellH);
      const total_noRot = countX_noRot * countY_noRot;

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

      const partArea = partW * partH;
      const sheetArea = sheetW * sheetL;
      const utilization = Math.round((bestTotal * partArea / sheetArea) * 1000) / 10;

      return ok({
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
      if (!e) return fail(`Entity ${input.entity_id} not found`);
      const kerfWidth = input.kerf_width as number;
      const cutSide = (input.cut_side as string) || 'centerline';

      if (kerfWidth <= 0 || kerfWidth > 0.5) {
        return fail(`Kerf width ${kerfWidth}" seems wrong. Typical kerf is 0.04"–0.12".`);
      }

      e.metadata.kerfWidth = kerfWidth;
      e.metadata.cutSide = cutSide;

      return ok({
        entity_id: input.entity_id,
        kerf_width: kerfWidth,
        cut_side: cutSide,
        description: `Set kerf compensation on ${input.entity_id}: ${kerfWidth}" kerf, ${cutSide} cut.`,
      });
    }

    case 'set_custom_bend_table': {
      const materialName = input.material_name as string;
      const kFactor = input.k_factor as number;
      const bendRadius = input.inner_bend_radius as number | undefined;

      if (kFactor < 0.1 || kFactor > 0.9) {
        return fail(`K-factor ${kFactor} is outside typical range (0.1–0.9).`);
      }

      const mat = findMaterial(materialName);
      if (!mat) return fail(`Material "${materialName}" not found in database.`);

      setCustomBend(materialName, kFactor, bendRadius);

      return ok({
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
      return ok({
        materials: table,
        description: `Bend table: ${table.length} materials${customCount > 0 ? ` (${customCount} with custom overrides)` : ''}`,
      });
    }

    default:
      return null;
  }
}

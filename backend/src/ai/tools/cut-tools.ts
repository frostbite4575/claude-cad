import type { Tool } from '@anthropic-ai/sdk/resources/messages.js';
import type { DocumentState } from '../../state/document-state.js';
import { getOC } from '../../geometry/oc-init.js';
import { createBox, createCylinder } from '../../geometry/primitives.js';
import { booleanUnion, booleanSubtract } from '../../geometry/booleans.js';
import { translateShape } from '../../geometry/transforms.js';
import { filletAllEdges } from '../../geometry/fillets.js';
import { getBoltClearance, BOLT_CLEARANCE } from '../../materials/materials.js';
import { validatePositive, fail, ok } from './validate.js';

export const cutToolDefs: Tool[] = [
  {
    name: 'cut_hole',
    description: 'Cut a circular hole in a solid entity. Depth auto-detects from entity geometry (cuts all the way through). Works on any solid including sheet metal plates.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID of the solid to cut' },
        center_x: { type: 'number', description: 'Hole center X position' },
        center_y: { type: 'number', description: 'Hole center Y position' },
        radius: { type: 'number', description: 'Hole radius' },
        depth: { type: 'number', description: 'Optional cut depth. Defaults to entity thickness (cuts through).' },
      },
      required: ['entity_id', 'center_x', 'center_y', 'radius'],
    },
  },
  {
    name: 'cut_bolt_hole',
    description: 'Cut a clearance hole for a standard bolt size (e.g. "3/8", "1/4", "#10"). Uses ASME B18.2.8 standard clearance diameters.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID of the solid to cut' },
        center_x: { type: 'number', description: 'Hole center X position' },
        center_y: { type: 'number', description: 'Hole center Y position' },
        bolt_size: { type: 'string', description: 'Bolt nominal size, e.g. "3/8", "1/4", "#10", "1/2"' },
        fit: { type: 'string', enum: ['close', 'standard', 'loose'], description: 'Clearance fit type. Default: standard' },
      },
      required: ['entity_id', 'center_x', 'center_y', 'bolt_size'],
    },
  },
  {
    name: 'cut_slot',
    description: 'Cut a rectangular or obround slot in a solid entity. Use corner_radius for rounded ends. Depth auto-detects.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID of the solid to cut' },
        center_x: { type: 'number', description: 'Slot center X position' },
        center_y: { type: 'number', description: 'Slot center Y position' },
        width: { type: 'number', description: 'Slot width (X)' },
        height: { type: 'number', description: 'Slot height (Y)' },
        corner_radius: { type: 'number', description: 'Optional corner radius for obround/stadium shape.' },
        depth: { type: 'number', description: 'Optional cut depth. Defaults to entity thickness (cuts through).' },
      },
      required: ['entity_id', 'center_x', 'center_y', 'width', 'height'],
    },
  },
  {
    name: 'cut_pattern_linear',
    description: 'Cut a grid of circular holes in a solid entity. Single undo step for the entire pattern.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string', description: 'Entity ID of the solid to cut' },
        hole_radius: { type: 'number', description: 'Radius of each hole' },
        start_x: { type: 'number', description: 'First hole center X position' },
        start_y: { type: 'number', description: 'First hole center Y position' },
        count_x: { type: 'number', description: 'Number of holes in X direction' },
        count_y: { type: 'number', description: 'Number of holes in Y direction' },
        spacing_x: { type: 'number', description: 'Spacing between holes in X direction' },
        spacing_y: { type: 'number', description: 'Spacing between holes in Y direction' },
        depth: { type: 'number', description: 'Optional cut depth. Defaults to entity thickness (cuts through).' },
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
        hole_radius: { type: 'number', description: 'Radius of each hole' },
        center_x: { type: 'number', description: 'Pattern center X position' },
        center_y: { type: 'number', description: 'Pattern center Y position' },
        pattern_radius: { type: 'number', description: 'Radius of the bolt hole circle' },
        count: { type: 'number', description: 'Number of holes around the circle' },
        start_angle: { type: 'number', description: 'Starting angle in degrees (default 0)' },
        depth: { type: 'number', description: 'Optional cut depth. Defaults to entity thickness (cuts through).' },
      },
      required: ['entity_id', 'hole_radius', 'center_x', 'center_y', 'pattern_radius', 'count'],
    },
  },
];

/** Helper to get auto-detect depth from entity bounding box */
function autoDetectDepth(oc: any, shape: any, inputDepth?: number): { autoDepth: number; zMin: number; zMax: number } {
  const bbox = new oc.Bnd_Box_1();
  oc.BRepBndLib.Add(shape, bbox, false);
  const bMin = bbox.CornerMin();
  const bMax = bbox.CornerMax();
  const zMin = bMin.Z(), zMax = bMax.Z();
  const autoDepth = inputDepth ?? (zMax - zMin);
  bMin.delete(); bMax.delete(); bbox.delete();
  return { autoDepth, zMin, zMax };
}

export function executeCutTools(
  toolName: string,
  input: Record<string, any>,
  state: DocumentState
): string | null {
  const oc = getOC();

  switch (toolName) {
    case 'cut_hole': {
      const chErr = validatePositive(input, 'radius');
      if (chErr) return fail(chErr);
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);
      if (e.metadata.entityKind === 'sketch') {
        return fail('Cutout operations require a 3D solid entity. Extrude sketches first.');
      }

      const { autoDepth, zMax } = autoDetectDepth(oc, e.shape, input.depth);
      const cutter = createCylinder(oc, input.radius, autoDepth + 0.01);
      const positioned = translateShape(oc, cutter, input.center_x, input.center_y, zMax - autoDepth - 0.005);
      cutter.delete();

      const result = booleanSubtract(oc, e.shape, positioned);
      positioned.delete();
      state.replaceShape(input.entity_id, result);
      return ok({
        entity_id: input.entity_id,
        description: `Cut ø${input.radius * 2}" hole at (${input.center_x}, ${input.center_y}) in ${input.entity_id}`,
      });
    }

    case 'cut_bolt_hole': {
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);
      if (e.metadata.entityKind === 'sketch') {
        return fail('Cutout operations require a 3D solid entity. Extrude sketches first.');
      }

      const fit = input.fit || 'standard';
      const clearance = getBoltClearance(input.bolt_size, fit);
      if (!clearance) {
        const available = Object.keys(BOLT_CLEARANCE).join(', ');
        return fail(`Unknown bolt size "${input.bolt_size}". Available sizes: ${available}`);
      }

      const { autoDepth, zMax } = autoDetectDepth(oc, e.shape, input.depth);
      const cutterBolt = createCylinder(oc, clearance.radius, autoDepth + 0.01);
      const positionedBolt = translateShape(oc, cutterBolt, input.center_x, input.center_y, zMax - autoDepth - 0.005);
      cutterBolt.delete();

      const resultBolt = booleanSubtract(oc, e.shape, positionedBolt);
      positionedBolt.delete();
      state.replaceShape(input.entity_id, resultBolt);
      return ok({
        entity_id: input.entity_id,
        description: `Cut ${input.bolt_size}" bolt clearance hole (${fit} fit, ø${clearance.diameter}") at (${input.center_x}, ${input.center_y}) in ${input.entity_id}`,
      });
    }

    case 'cut_slot': {
      const dimErr = validatePositive(input, 'width', 'height');
      if (dimErr) return fail(dimErr);
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);
      if (e.metadata.entityKind === 'sketch') {
        return fail('Cutout operations require a 3D solid entity. Extrude sketches first.');
      }

      const { autoDepth, zMax } = autoDetectDepth(oc, e.shape, input.depth);
      const cutDepth = autoDepth + 0.01;
      let cutter: any;

      if (input.corner_radius && input.corner_radius > 0) {
        const cr = Math.min(input.corner_radius, Math.min(input.width, input.height) / 2);
        const rawBox = createBox(oc, input.width, input.height, cutDepth);
        cutter = filletAllEdges(oc, rawBox, cr);
        rawBox.delete();
      } else {
        cutter = createBox(oc, input.width, input.height, cutDepth);
      }

      const positioned = translateShape(
        oc, cutter,
        input.center_x - input.width / 2,
        input.center_y - input.height / 2,
        zMax - autoDepth - 0.005
      );
      cutter.delete();

      const result = booleanSubtract(oc, e.shape, positioned);
      positioned.delete();
      state.replaceShape(input.entity_id, result);

      const shapeDesc = input.corner_radius ? `obround (r=${input.corner_radius}")` : 'rectangular';
      return ok({
        entity_id: input.entity_id,
        description: `Cut ${input.width}" × ${input.height}" ${shapeDesc} slot at (${input.center_x}, ${input.center_y}) in ${input.entity_id}`,
      });
    }

    case 'cut_pattern_linear': {
      const radErr = validatePositive(input, 'hole_radius');
      if (radErr) return fail(radErr);
      if (!input.count_x || input.count_x < 1 || !input.count_y || input.count_y < 1) {
        return fail('count_x and count_y must be at least 1');
      }
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);
      if (e.metadata.entityKind === 'sketch') {
        return fail('Cutout operations require a 3D solid entity. Extrude sketches first.');
      }

      const { autoDepth, zMax } = autoDetectDepth(oc, e.shape, input.depth);
      const cutDepth = autoDepth + 0.01;
      const zStart = zMax - autoDepth - 0.005;
      const totalHoles = input.count_x * input.count_y;

      let compound: any = null;
      for (let iy = 0; iy < input.count_y; iy++) {
        for (let ix = 0; ix < input.count_x; ix++) {
          const cx = input.start_x + ix * input.spacing_x;
          const cy = input.start_y + iy * input.spacing_y;
          const cyl = createCylinder(oc, input.hole_radius, cutDepth);
          const pos = translateShape(oc, cyl, cx, cy, zStart);
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

      const result = booleanSubtract(oc, e.shape, compound);
      compound.delete();
      state.replaceShape(input.entity_id, result);
      return ok({
        entity_id: input.entity_id,
        description: `Cut ${input.count_x}×${input.count_y} grid (${totalHoles} holes, ø${input.hole_radius * 2}") starting at (${input.start_x}, ${input.start_y}) in ${input.entity_id}`,
      });
    }

    case 'cut_pattern_circular': {
      const radErr = validatePositive(input, 'hole_radius', 'pattern_radius');
      if (radErr) return fail(radErr);
      if (!input.count || input.count < 1) return fail('count must be at least 1');
      const e = state.getEntity(input.entity_id);
      if (!e) return fail(`Entity ${input.entity_id} not found`);
      if (e.metadata.entityKind === 'sketch') {
        return fail('Cutout operations require a 3D solid entity. Extrude sketches first.');
      }

      const { autoDepth, zMax } = autoDetectDepth(oc, e.shape, input.depth);
      const cutDepth = autoDepth + 0.01;
      const zStart = zMax - autoDepth - 0.005;
      const startAngle = (input.start_angle ?? 0) * Math.PI / 180;
      const angleStep = (2 * Math.PI) / input.count;

      let compound: any = null;
      for (let i = 0; i < input.count; i++) {
        const angle = startAngle + i * angleStep;
        const hx = input.center_x + input.pattern_radius * Math.cos(angle);
        const hy = input.center_y + input.pattern_radius * Math.sin(angle);
        const cyl = createCylinder(oc, input.hole_radius, cutDepth);
        const pos = translateShape(oc, cyl, hx, hy, zStart);
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

      const result = booleanSubtract(oc, e.shape, compound);
      compound.delete();
      state.replaceShape(input.entity_id, result);
      return ok({
        entity_id: input.entity_id,
        description: `Cut ${input.count}-hole bolt circle (ø${input.hole_radius * 2}" holes, ${input.pattern_radius}" radius) at (${input.center_x}, ${input.center_y}) in ${input.entity_id}`,
      });
    }

    default:
      return null;
  }
}

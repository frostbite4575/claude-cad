import type { Tool } from '@anthropic-ai/sdk/resources/messages.js';
import type { DocumentState } from '../../state/document-state.js';
import type { UndoRedoManager } from '../../state/undo-redo.js';

import { primitiveToolDefs, executePrimitiveTools } from './primitive-tools.js';
import { booleanToolDefs, executeBooleanTools } from './boolean-tools.js';
import { transformToolDefs, executeTransformTools } from './transform-tools.js';
import { sketchToolDefs, executeSketchTools } from './sketch-tools.js';
import { modelingToolDefs, executeModelingTools } from './modeling-tools.js';
import { cutToolDefs, executeCutTools } from './cut-tools.js';
import { sheetMetalToolDefs, executeSheetMetalTools } from './sheet-metal-tools.js';
import { exportImportToolDefs, executeExportImportTools } from './export-import-tools.js';
import { sceneToolDefs, executeSceneTools } from './scene-tools.js';
import { measurementToolDefs, executeMeasurementTools } from './measurement-tools.js';
import { materialToolDefs, executeMaterialTools } from './material-tools.js';
import { templateToolDefs, executeTemplateTools } from './template-tools.js';

/** All tool definitions for the Anthropic API */
export const cadTools: Tool[] = [
  ...primitiveToolDefs,
  ...booleanToolDefs,
  ...transformToolDefs,
  ...sketchToolDefs,
  ...modelingToolDefs,
  ...cutToolDefs,
  ...sheetMetalToolDefs,
  ...exportImportToolDefs,
  ...sceneToolDefs,
  ...measurementToolDefs,
  ...materialToolDefs,
  ...templateToolDefs,
];

/** Dispatch a tool call to the appropriate module */
export function executeTool(
  state: DocumentState,
  toolName: string,
  input: Record<string, any>,
  undoManager?: UndoRedoManager
): string {
  try {
    // Try each module in order. Each returns null if the tool isn't handled.
    const result =
      executePrimitiveTools(toolName, input, state) ??
      executeBooleanTools(toolName, input, state) ??
      executeTransformTools(toolName, input, state) ??
      executeSketchTools(toolName, input, state) ??
      executeModelingTools(toolName, input, state) ??
      executeCutTools(toolName, input, state) ??
      executeSheetMetalTools(toolName, input, state) ??
      executeExportImportTools(toolName, input, state) ??
      executeSceneTools(toolName, input, state, undoManager) ??
      executeMeasurementTools(toolName, input, state) ??
      executeMaterialTools(toolName, input, state) ??
      executeTemplateTools(toolName, input, state);

    if (result !== null) return result;

    return JSON.stringify({ success: false, error: `Unknown tool: ${toolName}` });
  } catch (err: any) {
    return JSON.stringify({ success: false, error: err.message || String(err) });
  }
}

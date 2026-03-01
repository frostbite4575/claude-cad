import type { MessageParam, ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js';
import { getAnthropicClient } from './anthropic-client.js';
import { cadTools, executeTool } from './tools.js';
import type { DocumentState } from '../state/document-state.js';
import type { UndoRedoManager } from '../state/undo-redo.js';
import type { WSMessage, ChatResponsePayload, ChatToolUsePayload, MeshUpdatePayload } from '../../../shared/index.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = join(__dirname, '..', '..', 'conversation-history.json');

const SYSTEM_PROMPT = `You are Claude CAD, an AI assistant for a browser-based CAD tool designed for metal fabrication and plasma cutting.

Key rules:
- All dimensions are in inches.
- Use the provided tools to create and manipulate 3D geometry.
- After creating or modifying geometry, briefly confirm what you did.
- When the user asks about the scene, use get_scene_info to check.
- Be concise and practical — this is a shop-floor tool.

2D Sketch workflow:
- Use sketch_rectangle, sketch_circle, sketch_line, sketch_arc to draw 2D profiles on the XY plane.
- Sketches appear as cyan outlines in the viewport.
- Closed sketches (rectangle, circle) can be extruded into 3D solids with the extrude tool.
- Open sketches (line, arc) cannot be extruded.
- For flat plasma-cut parts: draw a sketch and export DXF directly — no need to extrude.
- For 3D parts: draw a sketch, then extrude it.
- Boolean, fillet, and chamfer operations only work on 3D solids, not sketches.
- When the user says "draw" or asks for a 2D shape, prefer sketch tools. When they say "create" a 3D shape or specify depth/thickness, use create_box/create_cylinder or sketch + extrude.

Mirror & Pattern tools:
- Use mirror to reflect geometry across XY, XZ, or YZ planes. The original is kept; a new mirrored copy is created. Use plane_offset to mirror across a shifted plane (e.g. mirror across X=3 → plane=YZ, offset=3).
- Use linear_pattern for rows of repeated features (e.g. evenly spaced holes, mounting slots).
- Use circular_pattern for bolt hole circles and radial patterns. Default: copies around Z axis at origin over 360°.

Sheet metal workflow (flat-first):
- Use create_sheet_metal_plate to start (specify material like "1/4 mild steel").
- Use list_materials to see available materials.
- Use add_bend_line to define fold locations. Position = distance from left (Y-axis) or bottom (X-axis) edge.
- Use get_flat_pattern to verify bend calculations before export.
- Use fold_sheet_metal to create a 3D preview (original flat plate is kept).
- Export the flat plate entity with export_dxf for plasma cutting. Bend lines appear on a BEND layer.
- For flat parts without bends, just create the plate and export directly.

Cutout & hole tools:
- Use cut_hole for circular holes (specify center and radius).
- Use cut_slot for rectangular or obround cutouts (use corner_radius for rounded ends).
- Use cut_pattern_linear for grids of holes (e.g. mounting patterns).
- Use cut_pattern_circular for bolt hole circles.
- All cutout tools auto-detect depth from the entity geometry. Works on any solid including sheet metal plates.
- Cutting a sheet metal plate preserves its material and bend line metadata.
- Prefer cutout tools over manual cylinder + translate + boolean_subtract for holes.

Entity selection:
- The user can click entities in the viewport to select them. The currently selected entity is shown in the scene context.
- When the user says "this", "it", "the selected entity", or references a shape without specifying an ID, operate on the currently selected entity from the scene context.
- If no entity is selected and the user's intent is ambiguous, ask them to click the entity or specify an ID.`;

const MODEL = 'claude-opus-4-20250514';
const MAX_TOKENS = 4096;

let conversationHistory: MessageParam[] = loadHistory();

function loadHistory(): MessageParam[] {
  try {
    if (existsSync(HISTORY_PATH)) {
      const data = readFileSync(HISTORY_PATH, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        console.log(`Loaded ${parsed.length} conversation messages from disk`);
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Failed to load conversation history:', err);
  }
  return [];
}

function saveHistory(): void {
  try {
    writeFileSync(HISTORY_PATH, JSON.stringify(conversationHistory, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Failed to save conversation history:', err);
  }
}

export function clearConversationHistory(): void {
  conversationHistory = [];
  saveHistory();
  console.log('Conversation history cleared');
}

// Tools that don't mutate state — no snapshot needed
const READ_ONLY_TOOLS = new Set(['get_scene_info', 'export_dxf', 'export_step', 'undo', 'redo', 'get_flat_pattern', 'list_materials']);

export async function handleChatMessage(
  userMessage: string,
  state: DocumentState,
  sendWS: (msg: WSMessage) => void,
  undoManager?: UndoRedoManager
): Promise<void> {
  // Append scene context to user message
  const sceneInfo = state.getSceneInfo();
  const selectedId = state.getSelectedEntityId();
  const selectedEntity = selectedId ? sceneInfo.find((e) => e.id === selectedId) : null;
  const selectionNote = selectedEntity
    ? `\n[Selected: ${selectedEntity.id} "${selectedEntity.name}" (${selectedEntity.type}, ${selectedEntity.entityKind})]`
    : '';
  const sceneContext = sceneInfo.length === 0
    ? '\n\n[Scene is currently empty]'
    : `\n\n[Current scene: ${sceneInfo.map((e) => `${e.id} "${e.name}" (${e.type}, ${e.entityKind})`).join(', ')}]${selectionNote}`;

  conversationHistory.push({
    role: 'user',
    content: userMessage + sceneContext,
  });

  const client = getAnthropicClient();

  // Agent loop: keep calling API until end_turn
  while (true) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: cadTools,
      messages: conversationHistory,
    });

    // Build the assistant message content for history
    const assistantContent: ContentBlockParam[] = [];

    // Process response content blocks
    let hasToolUse = false;
    const toolResults: ContentBlockParam[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        assistantContent.push({ type: 'text', text: block.text });
        // Send text to client
        if (block.text.trim()) {
          const chatResponse: WSMessage = {
            type: 'chat_response',
            payload: {
              role: 'assistant',
              content: block.text,
              done: response.stop_reason === 'end_turn',
            } satisfies ChatResponsePayload,
          };
          sendWS(chatResponse);
        }
      } else if (block.type === 'tool_use') {
        hasToolUse = true;
        assistantContent.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });

        // Notify client about tool use
        const toolNotification: WSMessage = {
          type: 'chat_tool_use',
          payload: {
            tool: block.name,
            input: block.input as Record<string, unknown>,
          } satisfies ChatToolUsePayload,
        };
        sendWS(toolNotification);

        // Capture snapshot before mutating tools
        if (undoManager && !READ_ONLY_TOOLS.has(block.name)) {
          const inputDesc = block.input as Record<string, any>;
          const desc = `${block.name}(${Object.values(inputDesc).join(', ')})`;
          undoManager.captureSnapshot(state, desc);
        }

        // Execute the tool
        const result = executeTool(state, block.name, block.input as Record<string, any>, undoManager);
        console.log(`Tool ${block.name}:`, result);

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        } as any);

        // Send updated scene mesh after state-changing tools
        if (block.name !== 'get_scene_info') {
          const meshes = state.tessellateAll();
          const meshUpdate: WSMessage = {
            type: 'mesh_update',
            payload: { meshes } satisfies MeshUpdatePayload,
          };
          sendWS(meshUpdate);
        }
      }
    }

    // Add assistant message to history
    conversationHistory.push({
      role: 'assistant',
      content: assistantContent,
    });

    // If no tool use, we're done
    if (!hasToolUse || response.stop_reason === 'end_turn') {
      saveHistory();
      break;
    }

    // Feed tool results back
    conversationHistory.push({
      role: 'user',
      content: toolResults,
    });
  }
}

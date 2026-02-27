import type { MessageParam, ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js';
import { getAnthropicClient } from './anthropic-client.js';
import { cadTools, executeTool } from './tools.js';
import type { DocumentState } from '../state/document-state.js';
import type { UndoRedoManager } from '../state/undo-redo.js';
import type { WSMessage, ChatResponsePayload, ChatToolUsePayload, MeshUpdatePayload } from '../../../shared/index.js';

const SYSTEM_PROMPT = `You are Claude CAD, an AI assistant for a browser-based CAD tool designed for metal fabrication and plasma cutting.

Key rules:
- All dimensions are in inches.
- Use the provided tools to create and manipulate 3D geometry.
- After creating or modifying geometry, briefly confirm what you did.
- When the user asks about the scene, use get_scene_info to check.
- Be concise and practical — this is a shop-floor tool.`;

const MODEL = 'claude-opus-4-20250514';
const MAX_TOKENS = 4096;

const conversationHistory: MessageParam[] = [];

// Tools that don't mutate state — no snapshot needed
const READ_ONLY_TOOLS = new Set(['get_scene_info', 'export_dxf', 'export_step', 'undo', 'redo']);

export async function handleChatMessage(
  userMessage: string,
  state: DocumentState,
  sendWS: (msg: WSMessage) => void,
  undoManager?: UndoRedoManager
): Promise<void> {
  // Append scene context to user message
  const sceneInfo = state.getSceneInfo();
  const sceneContext = sceneInfo.length === 0
    ? '\n\n[Scene is currently empty]'
    : `\n\n[Current scene: ${sceneInfo.map((e) => `${e.id} "${e.name}" (${e.type})`).join(', ')}]`;

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
      break;
    }

    // Feed tool results back
    conversationHistory.push({
      role: 'user',
      content: toolResults,
    });
  }
}

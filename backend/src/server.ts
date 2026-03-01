import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { initOC, getOC } from './geometry/oc-init.js';
import { DocumentState } from './state/document-state.js';
import { UndoRedoManager } from './state/undo-redo.js';
import { handleChatMessage, clearConversationHistory } from './ai/agent-loop.js';
import { exportDxf } from './geometry/dxf-export.js';
import { exportStep } from './geometry/step-export.js';
import { parseDxf, dxfToShapes } from './geometry/dxf-import.js';
import { executeTool } from './ai/tools.js';
import type { WSMessage, MeshUpdatePayload, ChatMessagePayload, EntitySelectedPayload, ToolExecutePayload } from '../../shared/index.js';

const PORT = 3000;

// Prevent silent crashes — log and keep running where possible
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  // If it's a WASM crash or something truly fatal, exit gracefully
  if (err.message?.includes('RuntimeError') || err.message?.includes('memory')) {
    console.error('Fatal WASM error — shutting down');
    process.exit(1);
  }
  // Otherwise keep running — the error was logged
});

const app = express();
app.use(cors({ origin: 'http://localhost:4200' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ limit: '10mb', type: 'text/plain' }));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// DXF export
app.get('/api/export/dxf', (req, res) => {
  if (!docState) {
    res.status(500).json({ error: 'Document state not initialized' });
    return;
  }

  const entityId = req.query.entity_id as string | undefined;
  const oc = getOC();
  let shapes: any[];

  if (entityId) {
    const entity = docState.getEntity(entityId);
    if (!entity) {
      res.status(404).json({ error: `Entity ${entityId} not found` });
      return;
    }
    shapes = [entity.shape];
  } else {
    const allEntities = docState.getAllEntities();
    if (allEntities.length === 0) {
      res.status(400).json({ error: 'Scene is empty — nothing to export' });
      return;
    }
    shapes = allEntities.map((e) => e.shape);
  }

  try {
    const result = exportDxf(oc, shapes);
    res.setHeader('Content-Type', 'application/dxf');
    res.setHeader('Content-Disposition', 'attachment; filename="export.dxf"');
    res.send(result.dxfContent);
  } catch (err: any) {
    console.error('DXF export error:', err);
    res.status(500).json({ error: err.message || 'DXF export failed' });
  }
});

// STEP export
app.get('/api/export/step', (req, res) => {
  if (!docState) {
    res.status(500).json({ error: 'Document state not initialized' });
    return;
  }

  const entityId = req.query.entity_id as string | undefined;
  const oc = getOC();
  let shapes: any[];

  if (entityId) {
    const entity = docState.getEntity(entityId);
    if (!entity) {
      res.status(404).json({ error: `Entity ${entityId} not found` });
      return;
    }
    shapes = [entity.shape];
  } else {
    const allEntities = docState.getAllEntities();
    if (allEntities.length === 0) {
      res.status(400).json({ error: 'Scene is empty — nothing to export' });
      return;
    }
    shapes = allEntities.map((e) => e.shape);
  }

  try {
    const result = exportStep(oc, shapes);
    res.setHeader('Content-Type', 'application/step');
    res.setHeader('Content-Disposition', 'attachment; filename="export.step"');
    res.send(result.stepContent);
  } catch (err: any) {
    console.error('STEP export error:', err);
    res.status(500).json({ error: err.message || 'STEP export failed' });
  }
});

// DXF import
app.post('/api/import/dxf', (req, res) => {
  if (!docState) {
    res.status(500).json({ error: 'Document state not initialized' });
    return;
  }

  try {
    const dxfContent = typeof req.body === 'string' ? req.body : req.body?.content;
    if (!dxfContent || typeof dxfContent !== 'string') {
      res.status(400).json({ error: 'Request body must contain DXF file content as text' });
      return;
    }

    const parsed = parseDxf(dxfContent);
    if (parsed.entities.length === 0) {
      res.status(400).json({ error: 'No supported entities found in DXF file', warnings: parsed.warnings });
      return;
    }

    const oc = getOC();
    const { shape, entityCount } = dxfToShapes(oc, parsed);

    if (undoManager) {
      undoManager.captureSnapshot(docState, 'import_dxf');
    }

    const entity = docState.addEntity(
      `DXF Import (${entityCount} entities)`,
      'dxf_import',
      shape,
      { entityKind: 'sketch' as const, layers: parsed.layers }
    );

    // Broadcast mesh update to all connected clients
    const meshes = docState.tessellateAll();
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'mesh_update', payload: { meshes } }));
      }
    });

    res.json({
      success: true,
      entity_id: entity.id,
      entity_count: entityCount,
      layers: parsed.layers,
      warnings: parsed.warnings,
      skipped: parsed.skipped,
    });
  } catch (err: any) {
    console.error('DXF import error:', err);
    res.status(500).json({ error: err.message || 'DXF import failed' });
  }
});

const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

let docState: DocumentState | null = null;
let undoManager: UndoRedoManager | null = null;

wss.on('connection', (ws: WebSocket) => {
  console.log('WebSocket client connected');

  // Send current scene meshes if any exist
  if (docState) {
    const meshes = docState.tessellateAll();
    if (meshes.length > 0) {
      const message: WSMessage = {
        type: 'mesh_update',
        payload: { meshes } satisfies MeshUpdatePayload,
      };
      ws.send(JSON.stringify(message));
    }
  }

  ws.on('message', async (data) => {
    try {
      const msg: WSMessage = JSON.parse(data.toString());

      const sendWS = (wsMsg: WSMessage) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(wsMsg));
        }
      };

      if (msg.type === 'chat_message' && docState) {
        const { message } = msg.payload as ChatMessagePayload;
        console.log(`Chat: "${message}"`);

        try {
          await handleChatMessage(message, docState, sendWS, undoManager!);
        } catch (err: any) {
          console.error('Agent loop error:', err);
          sendWS({
            type: 'chat_response',
            payload: {
              role: 'assistant',
              content: `Error: ${err.message || 'Something went wrong. Check that ANTHROPIC_API_KEY is set in backend/.env'}`,
              done: true,
            },
          });
        }
      } else if (msg.type === 'undo' && docState && undoManager) {
        const result = undoManager.undo(docState);
        console.log(`Undo: ${result.description}`);
        const meshes = docState.tessellateAll();
        sendWS({ type: 'mesh_update', payload: { meshes } satisfies MeshUpdatePayload });
        sendWS({ type: 'chat_response', payload: { role: 'assistant', content: result.description, done: true } });
      } else if (msg.type === 'redo' && docState && undoManager) {
        const result = undoManager.redo(docState);
        console.log(`Redo: ${result.description}`);
        const meshes = docState.tessellateAll();
        sendWS({ type: 'mesh_update', payload: { meshes } satisfies MeshUpdatePayload });
        sendWS({ type: 'chat_response', payload: { role: 'assistant', content: result.description, done: true } });
      } else if (msg.type === 'tool_execute' && docState && undoManager) {
        const { tool, input } = msg.payload as ToolExecutePayload;
        console.log(`Manual tool: ${tool}`, input);
        undoManager.captureSnapshot(docState, `${tool}(manual)`);
        try {
          executeTool(docState, tool, input as Record<string, any>, undoManager);
          const meshes = docState.tessellateAll();
          sendWS({ type: 'mesh_update', payload: { meshes } satisfies MeshUpdatePayload });
        } catch (err: any) {
          console.error('Tool execute error:', err);
          sendWS({ type: 'error', payload: { message: err.message || 'Tool execution failed' } });
        }
      } else if (msg.type === 'clear_conversation') {
        clearConversationHistory();
        sendWS({ type: 'chat_response', payload: { role: 'assistant', content: 'Conversation history cleared.', done: true } });
      } else if (msg.type === 'entity_selected' && docState) {
        const { entityId } = msg.payload as EntitySelectedPayload;
        docState.setSelectedEntityId(entityId);
        console.log(`Selection: ${entityId ?? 'none'}`);
      }
    } catch (err) {
      console.error('Failed to parse WS message:', err);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});

// Initialize OpenCascade and start server
async function start() {
  const oc = await initOC();
  docState = new DocumentState(oc);
  undoManager = new UndoRedoManager();
  console.log('Document state initialized (empty scene, undo/redo enabled)');

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Backend running on http://127.0.0.1:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start backend:', err);
  process.exit(1);
});

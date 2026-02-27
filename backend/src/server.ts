import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { initOC, getOC } from './geometry/oc-init.js';
import { DocumentState } from './state/document-state.js';
import { UndoRedoManager } from './state/undo-redo.js';
import { handleChatMessage } from './ai/agent-loop.js';
import { exportDxf } from './geometry/dxf-export.js';
import { exportStep } from './geometry/step-export.js';
import type { WSMessage, MeshUpdatePayload, ChatMessagePayload } from '../../shared/index.js';

const PORT = 3000;

const app = express();
app.use(cors({ origin: 'http://localhost:4200' }));
app.use(express.json());

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

  server.listen(PORT, () => {
    console.log(`Backend running on :${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start backend:', err);
  process.exit(1);
});

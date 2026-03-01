export interface TessellatedMesh {
  vertices: number[];
  indices: number[];
  normals: number[];
  edges: number[];
  entityId?: string;
  entityKind?: 'sketch' | 'solid';
  name?: string;
  entityType?: string;
}

export type WSMessageType =
  | 'mesh_update'
  | 'error'
  | 'status'
  | 'chat_message'
  | 'chat_response'
  | 'chat_tool_use'
  | 'scene_info'
  | 'undo'
  | 'redo'
  | 'entity_selected'
  | 'tool_execute'
  | 'clear_conversation';

export interface WSMessage {
  type: WSMessageType;
  payload: unknown;
}

export interface MeshUpdatePayload {
  meshes: TessellatedMesh[];
}

export interface ErrorPayload {
  message: string;
}

export interface StatusPayload {
  message: string;
}

export interface ChatMessagePayload {
  message: string;
}

export interface ChatResponsePayload {
  role: 'assistant';
  content: string;
  done: boolean;
}

export interface ChatToolUsePayload {
  tool: string;
  input: Record<string, unknown>;
}

export interface EntitySelectedPayload {
  entityId: string | null;
}

export interface ToolExecutePayload {
  tool: string;
  input: Record<string, unknown>;
}

export interface EntityInfo {
  id: string;
  name: string;
  type: string;
  entityKind: 'sketch' | 'solid';
  boundingBox: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  surfaceArea?: number;   // square inches
  volume?: number;        // cubic inches
  edgeLength?: number;    // total edge length (cut length) in inches
}

export interface SceneInfoPayload {
  entities: EntityInfo[];
}

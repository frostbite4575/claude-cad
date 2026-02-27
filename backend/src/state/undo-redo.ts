import type { DocumentState } from './document-state.js';

export interface EntitySnapshot {
  id: string;
  name: string;
  type: string;
  shape: any; // Live WASM TopoDS_Shape reference — NOT serializable
  metadata: Record<string, unknown>;
}

export interface StateSnapshot {
  entities: EntitySnapshot[];
  nextId: number;
  description: string;
}

export class UndoRedoManager {
  private undoStack: StateSnapshot[] = [];
  private redoStack: StateSnapshot[] = [];
  private maxDepth = 50;

  captureSnapshot(state: DocumentState, description: string): void {
    const snapshot: StateSnapshot = {
      entities: state.captureSnapshot(),
      nextId: state.getNextId(),
      description,
    };

    this.undoStack.push(snapshot);
    this.evictOldSnapshots();

    // Any new mutation invalidates the redo stack.
    // Clean up shapes that only exist in discarded redo snapshots.
    this.discardStack(this.redoStack, state);
    this.redoStack = [];
  }

  undo(state: DocumentState): { success: boolean; description: string } {
    if (this.undoStack.length === 0) {
      return { success: false, description: 'Nothing to undo' };
    }

    // Save current state as redo snapshot
    const redoSnapshot: StateSnapshot = {
      entities: state.captureSnapshot(),
      nextId: state.getNextId(),
      description: this.undoStack[this.undoStack.length - 1].description,
    };
    this.redoStack.push(redoSnapshot);

    // Restore the undo snapshot
    const snapshot = this.undoStack.pop()!;
    state.restoreSnapshot(snapshot.entities, snapshot.nextId);
    return { success: true, description: `Undid: ${snapshot.description}` };
  }

  redo(state: DocumentState): { success: boolean; description: string } {
    if (this.redoStack.length === 0) {
      return { success: false, description: 'Nothing to redo' };
    }

    // Save current state as undo snapshot
    const undoSnapshot: StateSnapshot = {
      entities: state.captureSnapshot(),
      nextId: state.getNextId(),
      description: this.redoStack[this.redoStack.length - 1].description,
    };
    this.undoStack.push(undoSnapshot);

    // Restore the redo snapshot
    const snapshot = this.redoStack.pop()!;
    state.restoreSnapshot(snapshot.entities, snapshot.nextId);
    return { success: true, description: `Redid: ${snapshot.description}` };
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * When the undo stack exceeds maxDepth, evict the oldest snapshot
   * and .delete() any WASM shapes that are no longer referenced anywhere.
   */
  private evictOldSnapshots(): void {
    while (this.undoStack.length > this.maxDepth) {
      const evicted = this.undoStack.shift()!;
      this.deleteOrphanedShapes(evicted);
    }
  }

  /**
   * Discard an entire stack (e.g. redo stack on new mutation),
   * deleting shapes that are no longer referenced.
   */
  private discardStack(stack: StateSnapshot[], state: DocumentState): void {
    const liveShapes = this.collectLiveShapes(state);
    for (const snapshot of stack) {
      for (const entity of snapshot.entities) {
        if (!liveShapes.has(entity.shape)) {
          // Check it's not in the other stack either
          if (!this.shapeExistsInStack(entity.shape, this.undoStack)) {
            try {
              entity.shape.delete();
            } catch {
              // Shape may already be deleted
            }
          }
        }
      }
    }
  }

  /**
   * Delete shapes from an evicted snapshot that don't exist in current state
   * or any remaining snapshot in either stack.
   */
  private deleteOrphanedShapes(evicted: StateSnapshot): void {
    const referencedShapes = new Set<any>();

    // Collect shapes from both stacks
    for (const snapshot of this.undoStack) {
      for (const entity of snapshot.entities) {
        referencedShapes.add(entity.shape);
      }
    }
    for (const snapshot of this.redoStack) {
      for (const entity of snapshot.entities) {
        referencedShapes.add(entity.shape);
      }
    }

    for (const entity of evicted.entities) {
      if (!referencedShapes.has(entity.shape)) {
        try {
          entity.shape.delete();
        } catch {
          // Shape may already be deleted
        }
      }
    }
  }

  private collectLiveShapes(state: DocumentState): Set<any> {
    const shapes = new Set<any>();
    for (const entity of state.getAllEntities()) {
      shapes.add(entity.shape);
    }
    return shapes;
  }

  private shapeExistsInStack(shape: any, stack: StateSnapshot[]): boolean {
    for (const snapshot of stack) {
      for (const entity of snapshot.entities) {
        if (entity.shape === shape) return true;
      }
    }
    return false;
  }
}

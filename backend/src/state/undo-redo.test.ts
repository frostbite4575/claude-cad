import { describe, it, expect, beforeAll } from 'vitest';
import { UndoRedoManager } from './undo-redo.js';
import { DocumentState } from './document-state.js';
import { initOC, type OpenCascadeInstance } from '../geometry/oc-init.js';
import { createBox } from '../geometry/primitives.js';

describe('UndoRedoManager', () => {
  let oc: OpenCascadeInstance;

  beforeAll(async () => {
    oc = await initOC();
  }, 30_000);

  it('starts with empty stacks', () => {
    const mgr = new UndoRedoManager();
    const state = new DocumentState(oc);
    const result = mgr.undo(state);
    expect(result.description).toContain('Nothing');
  });

  it('captures and restores a snapshot', () => {
    const mgr = new UndoRedoManager();
    const state = new DocumentState(oc);

    // Add a box
    state.addEntity('Box1', 'box', createBox(oc, 1, 1, 1));
    expect(state.getAllEntities()).toHaveLength(1);

    // Capture snapshot, then add another box
    mgr.captureSnapshot(state, 'add box2');
    state.addEntity('Box2', 'box', createBox(oc, 2, 2, 2));
    expect(state.getAllEntities()).toHaveLength(2);

    // Undo should restore to 1 entity
    const result = mgr.undo(state);
    expect(result.description).toContain('Und');
    expect(state.getAllEntities()).toHaveLength(1);
  });

  it('redo restores after undo', () => {
    const mgr = new UndoRedoManager();
    const state = new DocumentState(oc);

    state.addEntity('Box1', 'box', createBox(oc, 1, 1, 1));
    mgr.captureSnapshot(state, 'add box2');
    state.addEntity('Box2', 'box', createBox(oc, 2, 2, 2));

    mgr.undo(state);
    expect(state.getAllEntities()).toHaveLength(1);

    const result = mgr.redo(state);
    expect(result.description).toContain('Red');
    expect(state.getAllEntities()).toHaveLength(2);
  });

  it('new action clears redo stack', () => {
    const mgr = new UndoRedoManager();
    const state = new DocumentState(oc);

    state.addEntity('Box1', 'box', createBox(oc, 1, 1, 1));
    mgr.captureSnapshot(state, 'add box2');
    state.addEntity('Box2', 'box', createBox(oc, 2, 2, 2));

    // Undo, then do a new action
    mgr.undo(state);
    mgr.captureSnapshot(state, 'add box3');
    state.addEntity('Box3', 'box', createBox(oc, 3, 3, 3));

    // Redo should have nothing
    const result = mgr.redo(state);
    expect(result.description).toContain('Nothing');
  });

  it('multiple undo steps', () => {
    const mgr = new UndoRedoManager();
    const state = new DocumentState(oc);

    mgr.captureSnapshot(state, 'add box1');
    state.addEntity('Box1', 'box', createBox(oc, 1, 1, 1));

    mgr.captureSnapshot(state, 'add box2');
    state.addEntity('Box2', 'box', createBox(oc, 2, 2, 2));

    mgr.captureSnapshot(state, 'add box3');
    state.addEntity('Box3', 'box', createBox(oc, 3, 3, 3));

    expect(state.getAllEntities()).toHaveLength(3);

    mgr.undo(state); // back to 2
    expect(state.getAllEntities()).toHaveLength(2);

    mgr.undo(state); // back to 1
    expect(state.getAllEntities()).toHaveLength(1);

    mgr.undo(state); // back to 0
    expect(state.getAllEntities()).toHaveLength(0);
  });
});

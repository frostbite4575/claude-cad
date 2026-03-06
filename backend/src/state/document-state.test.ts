import { describe, it, expect, beforeAll } from 'vitest';
import { DocumentState } from './document-state.js';
import { initOC, type OpenCascadeInstance } from '../geometry/oc-init.js';
import { createBox } from '../geometry/primitives.js';

describe('DocumentState', () => {
  let oc: OpenCascadeInstance;

  beforeAll(async () => {
    oc = await initOC();
  }, 30_000);

  it('starts with no entities', () => {
    const state = new DocumentState(oc);
    expect(state.getAllEntities()).toHaveLength(0);
  });

  it('adds an entity and assigns an ID', () => {
    const state = new DocumentState(oc);
    const shape = createBox(oc, 1, 1, 1);
    const entity = state.addEntity('Test Box', 'box', shape);
    expect(entity.id).toBeDefined();
    expect(entity.name).toBe('Test Box');
    expect(entity.type).toBe('box');
  });

  it('retrieves an entity by ID', () => {
    const state = new DocumentState(oc);
    const shape = createBox(oc, 2, 2, 2);
    const entity = state.addEntity('Box A', 'box', shape);
    const retrieved = state.getEntity(entity.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toBe('Box A');
  });

  it('returns undefined for non-existent entity', () => {
    const state = new DocumentState(oc);
    expect(state.getEntity('nonexistent')).toBeUndefined();
  });

  it('removes an entity', () => {
    const state = new DocumentState(oc);
    const shape = createBox(oc, 1, 1, 1);
    const entity = state.addEntity('Box', 'box', shape);
    state.removeEntity(entity.id);
    expect(state.getEntity(entity.id)).toBeUndefined();
    expect(state.getAllEntities()).toHaveLength(0);
  });

  it('replaces shape on an entity', () => {
    const state = new DocumentState(oc);
    const shape1 = createBox(oc, 1, 1, 1);
    const entity = state.addEntity('Box', 'box', shape1);
    const shape2 = createBox(oc, 5, 5, 5);
    state.replaceShape(entity.id, shape2);
    const updated = state.getEntity(entity.id);
    expect(updated!.shape).toBe(shape2);
  });

  it('getAllEntities returns all added entities', () => {
    const state = new DocumentState(oc);
    state.addEntity('A', 'box', createBox(oc, 1, 1, 1));
    state.addEntity('B', 'box', createBox(oc, 2, 2, 2));
    state.addEntity('C', 'box', createBox(oc, 3, 3, 3));
    expect(state.getAllEntities()).toHaveLength(3);
  });

  it('generates unique IDs', () => {
    const state = new DocumentState(oc);
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const entity = state.addEntity(`Box ${i}`, 'box', createBox(oc, 1, 1, 1));
      ids.add(entity.id);
    }
    expect(ids.size).toBe(10);
  });

  it('addEntity with metadata', () => {
    const state = new DocumentState(oc);
    const entity = state.addEntity('Plate', 'sheet_metal_plate', createBox(oc, 4, 4, 0.1), {
      entityKind: 'solid',
      sheetMetal: true,
    });
    expect(entity.metadata.entityKind).toBe('solid');
    expect(entity.metadata.sheetMetal).toBe(true);
  });

  it('tessellateAll returns mesh data', () => {
    const state = new DocumentState(oc);
    state.addEntity('Box', 'box', createBox(oc, 2, 2, 2));
    const meshes = state.tessellateAll();
    expect(meshes).toHaveLength(1);
    expect(meshes[0].vertices.length).toBeGreaterThan(0);
    expect(meshes[0].indices.length).toBeGreaterThan(0);
  });

  it('selected entity ID tracking', () => {
    const state = new DocumentState(oc);
    const entity = state.addEntity('Box', 'box', createBox(oc, 1, 1, 1));
    state.setSelectedEntityId(entity.id);
    expect(state.getSelectedEntityId()).toBe(entity.id);
    state.setSelectedEntityId(null);
    expect(state.getSelectedEntityId()).toBeNull();
  });
});

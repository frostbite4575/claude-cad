import type { OpenCascadeInstance } from '../geometry/oc-init.js';
import type { DocumentState, Entity, UnitSystem } from './document-state.js';
import { exportStep } from '../geometry/step-export.js';
import { importStep } from '../geometry/step-import.js';

/**
 * Project file format (.ccad) — JSON with embedded STEP geometry.
 */
export interface ProjectFile {
  version: 1;
  units: UnitSystem;
  nextId: number;
  entities: ProjectEntity[];
  stepData: string; // STEP file content for all shapes
}

interface ProjectEntity {
  id: string;
  name: string;
  type: string;
  metadata: Record<string, unknown>;
  shapeIndex: number; // index into the STEP import result
}

/**
 * Serialize the current document state into a project file.
 */
export function saveProject(oc: OpenCascadeInstance, state: DocumentState): ProjectFile {
  const entities = state.getAllEntities();
  if (entities.length === 0) {
    return {
      version: 1,
      units: state.getUnits(),
      nextId: state.getNextId(),
      entities: [],
      stepData: '',
    };
  }

  // Export all shapes as a single STEP file
  const shapes = entities.map(e => e.shape);
  const stepResult = exportStep(oc, shapes);

  // Build entity manifest (without shape refs)
  const projectEntities: ProjectEntity[] = entities.map((e, i) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    metadata: { ...e.metadata },
    shapeIndex: i,
  }));

  // Strip non-serializable fields from metadata
  for (const pe of projectEntities) {
    delete pe.metadata.flatShape; // live WASM reference
  }

  return {
    version: 1,
    units: state.getUnits(),
    nextId: state.getNextId(),
    entities: projectEntities,
    stepData: stepResult.stepContent,
  };
}

/**
 * Load a project file into the document state, replacing all current content.
 * Returns warnings from STEP import.
 */
export function loadProject(
  oc: OpenCascadeInstance,
  state: DocumentState,
  project: ProjectFile
): { warnings: string[] } {
  const warnings: string[] = [];

  // Validate
  if (!project.version || project.version !== 1) {
    throw new Error(`Unsupported project version: ${project.version}`);
  }

  // Clear current state
  for (const entity of state.getAllEntities()) {
    state.removeEntity(entity.id);
  }

  // Restore units
  state.setUnits(project.units || 'inches');

  // If no entities, just restore empty state
  if (project.entities.length === 0 || !project.stepData) {
    state.setNextId(project.nextId || 1);
    return { warnings };
  }

  // Import STEP data
  const stepResult = importStep(oc, project.stepData);
  warnings.push(...stepResult.warnings);

  if (stepResult.shapes.length !== project.entities.length) {
    warnings.push(
      `Shape count mismatch: project has ${project.entities.length} entities but STEP import produced ${stepResult.shapes.length} shapes. Some entities may not be restored correctly.`
    );
  }

  // Restore entities with their metadata
  for (let i = 0; i < project.entities.length; i++) {
    const pe = project.entities[i];
    const shape = stepResult.shapes[pe.shapeIndex];
    if (!shape) {
      warnings.push(`Missing shape for entity ${pe.id} (index ${pe.shapeIndex})`);
      continue;
    }

    // Use addEntity but we need to match the original ID
    // We'll add them and then the IDs won't match — instead, use direct insertion
    state.addEntityWithId(pe.id, pe.name, pe.type, shape, pe.metadata);
  }

  // Restore nextId
  state.setNextId(project.nextId || 1);

  return { warnings };
}

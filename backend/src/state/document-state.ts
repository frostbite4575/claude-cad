import type { OpenCascadeInstance } from '../geometry/oc-init.js';
import { tessellate } from '../geometry/tessellator.js';
import type { TessellatedMesh, EntityInfo } from '../../../shared/index.js';
import type { EntitySnapshot } from './undo-redo.js';

export interface Entity {
  id: string;
  name: string;
  type: string;
  shape: any; // TopoDS_Shape — kept alive for boolean/transform operations
  metadata: Record<string, unknown>;
}

export class DocumentState {
  private entities = new Map<string, Entity>();
  private nextId = 1;
  private oc: OpenCascadeInstance;
  private selectedEntityId: string | null = null;
  // Tessellation cache: keyed by entity ID, invalidated on shape changes
  private tessCache = new Map<string, TessellatedMesh>();
  private entityVersions = new Map<string, number>();

  constructor(oc: OpenCascadeInstance) {
    this.oc = oc;
  }

  getSelectedEntityId(): string | null {
    return this.selectedEntityId;
  }

  setSelectedEntityId(id: string | null): void {
    if (id === null || this.entities.has(id)) {
      this.selectedEntityId = id;
    } else {
      this.selectedEntityId = null;
    }
  }

  addEntity(name: string, type: string, shape: any, metadata: Record<string, unknown> = {}): Entity {
    const id = `shape_${this.nextId++}`;
    const entity: Entity = { id, name, type, shape, metadata };
    this.entities.set(id, entity);
    this.invalidateTessCache(id);
    return entity;
  }

  getEntity(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  // No longer calls shape.delete() — undo stack owns displaced shapes
  removeEntity(id: string): boolean {
    const entity = this.entities.get(id);
    if (!entity) return false;
    this.entities.delete(id);
    this.tessCache.delete(id);
    this.entityVersions.delete(id);
    return true;
  }

  // No longer calls oldShape.delete() — undo stack owns displaced shapes
  replaceShape(id: string, newShape: any): boolean {
    const entity = this.entities.get(id);
    if (!entity) return false;
    entity.shape = newShape;
    this.invalidateTessCache(id);
    return true;
  }

  getAllEntities(): Entity[] {
    return Array.from(this.entities.values());
  }

  getNextId(): number {
    return this.nextId;
  }

  setNextId(id: number): void {
    this.nextId = id;
  }

  /**
   * Capture a snapshot of the current entity map for undo/redo.
   * Returns shallow copies with live WASM shape references.
   */
  captureSnapshot(): EntitySnapshot[] {
    const snapshots: EntitySnapshot[] = [];
    for (const entity of this.entities.values()) {
      snapshots.push({
        id: entity.id,
        name: entity.name,
        type: entity.type,
        shape: entity.shape,
        metadata: JSON.parse(JSON.stringify(entity.metadata)),
      });
    }
    return snapshots;
  }

  /**
   * Restore state from a snapshot. Clears the entity map (without deleting shapes)
   * and rebuilds from the snapshot data.
   */
  restoreSnapshot(snapshots: EntitySnapshot[], nextId: number): void {
    this.entities.clear();
    this.tessCache.clear();
    this.entityVersions.clear();
    for (const snap of snapshots) {
      this.entities.set(snap.id, {
        id: snap.id,
        name: snap.name,
        type: snap.type,
        shape: snap.shape,
        metadata: JSON.parse(JSON.stringify(snap.metadata)),
      });
    }
    this.nextId = nextId;
  }

  private invalidateTessCache(id: string): void {
    this.tessCache.delete(id);
    this.entityVersions.set(id, (this.entityVersions.get(id) ?? 0) + 1);
  }

  tessellateAll(): TessellatedMesh[] {
    const meshes: TessellatedMesh[] = [];
    for (const entity of this.entities.values()) {
      // Check cache
      const cached = this.tessCache.get(entity.id);
      if (cached) {
        meshes.push(cached);
        continue;
      }

      const mesh = tessellate(this.oc, entity.shape);
      mesh.entityId = entity.id;
      mesh.entityKind = (entity.metadata.entityKind as 'sketch' | 'solid') || 'solid';
      mesh.name = entity.name;
      mesh.entityType = entity.type;

      this.tessCache.set(entity.id, mesh);
      meshes.push(mesh);
    }
    return meshes;
  }

  getSceneInfo(): EntityInfo[] {
    const infos: EntityInfo[] = [];
    for (const entity of this.entities.values()) {
      let boundingBox = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
      try {
        const bbox = new this.oc.Bnd_Box_1();
        this.oc.BRepBndLib.Add(entity.shape, bbox, false);
        const min = bbox.CornerMin();
        const max = bbox.CornerMax();
        boundingBox = {
          min: { x: min.X(), y: min.Y(), z: min.Z() },
          max: { x: max.X(), y: max.Y(), z: max.Z() },
        };
        min.delete(); max.delete(); bbox.delete();
      } catch {
        // Bounding box computation failed — return zeros
      }

      // Compute surface area and volume
      let surfaceArea: number | undefined;
      let volume: number | undefined;
      let edgeLength: number | undefined;

      try {
        const surfProps = new this.oc.GProp_GProps_1();
        this.oc.BRepGProp.SurfaceProperties_1(entity.shape, surfProps, false);
        surfaceArea = Math.round(surfProps.Mass() * 10000) / 10000;
        surfProps.delete();
      } catch { /* skip */ }

      try {
        const volProps = new this.oc.GProp_GProps_1();
        this.oc.BRepGProp.VolumeProperties_1(entity.shape, volProps, false);
        volume = Math.round(volProps.Mass() * 10000) / 10000;
        volProps.delete();
      } catch { /* skip */ }

      // Compute total edge length (cut length for DXF)
      try {
        const linProps = new this.oc.GProp_GProps_1();
        this.oc.BRepGProp.LinearProperties(entity.shape, linProps, false);
        edgeLength = Math.round(linProps.Mass() * 10000) / 10000;
        linProps.delete();
      } catch { /* skip */ }

      infos.push({
        id: entity.id,
        name: entity.name,
        type: entity.type,
        entityKind: (entity.metadata.entityKind as 'sketch' | 'solid') || 'solid',
        boundingBox,
        surfaceArea,
        volume,
        edgeLength,
      });
    }
    return infos;
  }
}

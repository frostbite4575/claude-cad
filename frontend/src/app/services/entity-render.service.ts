import { Injectable } from '@angular/core';
import * as THREE from 'three';

export interface EntityEntry {
  mesh: THREE.Mesh | null;
  lines: THREE.LineSegments | null;
  kind: 'sketch' | 'solid';
}

export interface EntityInfo {
  name: string;
  type: string;
}

export interface MeshData {
  vertices: number[];
  indices: number[];
  normals: number[];
  edges: number[];
  entityId?: string;
  entityKind?: 'sketch' | 'solid';
  name?: string;
  entityType?: string;
}

@Injectable({ providedIn: 'root' })
export class EntityRenderService {
  readonly entityRegistry = new Map<string, EntityEntry>();
  readonly entityInfoCache = new Map<string, EntityInfo>();

  private hiddenEntities = new Set<string>();
  viewMode: 'shaded' | 'wireframe' | 'both' = 'both';

  clearAll(meshGroup: THREE.Group): void {
    this.entityRegistry.clear();
    this.entityInfoCache.clear();
    while (meshGroup.children.length > 0) {
      const child = meshGroup.children[0];
      meshGroup.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
  }

  addMesh(meshGroup: THREE.Group, data: MeshData): void {
    const isSketch = data.entityKind === 'sketch';
    const entityId = data.entityId;
    let createdMesh: THREE.Mesh | null = null;
    let createdLines: THREE.LineSegments | null = null;

    if (isSketch) {
      if (data.edges.length > 0) {
        const edgeGeometry = new THREE.BufferGeometry();
        edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(data.edges, 3));
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0x00e5ff, linewidth: 2 });
        const lines = new THREE.LineSegments(edgeGeometry, lineMaterial);
        if (entityId) lines.userData['entityId'] = entityId;
        meshGroup.add(lines);
        createdLines = lines;
      }

      if (data.vertices.length > 0 && data.indices.length > 0) {
        const fillGeometry = new THREE.BufferGeometry();
        fillGeometry.setAttribute('position', new THREE.Float32BufferAttribute(data.vertices, 3));
        fillGeometry.setIndex(data.indices);
        fillGeometry.computeVertexNormals();
        const fillMaterial = new THREE.MeshBasicMaterial({
          color: 0x00e5ff,
          transparent: true,
          opacity: 0.1,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const fillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
        if (entityId) fillMesh.userData['entityId'] = entityId;
        meshGroup.add(fillMesh);
        createdMesh = fillMesh;
      }
    } else {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.vertices, 3));
      geometry.setIndex(data.indices);

      if (data.normals.length > 0) {
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
      } else {
        geometry.computeVertexNormals();
      }

      const material = new THREE.MeshStandardMaterial({
        color: 0x7090b0,
        metalness: 0.3,
        roughness: 0.6,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      if (entityId) mesh.userData['entityId'] = entityId;
      meshGroup.add(mesh);
      createdMesh = mesh;

      let edgeGeometry: THREE.BufferGeometry;
      if (data.edges.length > 0) {
        edgeGeometry = new THREE.BufferGeometry();
        edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(data.edges, 3));
      } else {
        edgeGeometry = new THREE.EdgesGeometry(geometry, 15);
      }

      const lineMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
      const lines = new THREE.LineSegments(edgeGeometry, lineMaterial);
      if (entityId) lines.userData['entityId'] = entityId;
      meshGroup.add(lines);
      createdLines = lines;
    }

    if (entityId) {
      this.entityRegistry.set(entityId, {
        mesh: createdMesh,
        lines: createdLines,
        kind: isSketch ? 'sketch' : 'solid',
      });
      if (data.name || data.entityType) {
        this.entityInfoCache.set(entityId, {
          name: data.name || entityId,
          type: data.entityType || 'unknown',
        });
      }
    }
  }

  applyHighlight(entityId: string, selected: boolean): void {
    const entry = this.entityRegistry.get(entityId);
    if (!entry) return;

    if (entry.kind === 'sketch') {
      const color = selected ? 0xffdd00 : 0x00e5ff;
      if (entry.mesh) {
        (entry.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
      }
      if (entry.lines) {
        (entry.lines.material as THREE.LineBasicMaterial).color.setHex(color);
      }
    } else {
      if (entry.mesh) {
        const mat = entry.mesh.material as THREE.MeshStandardMaterial;
        mat.color.setHex(selected ? 0xe87a30 : 0x7090b0);
        mat.emissive.setHex(selected ? 0x331800 : 0x000000);
      }
      if (entry.lines) {
        (entry.lines.material as THREE.LineBasicMaterial).color.setHex(selected ? 0xe87a30 : 0x000000);
      }
    }
  }

  applyViewMode(): void {
    for (const [id, entry] of this.entityRegistry) {
      if (this.hiddenEntities.has(id)) continue;
      if (entry.kind === 'sketch') continue;

      if (entry.mesh) {
        entry.mesh.visible = this.viewMode !== 'wireframe';
      }
      if (entry.lines) {
        entry.lines.visible = this.viewMode !== 'shaded';
      }
    }
  }

  applyHiddenEntities(): void {
    for (const hiddenId of this.hiddenEntities) {
      const entry = this.entityRegistry.get(hiddenId);
      if (entry) {
        if (entry.mesh) entry.mesh.visible = false;
        if (entry.lines) entry.lines.visible = false;
      }
    }
  }

  cycleViewMode(): void {
    const modes: Array<'shaded' | 'wireframe' | 'both'> = ['both', 'shaded', 'wireframe'];
    const idx = modes.indexOf(this.viewMode);
    this.viewMode = modes[(idx + 1) % modes.length];
    this.applyViewMode();
  }

  toggleVisibility(id: string): void {
    const entry = this.entityRegistry.get(id);
    if (!entry) return;

    if (this.hiddenEntities.has(id)) {
      this.hiddenEntities.delete(id);
      if (entry.mesh) entry.mesh.visible = true;
      if (entry.lines) entry.lines.visible = true;
    } else {
      this.hiddenEntities.add(id);
      if (entry.mesh) entry.mesh.visible = false;
      if (entry.lines) entry.lines.visible = false;
    }
  }

  isHidden(id: string): boolean {
    return this.hiddenEntities.has(id);
  }

  getPropertyPanelData(entityId: string): { name: string; type: string; kind: string; dims: string } | null {
    const entry = this.entityRegistry.get(entityId);
    const info = this.entityInfoCache.get(entityId);
    if (!entry || !info) return null;

    const target = entry.mesh || entry.lines;
    if (!target) return null;

    const bbox = new THREE.Box3().setFromObject(target);
    const size = bbox.getSize(new THREE.Vector3());

    return {
      name: info.name,
      type: info.type,
      kind: entry.kind,
      dims: `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} in`,
    };
  }

  buildEntityList(selectedIds: Set<string>): { id: string; name: string; kind: string; selected: boolean; visible: boolean }[] {
    const list: { id: string; name: string; kind: string; selected: boolean; visible: boolean }[] = [];
    for (const [id, entry] of this.entityRegistry) {
      const info = this.entityInfoCache.get(id);
      list.push({
        id,
        name: info?.name || id,
        kind: entry.kind,
        selected: selectedIds.has(id),
        visible: !this.hiddenEntities.has(id),
      });
    }
    return list;
  }
}

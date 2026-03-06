import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { SketchPlane } from './drawing-tool.service';

@Injectable({ providedIn: 'root' })
export class SnappingService {
  snapEnabled = true;
  snapSize = 0.25;

  private snapPointCache: THREE.Vector3[] = [];
  private snapIndicator: THREE.Mesh | null = null;

  private readonly gridSizes = [0.0625, 0.125, 0.25, 0.5, 1.0];

  rebuildSnapPoints(meshGroup: THREE.Group): void {
    this.snapPointCache = [];
    meshGroup.traverse((child) => {
      if (child instanceof THREE.LineSegments) {
        const positions = child.geometry.getAttribute('position');
        if (!positions) return;
        const count = positions.count;
        for (let i = 0; i < count - 1; i += 2) {
          const a = new THREE.Vector3(positions.getX(i), positions.getY(i), positions.getZ(i));
          const b = new THREE.Vector3(positions.getX(i + 1), positions.getY(i + 1), positions.getZ(i + 1));
          this.snapPointCache.push(a, b);
          this.snapPointCache.push(a.clone().lerp(b, 0.5));
        }
      }
    });
  }

  snapToGrid(pos: THREE.Vector3, plane: SketchPlane): THREE.Vector3 {
    if (!this.snapEnabled) return pos;
    const s = this.snapSize;
    switch (plane) {
      case 'XY':
        return new THREE.Vector3(Math.round(pos.x / s) * s, Math.round(pos.y / s) * s, pos.z);
      case 'XZ':
        return new THREE.Vector3(Math.round(pos.x / s) * s, pos.y, Math.round(pos.z / s) * s);
      case 'YZ':
        return new THREE.Vector3(pos.x, Math.round(pos.y / s) * s, Math.round(pos.z / s) * s);
    }
  }

  findSnapPoint(worldPos: THREE.Vector3, camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement, screenThreshold = 12): THREE.Vector3 | null {
    if (this.snapPointCache.length === 0) return null;

    const screenPos = worldPos.clone().project(camera);
    const sx = (screenPos.x + 1) / 2 * canvas.clientWidth;
    const sy = (-screenPos.y + 1) / 2 * canvas.clientHeight;

    let bestDist = Infinity;
    let bestPoint: THREE.Vector3 | null = null;

    for (const pt of this.snapPointCache) {
      const sp = pt.clone().project(camera);
      const px = (sp.x + 1) / 2 * canvas.clientWidth;
      const py = (-sp.y + 1) / 2 * canvas.clientHeight;
      const dist = Math.sqrt((px - sx) ** 2 + (py - sy) ** 2);
      if (dist < screenThreshold && dist < bestDist) {
        bestDist = dist;
        bestPoint = pt;
      }
    }

    return bestPoint;
  }

  showSnapIndicator(pos: THREE.Vector3, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    if (!this.snapIndicator) {
      const geom = new THREE.RingGeometry(0.06, 0.1, 16);
      const mat = new THREE.MeshBasicMaterial({ color: 0xff8800, side: THREE.DoubleSide, depthTest: false });
      this.snapIndicator = new THREE.Mesh(geom, mat);
      this.snapIndicator.renderOrder = 999;
      scene.add(this.snapIndicator);
    }
    this.snapIndicator.position.copy(pos);
    this.snapIndicator.lookAt(camera.position);
    this.snapIndicator.visible = true;
  }

  hideSnapIndicator(): void {
    if (this.snapIndicator) {
      this.snapIndicator.visible = false;
    }
  }

  showDrawingGrid(gridGroup: THREE.Group, plane: SketchPlane): void {
    this.hideDrawingGrid(gridGroup);
    const extent = 20;
    const step = this.snapSize;
    const points: THREE.Vector3[] = [];
    const offset = 0.001;

    switch (plane) {
      case 'XY':
        for (let x = -extent; x <= extent; x += step) {
          points.push(new THREE.Vector3(x, -extent, offset));
          points.push(new THREE.Vector3(x, extent, offset));
        }
        for (let y = -extent; y <= extent; y += step) {
          points.push(new THREE.Vector3(-extent, y, offset));
          points.push(new THREE.Vector3(extent, y, offset));
        }
        break;
      case 'XZ':
        for (let x = -extent; x <= extent; x += step) {
          points.push(new THREE.Vector3(x, offset, -extent));
          points.push(new THREE.Vector3(x, offset, extent));
        }
        for (let z = -extent; z <= extent; z += step) {
          points.push(new THREE.Vector3(-extent, offset, z));
          points.push(new THREE.Vector3(extent, offset, z));
        }
        break;
      case 'YZ':
        for (let y = -extent; y <= extent; y += step) {
          points.push(new THREE.Vector3(offset, y, -extent));
          points.push(new THREE.Vector3(offset, y, extent));
        }
        for (let z = -extent; z <= extent; z += step) {
          points.push(new THREE.Vector3(offset, -extent, z));
          points.push(new THREE.Vector3(offset, extent, z));
        }
        break;
    }

    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0x334466, transparent: true, opacity: 0.3 });
    const lines = new THREE.LineSegments(geom, mat);
    gridGroup.add(lines);
  }

  hideDrawingGrid(gridGroup: THREE.Group): void {
    while (gridGroup.children.length > 0) {
      const child = gridGroup.children[0];
      gridGroup.remove(child);
      if (child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
  }

  cycleGridSize(): void {
    const idx = this.gridSizes.indexOf(this.snapSize);
    this.snapSize = this.gridSizes[(idx + 1) % this.gridSizes.length];
  }

  toggleSnap(): void {
    this.snapEnabled = !this.snapEnabled;
  }

  dispose(): void {
    if (this.snapIndicator) {
      this.snapIndicator.geometry.dispose();
      (this.snapIndicator.material as THREE.Material).dispose();
    }
  }
}
